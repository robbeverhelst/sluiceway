import { describe, expect, test } from "bun:test";
import { parseConfig } from "../../src/core/config.ts";
import { MODES } from "../../src/mode.ts";
import {
  EXAMPLE_WORKFLOWS,
  fences,
  isCheckWorkflow,
  isOneStep,
  isSluiceway,
  modeOf,
  read,
  section,
  USER_DOCS,
  type Workflow,
  workflows,
} from "./docs.ts";

// Slice 2.10: a stranger sets Sluiceway up from the docs alone, so every
// workflow the docs show has to work as written. Since the README rewrite the
// README shows the whole loop and docs/workflow.md explains it. These tests hold each one to
// action.yml and to the wiring the records need.

type ActionMetadata = {
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
};
const action = Bun.YAML.parse(read("action.yml")) as ActionMetadata;
const INPUTS = Object.keys(action.inputs);
const OUTPUTS = Object.keys(action.outputs);

const all = workflows();
const steps = all.flatMap(({ where, workflow }) =>
  Object.entries(workflow.jobs).flatMap(([name, job]) =>
    job.steps.filter(isSluiceway).map((step) => ({ where: `${where}, job ${name}`, step })),
  ),
);

describe("the workflows in the docs", () => {
  test("there are some to check: the README's, the manual's, and one example per setup", () => {
    const at = (path: string) => all.filter(({ where }) => where.startsWith(path)).length;
    expect(at("README.md")).toBe(1);
    expect(at("docs/workflow.md")).toBeGreaterThanOrEqual(2);
    expect(at("docs/split-workflow.md")).toBe(1);
    expect(at("docs/read-only-trial.md")).toBe(1);
    expect(EXAMPLE_WORKFLOWS.length).toBeGreaterThanOrEqual(3);
  });

  test("every input a Sluiceway step uses exists in action.yml", () => {
    const unknown = steps.flatMap(({ where, step }) =>
      Object.keys(step.with ?? {})
        .filter((input) => !INPUTS.includes(input))
        .map((input) => `${where}: ${input}`),
    );
    expect(unknown).toEqual([]);
  });

  // No mode is auto, action.yml's default (record 0077).
  test("every Sluiceway step names a mode that exists, or none", () => {
    const wrong = steps
      .filter(
        ({ step }) => !(MODES as readonly string[]).includes(String(step.with?.mode ?? "auto")),
      )
      .map(({ where }) => where);
    expect(wrong).toEqual([]);
  });

  // Record 0035: required in apply, an error in every other mode.
  test("deployment-id is set in apply and nowhere else", () => {
    const wrong = steps
      .filter(({ step }) => (step.with?.mode === "apply") !== "deployment-id" in (step.with ?? {}))
      .map(({ where }) => where);
    expect(wrong).toEqual([]);
  });

  // Record 0017: always the workflow's own token.
  test("no example sets github-token", () => {
    expect(
      steps.filter(({ step }) => "github-token" in (step.with ?? {})).map((s) => s.where),
    ).toEqual([]);
  });

  test("every output read from a Sluiceway step exists in action.yml", () => {
    const wrong = all.flatMap(({ where, workflow }) => {
      const ids = new Set(
        Object.values(workflow.jobs).flatMap((job) =>
          job.steps.filter(isSluiceway).flatMap((step) => (step.id ? [step.id] : [])),
        ),
      );
      const text = JSON.stringify(workflow);
      return [...text.matchAll(/steps\.([\w-]+)\.outputs\.([\w-]+)/g)]
        .filter(([, id, output]) => ids.has(id ?? "") && !OUTPUTS.includes(output ?? ""))
        .map(([reference]) => `${where}: ${reference}`);
    });
    expect(wrong).toEqual([]);
  });

  // Build plan, section 8: 0.1.0 is out, and examples say @v0 until 1.0.0.
  test("the action is used at v0", () => {
    const wrong = steps
      .filter(({ step }) => step.uses !== "sluiceway/sluiceway@v0")
      .map(({ where, step }) => `${where}: ${step.uses}`);
    expect(wrong).toEqual([]);
  });

  // actions/cache v4 runs on Node 20, which the runner forces onto Node 24 with
  // a warning in every run. v5 and newer run on Node 24 (onboarding log,
  // hurdle 25).
  test("actions/cache is v5 or newer", () => {
    const wrong = all.flatMap(({ where, workflow }) =>
      Object.values(workflow.jobs)
        .flatMap((job) => job.steps)
        .filter((step) => /^actions\/cache(\/(restore|save))?@/.test(step.uses ?? ""))
        .filter((step) => Number(step.uses?.match(/@v(\d+)$/)?.[1] ?? 0) < 5)
        .map((step) => `${where}: ${step.uses}`),
    );
    expect(wrong).toEqual([]);
    expect(all.some(({ workflow }) => JSON.stringify(workflow).includes("actions/cache"))).toBe(
      true,
    );
  });

  // A scan writes the dashboard from the code it checked out, and the one job
  // loads credentials before it. On a pull request or in a merge queue that
  // is code that is not on the default branch.
  test("a workflow that scans never runs on pull requests or in a merge queue", () => {
    const wrong = all
      .filter(({ workflow }) => !isCheckWorkflow(workflow))
      .filter(({ workflow }) =>
        ["pull_request", "pull_request_target", "merge_group"].some(
          (event) => event in workflow.on,
        ),
      )
      .map(({ where }) => where);
    expect(wrong).toEqual([]);
  });

  // Record 0042: the check reads files and nothing else. With the pull
  // request preview it writes a page per stack, which is checks: write and
  // no more (record 0101).
  test("a check workflow asks for contents: read and nothing more, and one that previews adds checks: write", () => {
    const checks = all.filter(({ workflow }) => isCheckWorkflow(workflow));
    const previews = ({ workflow }: { workflow: Workflow }) =>
      Object.values(workflow.jobs).some((job) =>
        job.steps.some((step) => isSluiceway(step) && step.with?.["pull-request-preview"] === true),
      );
    expect(checks.filter(previews).length).toBe(1);
    expect(checks.filter((one) => !previews(one)).length).toBeGreaterThan(0);
    for (const found of checks) {
      expect(found.workflow.permissions).toEqual(
        previews(found) ? { contents: "read", checks: "write" } : { contents: "read" },
      );
    }
  });
});

describe("a workflow that deploys", () => {
  // The read-only trial is one step too, and deploys nothing.
  const deploying = all.filter(
    ({ workflow }) =>
      (isOneStep(workflow) && "issues" in workflow.on) ||
      Object.values(workflow.jobs).some((job) => modeOf(job) === "resolve"),
  );
  const split = deploying.filter(({ workflow }) => !isOneStep(workflow));
  const oneStep = deploying.filter(({ workflow }) => isOneStep(workflow));

  test("there are some to check, most of them one job", () => {
    expect(oneStep.length).toBeGreaterThanOrEqual(5);
    // The split workflow, on its own page.
    expect(split.map(({ where }) => where.split(",")[0])).toEqual(["docs/split-workflow.md"]);
  });

  test.each(deploying)("listens to issue edits and to dispatch: $where", ({ workflow }) => {
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on.issues).toEqual({ types: ["edited"] });
    expect(workflow.on).toHaveProperty("schedule");
    expect(workflow.on).toHaveProperty("push");
  });

  // Record 0025: the event is only a wake-up. A filter on what the payload says
  // changed (such as `changes.body.from`) could let a tick go by without a
  // run, which is the trap slice 2.21 checks for.
  test.each(deploying)("never filters on what the event says changed: $where", ({ workflow }) => {
    expect(JSON.stringify(workflow)).not.toContain("event.changes");
  });

  // The preview pages need checks: write (record 0050). OIDC adds id-token.
  test.each(deploying)("has the permissions of the workflow's block: $where", ({ workflow }) => {
    const { "id-token": idToken, ...rest } = workflow.permissions ?? {};
    expect(rest).toEqual({
      contents: "read",
      issues: "write",
      deployments: "write",
      actions: "write",
      "pull-requests": "read",
      checks: "write",
    });
    expect(idToken === undefined || idToken === "write").toBe(true);
  });

  // A job's permissions replace the workflow's, so a job that adds one, such
  // as id-token for OIDC, has to repeat the rest.
  test.each(deploying)(
    "a job with its own permissions keeps the whole block: $where",
    ({ workflow }) => {
      for (const job of Object.values(workflow.jobs)) {
        if (job.permissions === undefined) continue;
        expect(job.permissions).toMatchObject(workflow.permissions ?? {});
      }
    },
  );
});

// Record 0077, the owner on 2026-09-22: "these crazy ifs, cant we make sure
// this isnt necessary anymore". The workflow people copy is one job with one
// step that picks its own mode.
describe("the one-step workflow", () => {
  const oneStep = all.filter(({ workflow }) => isOneStep(workflow));

  test("is the README's, the manual's, the read-only trial's and every example's", () => {
    const places = oneStep.map(({ where }) => where.split(",")[0]);
    for (const place of [
      "README.md",
      "docs/workflow.md",
      "docs/read-only-trial.md",
      ...EXAMPLE_WORKFLOWS,
    ]) {
      expect(places).toContain(place);
    }
  });

  test.each(oneStep)("has no if:, no needs: and no mode: $where", ({ workflow }) => {
    const text = JSON.stringify(workflow);
    expect(text).not.toContain('"if"');
    expect(text).not.toContain('"needs"');
    expect(text).not.toContain('"mode"');
  });

  // One run at a time, none dropped, none stopped half way, and an edit of
  // any other issue waits for none of them.
  test.each(oneStep)("waits in line: $where", ({ workflow }) => {
    const [job] = Object.values(workflow.jobs);
    expect(job?.concurrency).toEqual({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a template.
      group: "sluiceway-${{ github.event.issue.number }}",
      queue: "max",
    });
  });
});

describe("the split workflow", () => {
  const split = all.filter(
    ({ workflow }) =>
      !isOneStep(workflow) && Object.values(workflow.jobs).some((job) => modeOf(job) === "resolve"),
  );

  // The sweep only knows the runs of its own workflow file (slice 2.7), and the
  // rescan box and settle dispatch that same file (records 0009, 0035).
  test.each(split)("has all four jobs in one file: $where", ({ workflow }) => {
    const modes = Object.values(workflow.jobs).map(modeOf);
    expect(modes).toEqual(expect.arrayContaining(["scan", "resolve", "apply", "settle"]));
  });

  // Record 0014, promise 4: the job an issue edit starts holds no credentials.
  test.each(split)(
    "resolve and settle only check out and run Sluiceway: $where",
    ({ workflow }) => {
      for (const job of Object.values(workflow.jobs)) {
        const mode = modeOf(job);
        if (mode !== "resolve" && mode !== "settle") continue;
        expect(job.steps.map((step) => step.uses?.split("@")[0])).toEqual([
          "actions/checkout",
          "sluiceway/sluiceway",
        ]);
        expect(job.environment).toBeUndefined();
        expect(job.permissions).toBeUndefined();
      }
    },
  );

  // Slice 2.4: resolve can end red and still hand off deploys.
  test.each(split)("apply queues and runs when resolve was red: $where", ({ workflow }) => {
    const apply = Object.values(workflow.jobs).find((job) => modeOf(job) === "apply");
    expect(apply?.if).toContain("!cancelled()");
    expect(apply?.concurrency).toEqual({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a template.
      group: "sluiceway-apply-${{ matrix.stack }}",
      queue: "max",
    });
  });

  test.each(split)("scans and resolves one at a time: $where", ({ workflow }) => {
    const byMode = (mode: string) =>
      Object.values(workflow.jobs).find((job) => modeOf(job) === mode)?.concurrency;
    expect(byMode("scan")).toBe("sluiceway-scan");
    expect(byMode("resolve")).toBe("sluiceway-resolve");
  });
});

describe("the setup in docs/workflow.md", () => {
  const page = read("docs/workflow.md");
  const shown = all.filter(({ where }) => where.startsWith("docs/workflow.md"));

  // The README once opened with a warning box that said Sluiceway was not
  // released. Warning boxes now mark only what new users ran into first.
  test("has warning boxes only for what new users ran into", () => {
    const warnings = (text: string) => text.split("\n").filter((line) => line === "> [!WARNING]");
    expect(warnings(read("README.md"))).toEqual([]);
    expect(warnings(page).length).toBe(
      warnings(section(page, "## What new users ran into")).length,
    );
  });

  // Record 0042: the setup starts with the check.
  test("shows the check before any workflow that previews or deploys", () => {
    expect(shown[0] && isCheckWorkflow(shown[0].workflow)).toBe(true);
    expect(shown.some(({ workflow }) => isOneStep(workflow))).toBe(true);
  });

  // Onboarding log, hurdle 8.
  test("has the table of what goes where", () => {
    expect(page.includes("| `sluiceway.yaml` |")).toBe(true);
  });

  test("says not to add merge_group to the workflow", () => {
    expect(page.includes("merge_group")).toBe(true);
  });
});

describe("the read-only trial", () => {
  const page = read("docs/read-only-trial.md");

  // With dashboard.readOnly auto mode only scans (record 0077), and without
  // the issues trigger no edit starts a run.
  test("is a workflow that only scans", () => {
    const shown = all.filter(({ where }) => where.startsWith("docs/read-only-trial.md"));
    expect(shown.length).toBe(1);
    expect(Object.values(shown[0]?.workflow.jobs ?? {}).map(modeOf)).toEqual(["auto"]);
    expect(shown[0]?.workflow.on).not.toHaveProperty("issues");
  });

  // Slice 2.17 (onboarding log, hurdle 16): in the read-only trial a box
  // would do nothing, so the trial turns the boxes off.
  test("turns on dashboard.readOnly, and no longer promises a note", () => {
    const configs = fences(page)
      .filter(({ language, text }) => language === "yaml" && !text.includes("jobs:"))
      .map(({ text }) => parseConfig(text));
    expect(configs.map((config) => config.dashboard.readOnly)).toEqual([true]);
    expect(page).not.toContain("leaves a note");
    expect(page).not.toContain("the next scan clears it and leaves a note");
  });
});

describe("every user doc", () => {
  // Onboarding log, hurdle 8: the workflow file and the config file must not
  // look alike.
  test.each(USER_DOCS)("never names the workflow file sluiceway.yml: %s", (path) => {
    expect(read(path).match(/\.github\/workflows\/sluiceway\.ya?ml/)?.[0]).toBeUndefined();
  });

  // @v0 moves with every release (build plan, section 8). A page that shows it
  // leads a reader who wants to review every update to the pinned commit, in
  // docs/workflow.md since the README rewrite, and on the docs site for the
  // README since slice 5.16.
  test.each(USER_DOCS)("that shows @v0 links to Pin a commit: %s", (path) => {
    const text = read(path);
    if (text.includes("sluiceway/sluiceway@v0"))
      expect(text).toMatch(
        /workflow\.md#pin-a-commit|\/guides\/workflow\/#pin-a-commit|\(#pin-a-commit\)/,
      );
  });

  test.each(USER_DOCS)("has no em-dash: %s", (path) => {
    expect(read(path).includes("\u2014")).toBe(false);
  });

  test.each(USER_DOCS)("has only closed code fences: %s", (path) => {
    const opened = read(path).match(/^```/gm)?.length ?? 0;
    expect(opened % 2).toBe(0);
    expect(fences(read(path)).length).toBe(opened / 2);
  });
});
