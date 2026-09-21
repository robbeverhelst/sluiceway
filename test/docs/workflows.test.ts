import { describe, expect, test } from "bun:test";
import { parseConfig } from "../../src/core/config.ts";
import { MODES } from "../../src/mode.ts";
import {
  EXAMPLE_WORKFLOWS,
  fences,
  isSluiceway,
  modeOf,
  read,
  USER_DOCS,
  workflows,
} from "./docs.ts";

// Slice 2.10: a stranger sets Sluiceway up from the README alone, so every
// workflow the docs show has to work as written. These tests hold each one to
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
  test("there are some to check: the README's, and one example per setup", () => {
    expect(all.filter(({ where }) => where.startsWith("README.md")).length).toBeGreaterThanOrEqual(
      3,
    );
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

  test("every Sluiceway step names a mode that exists", () => {
    const wrong = steps
      .filter(({ step }) => !(MODES as readonly string[]).includes(String(step.with?.mode)))
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

  // A scan writes the dashboard from the code it checked out. On a pull request
  // or in a merge queue that is code that is not on the default branch.
  test("a workflow that scans never runs on pull requests or in a merge queue", () => {
    const wrong = all
      .filter(({ workflow }) => Object.values(workflow.jobs).some((job) => modeOf(job) !== "check"))
      .filter(({ workflow }) =>
        ["pull_request", "pull_request_target", "merge_group"].some(
          (event) => event in workflow.on,
        ),
      )
      .map(({ where }) => where);
    expect(wrong).toEqual([]);
  });

  // Record 0042: the check reads files and nothing else.
  test("a check workflow asks for contents: read and nothing more", () => {
    const checks = all.filter(({ workflow }) =>
      Object.values(workflow.jobs).every((job) => modeOf(job) === "check"),
    );
    expect(checks.length).toBeGreaterThan(0);
    for (const { workflow } of checks) {
      expect(workflow.permissions).toEqual({ contents: "read" });
    }
  });
});

describe("a workflow that deploys", () => {
  const deploying = all.filter(({ workflow }) =>
    Object.values(workflow.jobs).some((job) => modeOf(job) === "resolve"),
  );

  test("there are some to check", () => {
    expect(deploying.length).toBeGreaterThanOrEqual(4);
  });

  // The sweep only knows the runs of its own workflow file (slice 2.7), and the
  // rescan box and settle dispatch that same file (records 0009, 0035).
  test.each(deploying)("has all four jobs in one file: $where", ({ workflow }) => {
    const modes = Object.values(workflow.jobs).map(modeOf);
    expect(modes).toEqual(expect.arrayContaining(["scan", "resolve", "apply", "settle"]));
  });

  test.each(deploying)("listens to issue edits and to dispatch: $where", ({ workflow }) => {
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on.issues).toEqual({ types: ["edited"] });
    expect(workflow.on).toHaveProperty("schedule");
  });

  test.each(deploying)("has the permissions of the README's block: $where", ({ workflow }) => {
    expect(workflow.permissions).toEqual({
      contents: "read",
      issues: "write",
      deployments: "write",
      actions: "write",
      "pull-requests": "read",
    });
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

  // Record 0014, promise 4: the job an issue edit starts holds no credentials.
  test.each(deploying)(
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
  test.each(deploying)("apply queues and runs when resolve was red: $where", ({ workflow }) => {
    const apply = Object.values(workflow.jobs).find((job) => modeOf(job) === "apply");
    expect(apply?.if).toContain("!cancelled()");
    expect(apply?.concurrency).toEqual({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a template.
      group: "sluiceway-apply-${{ matrix.stack }}",
      queue: "max",
    });
  });

  test.each(deploying)("scans and resolves one at a time: $where", ({ workflow }) => {
    const byMode = (mode: string) =>
      Object.values(workflow.jobs).find((job) => modeOf(job) === mode)?.concurrency;
    expect(byMode("scan")).toBe("sluiceway-scan");
    expect(byMode("resolve")).toBe("sluiceway-resolve");
  });
});

describe("the README", () => {
  const readme = read("README.md");

  test("has no warning box any more", () => {
    expect(readme.includes("[!WARNING]")).toBe(false);
  });

  // Record 0042: the setup starts with the check.
  test("shows the check before any workflow that previews or deploys", () => {
    const modes = all
      .filter(({ where }) => where.startsWith("README.md"))
      .flatMap(({ workflow }) => Object.values(workflow.jobs).map(modeOf));
    expect(modes[0]).toBe("check");
  });

  // Onboarding log, hurdle 8.
  test("has the table of what goes where", () => {
    expect(readme.includes("| `sluiceway.yaml` |")).toBe(true);
  });

  test("says not to add merge_group to the workflow", () => {
    expect(readme.includes("merge_group")).toBe(true);
  });

  // Slice 2.17 (onboarding log, hurdle 16): in the read-only trial a box
  // would do nothing, so the trial turns the boxes off.
  test("the read-only trial turns on dashboard.readOnly, and no longer promises a note", () => {
    const section = readme.slice(
      readme.indexOf("### Start read only"),
      readme.indexOf("\n## ", readme.indexOf("### Start read only")),
    );
    const configs = fences(section)
      .filter(({ language, text }) => language === "yaml" && !text.includes("jobs:"))
      .map(({ text }) => parseConfig(text));
    expect(configs.map((config) => config.dashboard.readOnly)).toEqual([true]);
    expect(section).not.toContain("leaves a note");
    expect(readme).not.toContain("the next scan clears it and leaves a note");
  });
});

describe("every user doc", () => {
  // Onboarding log, hurdle 8: the workflow file and the config file must not
  // look alike.
  test.each(USER_DOCS)("never names the workflow file sluiceway.yml: %s", (path) => {
    expect(read(path).match(/\.github\/workflows\/sluiceway\.ya?ml/)?.[0]).toBeUndefined();
  });

  // @v0 moves with every release (build plan, section 8). A page that shows it
  // leads a reader who wants to review every update to the pinned commit.
  test.each(USER_DOCS)("that shows @v0 links to Pin a commit: %s", (path) => {
    const text = read(path);
    if (text.includes("sluiceway/sluiceway@v0")) expect(text.includes("#pin-a-commit")).toBe(true);
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
