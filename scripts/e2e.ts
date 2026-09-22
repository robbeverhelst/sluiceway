// The end to end run (build plan, section 6): the committed bundle, started the
// way a runner starts a step, scans a copy of examples/pulumi-basic with the
// pulumi CLI on PATH, writes its dashboard to the fake GitHub server, and then
// goes round the whole loop: a tick, resolve, apply and settle.
//
//   bun run e2e [--work-dir <dir>] [--expect-version v3.229.0]
//
// Two scans, both after a push:
//   1. The first one finds no dashboard, so it is a full scan. One stack was
//      deployed before it, so the dashboard holds pending rows and one in sync.
//   2. The second follows a push that changed shared/motd.txt, which only
//      app:prod claims, through `inputs` in sluiceway.yaml. It is a narrowed
//      scan: one preview, one fresh row, every other row carried through.
//
// Then the loop, each tick a run of its own with the `issues` event:
//   3. A person without write access ticks network:dev. The tick is refused.
//   4. A person with write access ticks network:dev. resolve hands on a
//      record, apply deploys the stack with the real tool, settle finds
//      nothing open. Then the apply job is re-run, and deploys nothing.
//   5. site:prod is ticked and its apply job never starts, as when it is
//      cancelled. settle ends the record and starts a full scan, which shows
//      network:dev in sync and site:prod with a failure line.
//   6. site:prod is ticked again and deployed by hand before its apply job
//      starts. The fresh preview has nothing to deploy: nothing goes out, the
//      record ends as success that says so, and the job is green.
//   7. A last full scan: every stack in sync, and no failure line left.
//   8. The same scan once more, started the way a runner starts
//      `uses: sluiceway/sluiceway@v0`: from a copy of the action in a
//      directory of its own, with the moving tag as its ref and no
//      GITHUB_ACTION_PATH. Its images come from the tag of package.json.
//
// The tool only runs in a copy inside the work directory, against a file
// backend made there, with an environment built from nothing. `node` on PATH
// has to be the version that action.yml names, because it stands in for the
// runner's own.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type FakeCheckRun, FakeGitHub } from "../test/fake-github/fake-github.ts";
import { startFakeGitHubServer } from "../test/fake-github/server.ts";
import { checkFullScan, checkNarrowedScan, type Expected, type Observed } from "./e2e/checks.ts";
import {
  checkApply,
  checkNothingLeaks,
  checkRefusedTick,
  checkRerun,
  checkResolve,
  checkRowFacts,
  checkSettle,
  type LoopRecord,
  type LoopStep,
  type MatrixEntry,
  matrixEntries,
  tickRow,
} from "./e2e/loop.ts";
import { type ActionMetadata, readStepOutputs, stepEnvironment } from "./e2e/step.ts";
import { CANARY_SECRET, CANARY_VALUE, EXAMPLE_PASSPHRASE } from "./fixtures/example.ts";

const REPO = resolve(import.meta.dir, "..");

const { values } = parseArgs({
  options: {
    "work-dir": { type: "string", default: join(tmpdir(), "sluiceway-e2e") },
    "expect-version": { type: "string" },
  },
});

const work = resolve(values["work-dir"]);
const workspace = join(work, "repo");
const backend = join(work, "backend");
const temp = join(work, "temp");

// What the workflow of a real repo prepares for the job: the tool on PATH, a
// backend and a passphrase. Only PATH comes from whoever runs this.
const jobEnvironment: Record<string, string> = {
  PATH: process.env.PATH ?? "",
  HOME: join(work, "home"),
  USER: "sluiceway",
  PULUMI_BACKEND_URL: `file://${backend}`,
  PULUMI_HOME: join(work, "pulumi-home"),
  PULUMI_CONFIG_PASSPHRASE: EXAMPLE_PASSPHRASE,
  PULUMI_SKIP_UPDATE_CHECK: "true",
  NO_COLOR: "1",
};

interface Ran {
  exitCode: number;
  output: string;
}

// Runs a command and gives back everything it printed, in the order it came.
function run(argv: string[], cwd: string, env: Record<string, string>): Promise<Ran> {
  const [command = "", ...args] = argv;
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", fail);
    child.on("close", (code, signal) =>
      done({
        exitCode: code ?? (signal === null ? 1 : 128),
        output: Buffer.concat(chunks).toString("utf8"),
      }),
    );
  });
}

async function prepare(argv: string[], dir: string): Promise<string> {
  console.log(`$ ${argv.join(" ")}  (in ${dir})`);
  const ran = await run(argv, join(workspace, dir), jobEnvironment);
  if (ran.exitCode !== 0) {
    throw new Error(`"${argv.join(" ")}" ended with exit code ${ran.exitCode}.\n${ran.output}`);
  }
  return ran.output;
}

const QUIET = ["--non-interactive", "--color", "never"];
const init = (dir: string, stack: string) =>
  prepare(["pulumi", "stack", "init", stack, ...QUIET], dir);
const deploy = (dir: string, stack: string) =>
  prepare(["pulumi", "up", "--yes", "--skip-preview", ...QUIET, "--stack", stack], dir);

const action = Bun.YAML.parse(readFileSync(join(REPO, "action.yml"), "utf8")) as ActionMetadata;

// The runner starts the bundle on its own Node. Here `node` on PATH stands in
// for it, so it has to be the same major version.
async function checkNode(): Promise<void> {
  const { output } = await run(["node", "--version"], REPO, jobEnvironment);
  const major = /^v(\d+)\./.exec(output.trim())?.[1];
  if (`node${major}` !== action.runs.using) {
    throw new Error(
      `action.yml runs on ${action.runs.using}, and "node" on PATH is ${output.trim()}. Put Node ${action.runs.using.replace("node", "")} first on PATH.`,
    );
  }
}

async function checkTool(): Promise<void> {
  const version = (await run(["pulumi", "version"], REPO, jobEnvironment)).output.trim();
  console.log(`pulumi ${version}`);
  const expected = values["expect-version"];
  if (expected && version !== expected) {
    throw new Error(`Expected pulumi ${expected} on PATH, found ${version}.`);
  }
}

const fake = new FakeGitHub();

interface StepOptions {
  inputs?: Record<string, string>;
  runId: string;
  runAttempt?: string;
  sha: string;
  event: string;
  // The payload the runner writes for the event, when the mode reads one.
  payload?: unknown;
  title: string;
  // How the step names the action, and the directory the runner downloaded
  // it to. Without it the step is `uses: ./`, the checked out repo.
  action?: { ref: string; dir: string };
}

interface Stepped extends Observed {
  outputs: Record<string, string>;
}

// One step of `uses: ./` or of a downloaded action, with only the inputs given here set, so every other
// input is the default of action.yml.
let stepNumber = 0;
async function step(mode: string, options: StepOptions): Promise<Stepped> {
  stepNumber++;
  const summaryFile = join(temp, `summary-${stepNumber}.md`);
  const outputFile = join(temp, `output-${stepNumber}`);
  writeFileSync(summaryFile, "");
  writeFileSync(outputFile, "");
  let eventPath: string | undefined;
  if (options.payload !== undefined) {
    eventPath = join(temp, `event-${stepNumber}.json`);
    writeFileSync(eventPath, JSON.stringify(options.payload));
  }
  const server = await startFakeGitHubServer(fake);
  const requestsBefore = fake.requests.length;
  // A page the step writes has links of its own run, so a page it updated
  // differs from what was there before (record 0050).
  const pageText = (page: FakeCheckRun) => JSON.stringify(page);
  const pagesBefore = new Set(fake.checkRuns(options.sha).map(pageText));
  try {
    const env = stepEnvironment(
      action,
      { mode, ...options.inputs },
      {
        workspace,
        repository: "acme/infra",
        apiUrl: server.url,
        runId: options.runId,
        jobId: String(9000 + stepNumber),
        sha: options.sha,
        event: options.event,
        token: "not-a-token",
        summaryFile,
        temp,
        outputFile,
        ...(options.runAttempt === undefined ? {} : { runAttempt: options.runAttempt }),
        ...(eventPath === undefined ? {} : { eventPath }),
        ...(options.action === undefined
          ? {}
          : { action: { ref: options.action.ref, repository: "sluiceway/sluiceway" } }),
      },
      jobEnvironment,
    );
    const actionDir = options.action?.dir ?? REPO;
    const ran = await run(["node", join(actionDir, action.runs.main)], workspace, env);
    console.log(`::group::${options.title}: what the step printed`);
    // The step's own groups would end this one, and its annotations would
    // become annotations of this run.
    console.log(ran.output.replace(/^::/gm, ": :"));
    console.log("::endgroup::");
    // Looking at the fake counts as requests too, so the step's own are set
    // apart first.
    const requests = fake.requests.slice(requestsBefore);
    const issues = [
      ...(await fake.listIssues({ label: "sluiceway", state: "open" })),
      ...(await fake.listIssues({ label: "sluiceway", state: "closed" })),
    ];
    return {
      exitCode: ran.exitCode,
      log: ran.output,
      summary: readFileSync(summaryFile, "utf8"),
      issues,
      pinned: fake.pinned,
      requests,
      pages: fake.checkRuns(options.sha).map((page) => ({
        name: page.name,
        htmlUrl: page.htmlUrl,
        output: `${page.output.title}\n${page.output.summary}\n${page.output.text}`,
        written: !pagesBefore.has(pageText(page)),
      })),
      outputs: readStepOutputs(readFileSync(outputFile, "utf8")),
    };
  } finally {
    await server.close();
  }
}

// A scan of a push, a schedule or a dispatch. Each is a run of its own.
let runNumber = 0;
function scanStep(sha: string, event = "push", action?: StepOptions["action"]): Promise<Stepped> {
  runNumber++;
  const from = action === undefined ? "" : `, from ${action.ref}`;
  return step("scan", {
    runId: String(runNumber),
    sha,
    event,
    title: `Scan ${runNumber}${from}`,
    ...(action === undefined ? {} : { action }),
  });
}

function report(title: string, problems: string[]): boolean {
  if (problems.length === 0) {
    console.log(`${title}: good.`);
    return true;
  }
  console.log(`${title}: ${problems.length} ${problems.length === 1 ? "problem" : "problems"}.`);
  for (const problem of problems) console.log(`::error title=${title}::${problem}`);
  return false;
}

function dashboardBody(observed: Observed): string {
  return observed.issues.find((issue) => issue.state === "open")?.body ?? "";
}

await checkNode();
await checkTool();

rmSync(work, { recursive: true, force: true });
for (const dir of [backend, temp, jobEnvironment.HOME ?? ""]) mkdirSync(dir, { recursive: true });
cpSync(join(REPO, "examples/pulumi-basic"), workspace, { recursive: true });

// What a repo looks like before its first scan: dependencies installed, every
// stack known to the backend, and one of them deployed. The playground stack
// is left alone, because sluiceway.yaml ignores it and no preview may reach it.
console.log("::group::Preparing the example project");
await prepare(["npm", "ci", "--no-audit", "--no-fund"], "site");
await init("network", "dev");
await init("network", "prod");
await init("app", "prod");
await init("site", "prod");
await deploy("network", "prod");
console.log("::endgroup::");

const FIRST_SHA = "1111111111111111111111111111111111111111";
const SECOND_SHA = "2222222222222222222222222222222222222222";

const expected: Expected = {
  rows: {
    "app:prod": "pending",
    "network:dev": "pending",
    "network:prod": "in-sync",
    "site:prod": "pending",
  },
  label: "sluiceway",
  title: "Sluiceway dashboard",
  sha: FIRST_SHA,
  // A local action has no ref, so its images come from the commit of the run.
  actionRef: FIRST_SHA,
  secrets: [CANARY_VALUE, CANARY_SECRET],
};

// The history of the repo, for attribution (record 0026): the example came
// in with one direct push, and a merged pull request changed
// shared/motd.txt.
const example = join(REPO, "examples/pulumi-basic");
const exampleFiles = readdirSync(example, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && !entry.parentPath.includes("node_modules"))
  .map((entry) => relative(example, join(entry.parentPath, entry.name)))
  .sort();
fake.seedCommit({ sha: FIRST_SHA, author: "dana", files: exampleFiles });
fake.seedCommit({
  sha: SECOND_SHA,
  parents: [FIRST_SHA],
  author: "erin",
  files: ["shared/motd.txt"],
});
fake.seedPullRequest({
  number: 7,
  title: "Change the message of the day",
  author: "erin",
  files: ["shared/motd.txt"],
  commits: [SECOND_SHA],
});

const first = await scanStep(FIRST_SHA);
let good = report("The full scan", checkFullScan(first, expected));

// Someone deploys app:prod by hand and then pushes a change to the file it
// reads. The push is what the fake knows about the two commits.
console.log("::group::Deploying app:prod and pushing a change to shared/motd.txt");
await deploy("app", "prod");
fake.seedComparison(FIRST_SHA, SECOND_SHA, {
  status: "ahead",
  files: [{ path: "shared/motd.txt" }],
});
console.log("::endgroup::");

const second = await scanStep(SECOND_SHA);
good =
  report(
    "The narrowed scan",
    checkNarrowedScan(
      second,
      {
        ...expected,
        sha: SECOND_SHA,
        actionRef: SECOND_SHA,
        rows: { ...expected.rows, "app:prod": "in-sync" },
      },
      { previewed: ["app:prod"], before: dashboardBody(first) },
    ),
  ) && good;

// The loop (build plan, slice 2.9). Every tick is an edit by a person, and
// the edit starts a run of the workflow with the `issues` event: `resolve`,
// then one `apply` per matrix entry, then `settle`, all with the run id of
// that run, and each only when the `if:` of its job in the README's workflow
// would let it start.
const WORKFLOW = "sluiceway.yml";
const ALICE = { login: "alice", type: "User" };
const CAROL = { login: "carol", type: "User" };
// alice has write access, so the default tick rule lets her tick. carol can
// read the repo and nothing more.
fake.seedPermission(ALICE.login, { push: true, maintain: false, admin: false });
fake.seedPermission(CAROL.login, { push: false, maintain: false, admin: false });

function records(): LoopRecord[] {
  const found: LoopRecord[] = [];
  // The fake numbers its records from 1, and a number it never gave is
  // unknown to it.
  for (let id = 1; ; id++) {
    let record: ReturnType<FakeGitHub["deployment"]>;
    try {
      record = fake.deployment(id);
    } catch {
      return found;
    }
    const statuses = fake.deploymentStatuses(id);
    found.push({
      id,
      task: record.task,
      environment: record.environment,
      payload: record.payload,
      states: statuses.map(({ state }) => state),
      description: statuses.at(-1)?.description ?? "",
    });
  }
}

// A step of the loop, with what it left behind in GitHub.
async function loopStep(mode: string, options: StepOptions): Promise<LoopStep> {
  const commentsBefore = fake.comments(1).length;
  const dispatchesBefore = fake.dispatches.length;
  const stepped = await step(mode, options);
  return {
    exitCode: stepped.exitCode,
    log: stepped.log,
    summary: stepped.summary,
    outputs: stepped.outputs,
    body: dashboardBody(stepped),
    newComments: fake.comments(1).slice(commentsBefore),
    records: records(),
    requests: stepped.requests,
    newDispatches: fake.dispatches.length - dispatchesBefore,
  };
}

interface IssuesRun {
  runId: string;
  // The payload of the edit, which the runner hands every job of the run.
  payload: unknown;
  resolved: LoopStep;
  matrix: MatrixEntry[];
}

// A person ticks the box of a stack, and the edit starts a run.
async function tick(stack: string, person: { login: string; type: string }): Promise<IssuesRun> {
  const [dashboard] = await fake.listIssues({ label: "sluiceway", state: "open" });
  if (!dashboard) throw new Error("There is no dashboard to tick.");
  fake.editBody(dashboard.number, tickRow(dashboard.body, stack), person);
  runNumber++;
  const runId = String(runNumber);
  // GitHub knows the run from the moment the edit started it.
  fake.seedIssuesRun(WORKFLOW, { id: runId, completed: false });
  const payload = fake.deliverEvent();
  const resolved = await loopStep("resolve", {
    runId,
    sha: SECOND_SHA,
    event: "issues",
    payload,
    title: `Run ${runId}: resolve, after ${person.login} ticked ${stack}`,
  });
  return { runId, payload, resolved, matrix: matrixEntries(resolved.outputs.matrix ?? "") };
}

function applyStep(issuesRun: IssuesRun, deployment: number, runAttempt = "1"): Promise<LoopStep> {
  const attempt = runAttempt === "1" ? "" : `, attempt ${runAttempt}`;
  return loopStep("apply", {
    inputs: { "deployment-id": String(deployment) },
    runId: issuesRun.runId,
    runAttempt,
    sha: SECOND_SHA,
    event: "issues",
    payload: issuesRun.payload,
    title: `Run ${issuesRun.runId}: apply of deployment record ${deployment}${attempt}`,
  });
}

// `settle` runs whenever `resolve` handed on a matrix, whatever `apply` did.
async function settleStep(issuesRun: IssuesRun): Promise<LoopStep> {
  const settled = await loopStep("settle", {
    runId: issuesRun.runId,
    sha: SECOND_SHA,
    event: "issues",
    payload: issuesRun.payload,
    title: `Run ${issuesRun.runId}: settle`,
  });
  endRun(issuesRun);
  return settled;
}

function endRun(issuesRun: IssuesRun): void {
  fake.seedIssuesRun(WORKFLOW, { id: issuesRun.runId, completed: true });
}

// How often the tool deployed a stack, as its own backend keeps it. The one
// way to see that a deploy really went out, and that a re-run sent nothing.
async function deploysOf(dir: string, stack: string): Promise<number> {
  const history = await prepare(
    ["pulumi", "stack", "history", "--json", "--stack", stack, ...QUIET],
    dir,
  );
  const updates: unknown = JSON.parse(history);
  return Array.isArray(updates)
    ? updates.filter((update) => (update as { kind?: unknown }).kind === "update").length
    : 0;
}

function checkDeploys(stack: string, found: number, expected: number): string[] {
  return found === expected
    ? []
    : [`The backend holds ${found} deploys of ${stack}, expected ${expected}.`];
}

const secrets = [CANARY_VALUE, CANARY_SECRET];
function reportStep(title: string, stepped: LoopStep, problems: string[]): boolean {
  return report(title, [...problems, ...checkNothingLeaks(stepped, secrets)]);
}

// 1. carol ticks network:dev. The tick is refused, and nothing else of the
// run starts, because the matrix is empty.
const refused = await tick("network:dev", CAROL);
endRun(refused);
good =
  reportStep(
    "The refused tick",
    refused.resolved,
    checkRefusedTick(refused.resolved, { stack: "network:dev", ticker: CAROL.login }),
  ) && good;

// 2. alice ticks network:dev. It deploys with the real tool, and settle finds
// nothing open.
const deployed = await tick("network:dev", ALICE);
good =
  reportStep(
    "The tick that deploys: resolve",
    deployed.resolved,
    checkResolve(deployed.resolved, {
      stack: "network:dev",
      environment: "network",
      ticker: ALICE.login,
      runId: deployed.runId,
    }),
  ) && good;
const [deployedEntry] = deployed.matrix;
if (!deployedEntry) throw new Error("resolve handed on no deploy of network:dev.");
const applied = await applyStep(deployed, deployedEntry.deployment);
good =
  reportStep("The tick that deploys: apply", applied, [
    ...checkApply(applied, {
      stack: "network:dev",
      deployment: deployedEntry.deployment,
      outcome: "deployed",
    }),
    ...checkDeploys("network:dev", await deploysOf("network", "dev"), 1),
  ]) && good;
const settledNothing = await settleStep(deployed);
good =
  reportStep(
    "The tick that deploys: settle",
    settledNothing,
    checkSettle(settledNothing, { ended: undefined, before: applied.records }),
  ) && good;

// 3. Someone presses "Re-run all jobs" on that run. The apply job starts again
// with the same record, and deploys nothing.
fake.seedIssuesRun(WORKFLOW, { id: deployed.runId, completed: false });
const rerun = await applyStep(deployed, deployedEntry.deployment, "2");
endRun(deployed);
good =
  reportStep("The re-run", rerun, [
    ...checkRerun(rerun, { deployment: deployedEntry.deployment, before: settledNothing.records }),
    ...checkDeploys("network:dev", await deploysOf("network", "dev"), 1),
  ]) && good;

// 4. alice ticks site:prod, and the apply job is cancelled before it starts,
// as when a reviewer rejects it. settle ends the record and starts a scan.
const cancelled = await tick("site:prod", ALICE);
good =
  reportStep(
    "The cancelled deploy: resolve",
    cancelled.resolved,
    checkResolve(cancelled.resolved, {
      stack: "site:prod",
      environment: "sluiceway",
      ticker: ALICE.login,
      runId: cancelled.runId,
    }),
  ) && good;
const [cancelledEntry] = cancelled.matrix;
if (!cancelledEntry) throw new Error("resolve handed on no deploy of site:prod.");
const settledCancelled = await settleStep(cancelled);
good =
  reportStep(
    "The cancelled deploy: settle",
    settledCancelled,
    checkSettle(settledCancelled, {
      ended: cancelledEntry.deployment,
      before: cancelled.resolved.records,
    }),
  ) && good;

// 5. The full scan that settle started. network:dev was deployed by the tick,
// and site:prod carries the failure line of the cancelled deploy.
const dispatched = await scanStep(SECOND_SHA, "workflow_dispatch");
const afterLoop: Expected = {
  ...expected,
  sha: SECOND_SHA,
  actionRef: SECOND_SHA,
  rows: {
    "app:prod": "in-sync",
    "network:dev": "in-sync",
    "network:prod": "in-sync",
    "site:prod": "pending",
  },
};
good =
  report("The scan that settle started", [
    ...checkFullScan(dispatched, afterLoop),
    ...checkRowFacts(dashboardBody(dispatched), {
      failed: ["site:prod"],
      recentlyDeployed: ["network:dev"],
    }),
  ]) && good;

// 6. alice ticks site:prod again, and before its apply job starts someone
// deploys the stack by hand (record 0016). The fresh preview has nothing to
// deploy: nothing goes out, the record ends as success with the words of
// record 0051, and the row is in sync with no failure line.
const outside = await tick("site:prod", ALICE);
const [outsideEntry] = outside.matrix;
if (!outsideEntry) throw new Error("resolve handed on no deploy of site:prod.");
console.log("::group::Deploying site:prod by hand before its apply job starts");
await deploy("site", "prod");
console.log("::endgroup::");
const outsideApply = await applyStep(outside, outsideEntry.deployment);
good =
  reportStep("Nothing to deploy", outsideApply, [
    ...checkResolve(outside.resolved, {
      stack: "site:prod",
      environment: "sluiceway",
      ticker: ALICE.login,
      runId: outside.runId,
    }),
    ...checkApply(outsideApply, {
      stack: "site:prod",
      deployment: outsideEntry.deployment,
      outcome: "in-sync",
    }),
    // Only the deploy by hand.
    ...checkDeploys("site:prod", await deploysOf("site", "prod"), 1),
  ]) && good;
const settledOutside = await settleStep(outside);
good =
  reportStep(
    "Nothing to deploy: settle",
    settledOutside,
    checkSettle(settledOutside, { ended: undefined, before: outsideApply.records }),
  ) && good;

// 7. The next full scan. Every stack is in sync. The last record of site:prod
// is the success with nothing to deploy, so its failure line is gone, and the
// trail says that nothing went out (record 0051).
const last = await scanStep(SECOND_SHA, "schedule");
good =
  report("The scan after the loop", [
    ...checkFullScan(last, { ...afterLoop, rows: { ...afterLoop.rows, "site:prod": "in-sync" } }),
    ...checkRowFacts(dashboardBody(last), {
      failed: [],
      recentlyDeployed: ["network:dev", "site:prod"],
    }),
    ...(dashboardBody(last).includes(
      "- site:prod · ticked by alice · nothing to deploy, already in sync · ",
    )
      ? []
      : ["Recently deployed does not say that site:prod had nothing to deploy."]),
  ]) && good;

// 8. The scan of 7 once more, from the moving tag v0, the way the first user's
// runs of 0.1.0 started it and failed (hotfix 0.1.1). A runner downloads the
// repo at the tag to `_actions/<owner>/<repo>/<ref>/`, starts the bundle with
// the workspace as its working directory, and sets no GITHUB_ACTION_PATH for
// a JavaScript action. The images come from the exact tag of package.json.
const downloaded = join(work, "_actions", "sluiceway", "sluiceway", "v0");
cpSync(REPO, downloaded, {
  recursive: true,
  filter: (source) => !/[/\\](?:node_modules|\.git)$/.test(source) && !source.startsWith(work),
});
const version: string = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
const fromTag = await scanStep(SECOND_SHA, "schedule", { ref: "v0", dir: downloaded });
good =
  report("The scan from the moving tag v0", [
    ...checkFullScan(fromTag, {
      ...afterLoop,
      actionRef: `v${version}`,
      rows: { ...afterLoop.rows, "site:prod": "in-sync" },
    }),
    // The footer's version line uses the same value.
    ...(dashboardBody(fromTag).includes(
      `[Sluiceway](https://github.com/sluiceway/sluiceway) v${version} · `,
    )
      ? []
      : [`The footer does not name v${version}.`]),
  ]) && good;

console.log("::group::The dashboard after the narrowed scan");
console.log(dashboardBody(second));
console.log("::endgroup::");
for (const [name, { requests }] of [
  ["full", first],
  ["narrowed", second],
] as const) {
  console.log(`GitHub requests of the ${name} scan: ${requests.length} (${requests.join(", ")}).`);
}

process.exit(good ? 0 : 1);
