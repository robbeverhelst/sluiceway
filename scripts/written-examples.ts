// The examples of docs/what-sluiceway-writes.md (slice 5.33, record 0096):
// what Sluiceway writes for machines, taken from what the code writes and
// never written by hand, as the example dashboard is (record 0088).
//
// A scan previews one stack of the example project, a person ticks it,
// `resolve` hands it on and `apply` deploys it, with the real Pulumi adapter
// replaying what the real CLI printed (record 0001) and the fake GitHub of the
// mode tests. A second run is the same with the deploy that failed. The marker
// kinds that a run of one stack cannot show are lines of the example dashboard,
// and the payloads of the other kinds of record come from the function every
// writer calls, with facts from the example dashboard. `bun run
// example:written` writes them into the page, and a test fails when the page is
// not what this file gives.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { Adapter } from "../src/adapters/adapter.ts";
import type { ProcessRunner } from "../src/adapters/process.ts";
import { pulumi } from "../src/adapters/pulumi/index.ts";
import { deploymentPayload, mergePayload } from "../src/core/deployment.ts";
import { deployFailureText, previewFailureText } from "../src/core/failure-reason.ts";
import type { MatrixEntry } from "../src/core/resolve.ts";
import type { OutputName } from "../src/github/outputs.ts";
import { apply } from "../src/modes/apply.ts";
import { resolve } from "../src/modes/resolve.ts";
import { scan } from "../src/modes/scan.ts";
import { renderRow } from "../src/render/row.ts";
import { replay } from "../test/adapters/pulumi/replay.ts";
import {
  ACTION_REF,
  harness,
  REPO_URL,
  repoRoot,
  SHA,
  stack,
  steppingClock,
} from "../test/modes/harness.ts";
import { type RememberingOutputs, rememberingOutputs } from "../test/modes/outputs-harness.ts";
import {
  ALICE,
  RESOLVE_RUN,
  type ResolveHarness,
  tick,
  WORKFLOW,
  WRITE,
} from "../test/modes/resolve-harness.ts";
import { EXAMPLE_FILE } from "./example-dashboard.ts";
import { FIXTURE_CLI_VERSIONS } from "./fixtures/versions.ts";

export const WRITTEN_PAGE = "docs/what-sluiceway-writes.md";

// The marker keys a writer writes that the page leaves out on purpose (record
// 0096): they may change or go without a new version. The page says why.
export const LEFT_OUT = {
  root: [
    "run-waiting",
    "run-waiting-since",
    "run-waiting-more",
    "scan-running",
    "scan-running-since",
  ],
  row: ["shortened"],
  merge: [],
  waiting: [],
  bulk: ["note", "added", "gone", "moved", "confirm", "stacks", "hashes", "scan-run"],
  rescan: [],
  outside: [],
} as const satisfies Record<string, readonly string[]>;

// Each example and the language of its code block.
const LANGUAGES = {
  "root-marker": "md",
  "row-block": "md",
  "row-markers": "md",
  "drawn-rows": "md",
  "merge-row": "md",
  "waiting-line": "md",
  "bulk-box": "md",
  "confirm-box": "md",
  "rescan-box": "md",
  "outside-line": "md",
  record: "json",
  payloads: "json",
  "scan-result": "json",
  "apply-result": "json",
  "apply-result-failed": "json",
  outputs: "text",
} as const;

export type WrittenExamples = Record<string, string>;

export function exampleNames(examples: WrittenExamples): string[] {
  return Object.keys(examples);
}

const ROOT = resolvePath(import.meta.dir, "..");

// The recordings of the minimum CLI, which change least often.
const VERSION = FIXTURE_CLI_VERSIONS.minimum;
const STACK = "network:dev";

// Where GitHub's hosted Linux runners keep RUNNER_TEMP, in place of the
// directory of this run.
const RUNNER_TEMP = "/home/runner/work/_temp";

// Hands each command to the first recording that holds it.
function inTurn(...runs: ProcessRunner[]): ProcessRunner {
  return async (asked) => {
    for (const run of runs) {
      try {
        return await run(asked);
      } catch {}
    }
    throw new Error(`No recording holds "${asked.argv.join(" ")}".`);
  };
}

interface Run {
  body: string;
  scanOutputs: RememberingOutputs;
  applyOutputs: RememberingOutputs;
  record: string;
}

async function run(scenario: "deploy" | "deploy-failed"): Promise<Run> {
  const root = repoRoot();
  const adapter: Adapter = {
    ...pulumi,
    discover: async () => [stack(STACK)],
    checkVersion: async () => {},
  };
  const scanOutputs = rememberingOutputs();
  const { context, github, log } = harness(adapter, {
    root,
    run: replay(VERSION, scenario, root).run,
    outputs: scanOutputs,
  });
  await scan(context);
  const body = github.issue(1).body;
  github.seedPermission(ALICE.login, WRITE);
  github.seedRun(RESOLVE_RUN, { completed: false });
  tick({ github, number: 1 } as ResolveHarness, ALICE, [STACK]);
  let matrix: MatrixEntry[] = [];
  await resolve({
    root,
    adapter,
    github,
    log,
    repoUrl: REPO_URL,
    runId: RESOLVE_RUN,
    runAttempt: "1",
    sha: SHA,
    actionRef: ACTION_REF,
    event: github.deliverEvent(),
    workflow: WORKFLOW,
    setOutput: (_name, value) => {
      matrix = JSON.parse(value);
    },
  });
  const deployment = matrix[0]?.deployment ?? 0;
  const applyOutputs = rememberingOutputs();
  // The failed deploy previews again after it failed, from a second copy.
  const runner =
    scenario === "deploy"
      ? replay(VERSION, scenario, root).run
      : inTurn(replay(VERSION, scenario, root).run, replay(VERSION, scenario, root).run);
  // The failed deploy fails the job, as it should.
  await apply({
    root,
    env: { PATH: "/usr/bin" },
    mask: () => {},
    adapter,
    run: runner,
    github,
    log,
    previewTimeoutMinutes: 10,
    now: steppingClock(),
    repoUrl: REPO_URL,
    runId: RESOLVE_RUN,
    runAttempt: "1",
    sha: SHA,
    actionRef: ACTION_REF,
    deploymentId: deployment,
    outputs: applyOutputs,
  }).catch(() => {});
  const { task, environment, sha, payload } = github.deployment(deployment);
  const statuses = github
    .deploymentStatuses(deployment)
    .map(({ state, description }) => ({ state, description }));
  return {
    body,
    scanOutputs,
    applyOutputs,
    record: JSON.stringify({ task, environment, sha, payload, statuses }, null, 2),
  };
}

function resultFile(outputs: RememberingOutputs, mode: "scan" | "apply"): string {
  return readFileSync(resolvePath(outputs.directory, `sluiceway-${mode}-result.json`), "utf8");
}

// The last value of every output, in the order they were first set, with the
// directory of the run replaced by the runner's.
function outputLines(outputs: RememberingOutputs): string[] {
  const names = [...new Set(outputs.calls.map(([name]) => name))] as OutputName[];
  return names.map(
    (name) => `${name}=${(outputs.values[name] ?? "").replace(outputs.directory, RUNNER_TEMP)}`,
  );
}

// The row block of a stack, as it stands in a body.
function rowBlock(body: string, stackId: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.includes(`<!-- sluiceway:row stack="${stackId}"`));
  const end = lines.findIndex((line, index) => index > start && line.includes("/sluiceway:row"));
  return lines.slice(start, end + 1).join("\n");
}

// The one line of the example dashboard that holds `marker`.
function lineWith(body: string, marker: string): string {
  const found = body.split("\n").filter((line) => line.includes(marker));
  if (found.length !== 1) throw new Error(`The example dashboard has ${found.length} of ${marker}`);
  return found[0] ?? "";
}

function markerOf(line: string): string {
  return line.slice(line.indexOf("<!-- sluiceway:"));
}

// Two rows a reader draws from facts alone, with the renderer and the reason
// word of record 0110 in place of the reason it does not hold: a preview
// failure row, and an in sync row with a failure line. The stack, the ticker
// and the run are the example dashboard's.
function drawnRows(): string {
  const exampleRepo = "https://github.com/example-org/infra";
  return [
    renderRow({
      state: "preview-failed",
      stackId: "apps/web:staging",
      reason: previewFailureText({ kind: "in-summary" }),
      runUrl: `${exampleRepo}/actions/runs/17034455121`,
    }),
    renderRow({
      state: "in-sync",
      stackId: "apps/web:prod",
      failure: {
        reason: deployFailureText({ kind: "on-record" }),
        ticker: "bob",
        at: new Date("2026-09-20T16:40:03Z"),
        runUrl: `${exampleRepo}/actions/runs/17029855012`,
      },
    }),
  ].join("\n");
}

export async function writtenExamples(): Promise<WrittenExamples> {
  const deployed = await run("deploy");
  const failed = await run("deploy-failed");
  const dashboard = readFileSync(resolvePath(ROOT, EXAMPLE_FILE), "utf8");
  const row = (stackId: string) => markerOf(lineWith(dashboard, `row stack="${stackId}"`));
  // The run of the example dashboard's scan, where these records would sit.
  const exampleRun = "17034455121";
  const payloads = [
    JSON.parse(deployed.record).payload,
    deploymentPayload({
      hash: "1d0a03db50bc7070",
      ticker: "alice",
      run: exampleRun,
      attempt: "1",
      behind: ["infra/network:prod"],
    }),
    deploymentPayload({
      hash: "3317badb7e6c946b",
      ticker: "carol",
      run: exampleRun,
      attempt: "1",
      drift: true,
    }),
    deploymentPayload({
      hash: "ec5ef272e21b14c0",
      ticker: "erin",
      run: exampleRun,
      attempt: "1",
      onMerge: true,
    }),
    deploymentPayload({
      hash: "9b7e1f3c5d2a4068",
      ticker: "frank",
      run: exampleRun,
      attempt: "1",
      window: true,
    }),
    mergePayload({ ticker: "dave", run: exampleRun, attempt: "1", merge: 519 }),
  ];
  return {
    "root-marker": deployed.body.split("\n")[0] ?? "",
    "row-block": rowBlock(deployed.body, STACK),
    "row-markers": [
      row("apps/api:prod"),
      row("apps/worker:prod"),
      row("apps/billing:prod"),
      row("infra/network:prod"),
      row("apps/legacy-worker:prod"),
      row("monitoring/grafana:prod"),
      row("platform/external-dns:prod"),
      row("apps/auth:prod"),
    ].join("\n"),
    "drawn-rows": drawnRows(),
    "merge-row": lineWith(dashboard, "<!-- sluiceway:merge "),
    "waiting-line": lineWith(dashboard, "<!-- sluiceway:waiting "),
    "bulk-box": lineWith(dashboard, '<!-- sluiceway:bulk section="pending"'),
    "confirm-box": lineWith(dashboard, '<!-- sluiceway:bulk section="drift" confirm='),
    "rescan-box": lineWith(dashboard, "<!-- sluiceway:rescan -->"),
    "outside-line": lineWith(dashboard, "<!-- sluiceway:outside "),
    record: deployed.record,
    payloads: payloads.map((payload) => JSON.stringify(payload)).join("\n"),
    "scan-result": resultFile(deployed.scanOutputs, "scan").trimEnd(),
    "apply-result": resultFile(deployed.applyOutputs, "apply").trimEnd(),
    "apply-result-failed": resultFile(failed.applyOutputs, "apply").trimEnd(),
    outputs: [
      "# scan",
      ...outputLines(deployed.scanOutputs),
      "# apply",
      ...outputLines(deployed.applyOutputs),
    ].join("\n"),
  };
}

// The page with every example block written again from `examples`: the fence
// between `<!-- example: <name> -->` and `<!-- /example -->`.
export function withExamples(page: string, examples: WrittenExamples): string {
  return page.replace(
    /^<!-- example: ([\w-]+) -->\n[\s\S]*?^<!-- \/example -->$/gm,
    (whole, name: string) => {
      const text = examples[name];
      const language = LANGUAGES[name as keyof typeof LANGUAGES];
      if (text === undefined || language === undefined) return whole;
      return `<!-- example: ${name} -->\n\`\`\`${language}\n${text}\n\`\`\`\n<!-- /example -->`;
    },
  );
}

if (import.meta.main) {
  const file = resolvePath(ROOT, WRITTEN_PAGE);
  writeFileSync(file, withExamples(readFileSync(file, "utf8"), await writtenExamples()));
  console.log(`Wrote the examples of ${WRITTEN_PAGE}`);
}
