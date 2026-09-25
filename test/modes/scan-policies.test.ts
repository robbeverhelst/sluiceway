import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PreviewResult } from "../../src/adapters/adapter.ts";
import type { ProcessRunner, Run, RunResult } from "../../src/adapters/process.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  change,
  dashboardBody,
  harness,
  inSync,
  pending,
  RUN_ID,
  SHA,
  tableAdapter,
} from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";

// Slice 5.41 (record 0106): a scan with policies runs conftest over the
// preview document of every pending stack, right after its preview. A policy
// that fails takes the box off the row, is named on the row and the page, and
// stops a deploy on merge. A run that failed is a warning line, and the row
// keeps its box.

const FIXTURES = join(import.meta.dir, "../fixtures/conftest/v0.70.1");

function recorded(scenario: string): RunResult {
  const { exitCode, stdout, stderr } = JSON.parse(
    readFileSync(join(FIXTURES, scenario, "recording.json"), "utf8"),
  ) as { exitCode: number; stdout: string; stderr: string };
  return { status: "exited", exitCode, stdout, stderr };
}

// A pending stack whose preview document names it, so the conftest fake can
// answer per stack.
function withDocument(result: PreviewResult, id: string): PreviewResult {
  return result.ok
    ? { ...result, document: { text: JSON.stringify({ stack: id }), format: "json" } }
    : result;
}

// A conftest on the runner: the version, and per stack the recording the
// table names, found from the document it was handed.
function conftest(
  answers: Record<string, string>,
  options: { version?: RunResult | undefined } = {},
): { run: ProcessRunner; runs: Run[]; documents: string[] } {
  const runs: Run[] = [];
  const documents: string[] = [];
  const run: ProcessRunner = async (one) => {
    runs.push(one);
    if (one.argv[0] !== "conftest") throw new Error(`Not conftest: ${one.argv.join(" ")}`);
    if (one.argv[1] === "--version") return options.version ?? recorded("version");
    const text = readFileSync(one.argv[one.argv.length - 1] ?? "", "utf8");
    documents.push(text);
    const { stack } = JSON.parse(text) as { stack: string };
    const scenario = answers[stack];
    if (scenario === undefined) throw new Error(`No conftest answer for ${stack}.`);
    return recorded(scenario);
  };
  return { run, runs, documents };
}

const CONFIG = "policies: [policies]\n";

function rows(body: string) {
  return Object.fromEntries(
    parseDashboard(body).rows.map((row) => [
      row.stackId,
      {
        state: row.state,
        text: row.text,
        ticked: row.known && row.ticked,
        policyFailed: row.known ? row.policyFailed : undefined,
      },
    ]),
  );
}

async function scanned(
  table: Record<string, PreviewResult>,
  answers: Record<string, string>,
  options: {
    config?: string;
    version?: RunResult;
    event?: string;
    mergedBy?: string;
    policyDirs?: string[];
  } = {},
) {
  const outputs = rememberingOutputs();
  const fake = conftest(answers, { version: options.version });
  const adapter = tableAdapter(
    Object.fromEntries(Object.entries(table).map(([id, result]) => [id, withDocument(result, id)])),
  );
  const { context, github, log } = harness(adapter, {
    config: options.config ?? CONFIG,
    outputs,
    run: fake.run,
    env: { PATH: "/usr/bin", HOME: "/home/runner", INPUT_GITHUB_TOKEN: "secret" },
    ...(options.event === undefined ? {} : { event: options.event }),
    ...(options.mergedBy === undefined ? {} : { mergedBy: options.mergedBy }),
  });
  // The policy directories the config names have to be in the checkout.
  const { mkdirSync } = await import("node:fs");
  for (const dir of options.policyDirs ?? ["policies"]) {
    mkdirSync(join(context.root, dir), { recursive: true });
  }
  github.seedRun(RUN_ID, { completed: false });
  await scan(context);
  return { github, log, outputs, adapter, conftest: fake, body: dashboardBody(github) };
}

describe("a scan with policies", () => {
  test("a failed policy takes the box off the row and names the policy, and the page says so", async () => {
    const {
      body,
      github,
      log,
      conftest: fake,
      adapter,
    } = await scanned(
      { "app:prod": pending("app:prod", change("motd")), "site:prod": inSync("site:prod") },
      { "app:prod": "failures" },
    );
    const app = rows(body)["app:prod"];
    expect(app?.state).toBe("pending");
    expect(app?.policyFailed).toBe(true);
    expect(app?.text).toStartWith("- **app:prod** · 1 update");
    expect(app?.text).toContain(
      ":no_entry: **3 policies failed**, so this change has no box until it passes:",
    );
    expect(app?.text).toContain(
      ":no_entry: <code>main</code> · urn:pulumi:prod::app::aws:s3/bucket:Bucket::uploads must not be deleted",
    );
    // The message with markup, escaped, and its line break gone.
    expect(app?.text).toContain(
      ":no_entry: <code>prod</code> · no deletes in prod &lt;b&gt;bold&lt;/b&gt; &#42;star&#42; &#91;link&#93;(https&#58;//example.com) <span>#</span>123 <span>@</span>alice &#96;tick&#96; line one line two",
    );
    // The page names them too, before the changes.
    const page = github.checkRuns(SHA).find(({ name }) => name === "sluiceway / app:prod");
    expect(page?.output.summary).toContain(":no_entry: **3 policies failed**");
    expect(page?.output.text).toStartWith("- :no_entry: <code>main</code> · urn:pulumi");
    expect(page?.output.text).toContain("- :warning: <code>main</code> · urn:pulumi");
    // Only the pending stack was tested, with its own document, and the
    // adapter was asked for the document of every previewed stack.
    expect(fake.runs.map(({ argv }) => argv[1])).toEqual(["--version", "test"]);
    expect(fake.documents).toEqual([JSON.stringify({ stack: "app:prod" })]);
    expect(adapter.documentAsked).toEqual({ "app:prod": true, "site:prod": true });
    // The job log: the stack's group holds the failures and the tool's
    // words, and a line says the box is off. No warning: it is on the
    // dashboard.
    const group = log.groups.find((one) => one.title === "app:prod");
    expect(group?.lines).toContain("policies: 3 failed, 1 warning, 1 passed");
    expect(group?.lines).toContain(
      "  failed: main: urn:pulumi:prod::app::aws:s3/bucket:Bucket::uploads must not be deleted",
    );
    expect(log.warnings).toEqual([]);
    expect(log.lines).toContain(
      "Ran the policies of app:prod in 1.0 s: 3 policies failed, so its row has no box.",
    );
  });

  test("a pass leaves the row as it was, and the page says every policy passed", async () => {
    const { body, github, log } = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      { "app:prod": "pass" },
    );
    const app = rows(body)["app:prod"];
    expect(app?.text).toStartWith("- [ ] **app:prod** · 1 update");
    expect(app?.text).not.toContain("polic");
    expect(app?.policyFailed).toBeUndefined();
    const page = github.checkRuns(SHA).find(({ name }) => name === "sluiceway / app:prod");
    expect(page?.output.summary).toContain(
      "Every policy passed: 5 rules in main, manifests and prod.",
    );
    expect(log.lines).toContain("Ran the policies of app:prod in 0.5 s: every policy passed.");
    expect(log.lines).toContain("conftest 0.70.1 runs the policies: policies.");
  });

  test("a run that failed is a warning line on the row and on the run, and the box stays", async () => {
    const { body, log } = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      { "app:prod": "broken-policy" },
    );
    const app = rows(body)["app:prod"];
    expect(app?.text).toStartWith("- [ ] **app:prod** · 1 update");
    expect(app?.text).toContain(
      ":warning: the policies did not run: conftest exited with an error (exit code 1). Nothing was checked",
    );
    expect(app?.policyFailed).toBeUndefined();
    expect(log.warnings).toEqual([
      {
        title: "Policies did not run",
        message:
          "The policies of app:prod did not run: conftest exited with an error (exit code 1). Nothing was checked, and its row keeps its box. The tool's own words are in the group of the stack.",
      },
    ]);
    const group = log.groups.find((one) => one.title === "app:prod");
    expect(group?.lines.join("\n")).toContain("rego_parse_error");
  });

  test("conftest that is missing or too old is checked once, and every stack's policies did not run", async () => {
    const missing = await scanned(
      {
        "app:prod": pending("app:prod", change("motd")),
        "web:prod": pending("web:prod", change("index")),
      },
      {},
      { version: { status: "not-started" } },
    );
    expect(missing.conftest.runs.map(({ argv }) => argv[1])).toEqual(["--version"]);
    for (const id of ["app:prod", "web:prod"]) {
      expect(rows(missing.body)[id]?.text).toContain(
        ":warning: the policies did not run: conftest is not installed on the runner.",
      );
    }
    expect(missing.log.warnings.map(({ message }) => message)).toEqual([
      "The policies did not run: conftest is not installed on the runner. Nothing was checked, and every pending row keeps its box. Install conftest 0.50.0 or newer in a step before Sluiceway, or take policies out of sluiceway.yaml.",
    ]);

    const old = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      {},
      { version: { status: "exited", exitCode: 0, stdout: "Conftest: 0.49.1\n", stderr: "" } },
    );
    expect(rows(old.body)["app:prod"]?.text).toContain(
      "conftest 0.49.1 is older than the 0.50.0 Sluiceway needs",
    );
  });

  test("a policy path the checkout does not hold is said in Sluiceway's words", async () => {
    const { body, conftest: fake } = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      {},
      { config: "policies: [policies, policies/prod]\n" },
    );
    expect(rows(body)["app:prod"]?.text).toContain(
      ":warning: the policies did not run: the policy path policies/prod is not in the repo.",
    );
    expect(fake.runs.map(({ argv }) => argv[1])).toEqual(["--version"]);
  });

  test("without policies nothing changes: no conftest, no document asked", async () => {
    const {
      conftest: fake,
      adapter,
      body,
    } = await scanned({ "app:prod": pending("app:prod", change("motd")) }, {}, { config: "" });
    expect(fake.runs).toEqual([]);
    expect(adapter.documentAsked).toEqual({ "app:prod": undefined });
    expect(rows(body)["app:prod"]?.text).toStartWith("- [ ] **app:prod**");
  });

  test("only the stacks with policies are tested, with their own paths, and conftest gets the job's environment minus INPUT_*", async () => {
    const { conftest: fake } = await scanned(
      {
        "app:prod": pending("app:prod", change("motd")),
        "web:prod": pending("web:prod", change("index")),
      },
      { "web:prod": "pass" },
      {
        config: "stacks:\n  - path: web\n    policies: [policies/web]\n",
        policyDirs: ["policies/web"],
      },
    );
    expect(fake.documents).toEqual([JSON.stringify({ stack: "web:prod" })]);
    const [, tested] = fake.runs;
    expect(tested?.argv.slice(6, 8)).toEqual(["--policy", "policies/web"]);
    expect(tested?.env).toEqual({ PATH: "/usr/bin", HOME: "/home/runner" });
    expect(tested?.timeoutMs).toBe(600_000);
  });

  test("a stack in sync, and one whose preview failed, is not tested", async () => {
    const { conftest: fake } = await scanned(
      {
        "app:prod": inSync("app:prod"),
        "web:prod": {
          ok: false,
          reason: { kind: "tool-error", exitCode: 1 },
          detail: [],
          toolLog: "",
        },
      },
      {},
    );
    expect(fake.runs.map(({ argv }) => argv[1])).toEqual(["--version"]);
  });

  test("the summary names the failures too", async () => {
    const { log } = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      { "app:prod": "failures" },
    );
    expect(log.summaries.at(-1)).toContain(
      ":no_entry: **3 policies failed**, so the row has no box until it passes:",
    );
  });

  test("the pending count still counts a stack a policy stopped", async () => {
    const { outputs } = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      { "app:prod": "failures" },
    );
    expect(outputs.values.pending).toBe("1");
  });
});

describe("deploy on merge with policies", () => {
  test("a failed policy stops the deploy outright, and the log says so", async () => {
    const { outputs, github, body, log } = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      { "app:prod": "failures" },
      {
        config: "policies: [policies]\nstacks:\n  - path: app\n    deploy: on-merge\n",
        event: "push",
        mergedBy: "alice",
      },
    );
    expect(JSON.parse(outputs.values.matrix ?? "[]")).toEqual([]);
    expect(github.deploymentsOf("sluiceway")).toEqual([]);
    const app = rows(body)["app:prod"];
    expect(app?.state).toBe("pending");
    expect(app?.policyFailed).toBe(true);
    expect(app?.text).not.toContain("this stack deploys on merge");
    expect(log.lines).toContain(
      "app:prod deploys on merge, and this change does not: 3 policies failed.",
    );
  });

  test("a stack that depends on one a policy stopped waits, as it waits on any change nobody ticked", async () => {
    const { outputs, body } = await scanned(
      {
        "app:prod": pending("app:prod", change("motd")),
        "network:prod": pending("network:prod", change("vpc")),
      },
      { "app:prod": "pass", "network:prod": "failures" },
      {
        config:
          "policies: [policies]\nstacks:\n  - path: app\n    deploy: on-merge\n    dependsOn: [network:prod]\n",
        event: "push",
        mergedBy: "alice",
      },
    );
    expect(JSON.parse(outputs.values.matrix ?? "[]")).toEqual([]);
    expect(rows(body)["app:prod"]?.text).toContain(
      "it depends on **network:prod**, which has a change waiting",
    );
  });

  test("a pass deploys on merge as before", async () => {
    const { outputs } = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      { "app:prod": "pass" },
      {
        config: "policies: [policies]\nstacks:\n  - path: app\n    deploy: on-merge\n",
        event: "push",
        mergedBy: "alice",
      },
    );
    expect(JSON.parse(outputs.values.matrix ?? "[]")).toEqual([
      { stack: "app:prod", environment: "sluiceway", deployment: 1 },
    ]);
  });
});
