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
//   6. site:prod is ticked, and apply runs with dry-run: true. It previews,
//      checks the hash and deploys nothing, and the record ends as rehearsed.
//   7. site:prod is ticked again and deployed by hand before its apply job
//      starts. The fresh preview has nothing to deploy: nothing goes out, the
//      record ends as success that says so, and the job is green.
//   8. A last full scan: every stack in sync, and no failure line left.
//   9. The same scan once more, started the way a runner starts
//      `uses: sluiceway/sluiceway@v0`: from a copy of the action in a
//      directory of its own, with the moving tag as its ref and no
//      GITHUB_ACTION_PATH. Its images come from the tag of package.json.
//  10. Three stacks in a chain (record 0056): sluiceway.yaml says network:dev
//      depends on app:prod and site:prod on network:dev, a push changes
//      app:prod and site:prod, and the file network:dev manages is removed by
//      hand, so a scheduled scan shows it drifted (record 0055). alice ticks
//      the three in one edit. Each run deploys one layer with the real tool,
//      settle starts the workflow again, and the resolve of that run starts
//      the next stack. The drift repair waited behind app:prod, and still
//      repairs: the trail says drift fixed, not no changes (record 0091).
//  11. Merge and deploy: Renovate's pull request is listed, alice ticks it,
//      resolve merges it on the fake, and the scan it starts hands the fresh
//      diff of app:prod to apply, which deploys it with the real tool.
//  12. Deploy on merge (record 0095): site:prod is set to on-merge, alice
//      merges a change to it, and the scan of the push hands it to apply in
//      the same step, which deploys it with the real tool. Nobody ticks, and
//      the trail says merged by alice.
//  13. An outside record (record 0109): a record another writer opened, deployed
//      by the run it dispatched, which skips its scan.
//  14. A push between the tick and the deploy (record 0111): apply compares
//      the commit it checked out with main, refuses as moved before the tool
//      runs and starts a full scan, which shows the row pending with the push.
//
// The tool only runs in a copy inside the work directory, against a file
// backend made there, with an environment built from nothing. `node` on PATH
// has to be the version that action.yml names, because it stands in for the
// runner's own.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type FakeCheckRun, FakeGitHub } from "../test/fake-github/fake-github.ts";
import { startFakeGitHubServer } from "../test/fake-github/server.ts";
import {
  checkEnvFile,
  checkFullScan,
  checkNarrowedScan,
  checkOutsideDeploys,
  type Expected,
  type Observed,
} from "./e2e/checks.ts";
import {
  checkApply,
  checkBranchMoved,
  checkDriftRepair,
  checkHandOff,
  checkMergeTick,
  checkNothingLeaks,
  checkOutsideRecord,
  checkPendingAfterRefusal,
  checkQueued,
  checkRefusedTick,
  checkRehearsal,
  checkRerun,
  checkResolve,
  checkRowFacts,
  checkSettle,
  checkStarted,
  checkTrail,
  type LoopRecord,
  type LoopStep,
  type MatrixEntry,
  matrixEntries,
  mergeRows,
  rowFingerprint,
  rowHash,
  tickMerge,
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
  // The commit at the head of main while the step runs. Without it the
  // branch holds the commit the step checked out, as when nothing was pushed
  // since (record 0111).
  branchHead?: string;
}

interface Stepped extends Observed {
  outputs: Record<string, string>;
}

// One step of `uses: ./` or of a downloaded action, with only the inputs given here set, so every other
// input is the default of action.yml. Without a mode the step is auto mode,
// the one step of the README's workflow (record 0077).
let stepNumber = 0;
async function step(mode: string | undefined, options: StepOptions): Promise<Stepped> {
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
  fake.seedBranch("main", options.branchHead ?? options.sha);
  const server = await startFakeGitHubServer(fake);
  const requestsBefore = fake.requests.length;
  // A page the step writes has links of its own run, so a page it updated
  // differs from what was there before (record 0050).
  const pageText = (page: FakeCheckRun) => JSON.stringify(page);
  const pagesBefore = new Set(fake.checkRuns(options.sha).map(pageText));
  try {
    const env = stepEnvironment(
      action,
      { ...(mode === undefined ? {} : { mode }), ...options.inputs },
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

// A scan of a push, a schedule or a dispatch. Each is a run of its own, of
// the one step with no mode, which scans on each of these events (record
// 0077). On a dispatch it resolves first, and finds nothing to start.
let runNumber = 0;
function scanStep(
  sha: string,
  event = "push",
  action?: StepOptions["action"],
  inputs?: Record<string, string>,
): Promise<Stepped> {
  runNumber++;
  const from = action === undefined ? "" : `, from ${action.ref}`;
  return step(undefined, {
    runId: String(runNumber),
    sha,
    event,
    title: `Scan ${runNumber}${from}`,
    ...(action === undefined ? {} : { action }),
    ...(inputs === undefined ? {} : { inputs }),
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
// The value of the env file the first scan loads (record 0100). Long enough
// to be masked, and no test result may hold it.
const ENV_CANARY = "CANARY-ENV-VALUE";
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
  secrets: [CANARY_VALUE, CANARY_SECRET, ENV_CANARY],
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

// The first scan names an env file (record 0100): a file a step before
// Sluiceway would have resolved, with one value long enough to mask and one
// too short. No program of the example reads either, so the proof is what
// the step printed, and that the value reached nothing Sluiceway writes.
const ENV_FILE = {
  path: "ci/deploy.env",
  masked: ENV_CANARY,
  unmaskedName: "SLUICEWAY_E2E_SHORT",
  unmaskedValue: "e2e",
};
mkdirSync(join(workspace, "ci"), { recursive: true });
writeFileSync(
  join(workspace, ENV_FILE.path),
  `# Resolved by a step before Sluiceway.\nSLUICEWAY_E2E_TOKEN=${ENV_CANARY}\n${ENV_FILE.unmaskedName}=${ENV_FILE.unmaskedValue}\n`,
);

const first = await scanStep(FIRST_SHA, "push", undefined, { "env-file": ENV_FILE.path });
let good = report("The full scan", [
  ...checkFullScan(first, expected),
  ...checkEnvFile(first.log, ENV_FILE),
  // network:prod was deployed by hand above, so the tool's history holds a
  // deploy that no deployment record ran (record 0073).
  ...checkOutsideDeploys(first, ["network:prod"]),
]);

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
// the edit starts a run of the workflow with the `issues` event. In the
// README's workflow that run is one step with no mode, which resolves, deploys
// what it started and settles (record 0077). Two scenes run the split
// workflow instead, one job per mode with the run id of the run: a re-run of
// an apply job, and an apply job that was cancelled before it started.
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
async function loopStep(mode: string | undefined, options: StepOptions): Promise<LoopStep> {
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
  // The one step of the run, or its resolve job in the split workflow.
  resolved: LoopStep;
  matrix: MatrixEntry[];
}

interface TickOptions {
  // "resolve" for the resolve job of the split workflow. Without it the run
  // is the one step of the README's workflow.
  mode?: string;
  inputs?: Record<string, string>;
  // What happens between the edit and the start of the run.
  beforeRun?: () => Promise<void>;
  // The commit the run checks out. SECOND_SHA without it.
  sha?: string;
}

// A person ticks the box of a stack, and the edit starts a run.
async function tick(
  stack: string,
  person: { login: string; type: string },
  options: TickOptions = {},
): Promise<IssuesRun> {
  const [dashboard] = await fake.listIssues({ label: "sluiceway", state: "open" });
  if (!dashboard) throw new Error("There is no dashboard to tick.");
  fake.editBody(dashboard.number, tickRow(dashboard.body, stack), person);
  runNumber++;
  const runId = String(runNumber);
  // GitHub knows the run from the moment the edit started it.
  fake.seedIssuesRun(WORKFLOW, { id: runId, completed: false });
  const payload = fake.deliverEvent();
  await options.beforeRun?.();
  const what = options.mode === undefined ? "the one step" : options.mode;
  const resolved = await loopStep(options.mode, {
    runId,
    sha: options.sha ?? SECOND_SHA,
    event: "issues",
    payload,
    ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
    title: `Run ${runId}: ${what}, after ${person.login} ticked ${stack}`,
  });
  return { runId, payload, resolved, matrix: matrixEntries(resolved.outputs.matrix ?? "") };
}

function applyStep(
  issuesRun: IssuesRun,
  deployment: number,
  runAttempt = "1",
  inputs: Record<string, string> = {},
  commits: { sha?: string; branchHead?: string } = {},
): Promise<LoopStep> {
  const attempt = runAttempt === "1" ? "" : `, attempt ${runAttempt}`;
  return loopStep("apply", {
    inputs: { "deployment-id": String(deployment), ...inputs },
    runId: issuesRun.runId,
    runAttempt,
    sha: commits.sha ?? SECOND_SHA,
    ...(commits.branchHead === undefined ? {} : { branchHead: commits.branchHead }),
    event: "issues",
    payload: issuesRun.payload,
    title: `Run ${issuesRun.runId}: apply of deployment record ${deployment}${attempt}${inputs["dry-run"] === "true" ? ", a rehearsal" : ""}`,
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

const secrets = [CANARY_VALUE, CANARY_SECRET, ENV_CANARY];
function reportStep(title: string, stepped: LoopStep, problems: string[]): boolean {
  return report(title, [...problems, ...checkNothingLeaks(stepped, secrets)]);
}

// 1. carol ticks network:dev. The tick is refused, and nothing is deployed.
const refused = await tick("network:dev", CAROL);
endRun(refused);
good =
  reportStep(
    "The refused tick",
    refused.resolved,
    checkRefusedTick(refused.resolved, { stack: "network:dev", ticker: CAROL.login }),
  ) && good;

// 2. alice ticks network:dev. The one step resolves, deploys it with the real
// tool and settles, which finds nothing open and starts nothing.
const deployed = await tick("network:dev", ALICE);
endRun(deployed);
const [deployedEntry] = deployed.matrix;
if (!deployedEntry) throw new Error("The step started no deploy of network:dev.");
good =
  reportStep("The tick that deploys, in one step", deployed.resolved, [
    ...checkStarted(deployed.resolved, {
      stack: "network:dev",
      environment: "network",
      ticker: ALICE.login,
      runId: deployed.runId,
    }),
    ...checkApply(deployed.resolved, {
      stack: "network:dev",
      deployment: deployedEntry.deployment,
      outcome: "deployed",
    }),
    ...checkSettle(deployed.resolved, { ended: undefined, before: deployed.resolved.records }),
    ...checkDeploys("network:dev", await deploysOf("network", "dev"), 1),
  ]) && good;
const settledNothing = deployed.resolved;

// 3. In the split workflow, someone presses "Re-run all jobs" on the run of a
// tick. Its apply job starts again with the same record, and deploys nothing.
fake.seedIssuesRun(WORKFLOW, { id: deployed.runId, completed: false });
const rerun = await applyStep(deployed, deployedEntry.deployment, "2");
endRun(deployed);
good =
  reportStep("The re-run", rerun, [
    ...checkRerun(rerun, { deployment: deployedEntry.deployment, before: settledNothing.records }),
    ...checkDeploys("network:dev", await deploysOf("network", "dev"), 1),
  ]) && good;

// 4. In the split workflow, alice ticks site:prod, and the apply job is
// cancelled before it starts, as when a reviewer rejects it. settle ends the
// record and starts a scan.
const cancelled = await tick("site:prod", ALICE, { mode: "resolve" });
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

// 6. alice ticks site:prod, and the step is a rehearsal (record 0051): the
// whole path to the hash check with the real tool, and no deploy.
const rehearsed = await tick("site:prod", ALICE, { inputs: { "dry-run": "true" } });
endRun(rehearsed);
const [rehearsedEntry] = rehearsed.matrix;
if (!rehearsedEntry) throw new Error("The step started no deploy of site:prod.");
const rehearsal = rehearsed.resolved;
good =
  reportStep("The rehearsal", rehearsal, [
    ...checkRehearsal(rehearsal, {
      stack: "site:prod",
      deployment: rehearsedEntry.deployment,
      ticker: ALICE.login,
    }),
    ...checkSettle(rehearsal, { ended: undefined, before: rehearsal.records }),
    ...checkDeploys("site:prod", await deploysOf("site", "prod"), 0),
  ]) && good;

// 7. alice ticks site:prod again, and before its run starts someone deploys
// the stack by hand (record 0016). The fresh preview has nothing to deploy:
// nothing goes out, the record ends as success with the words of record 0051,
// and the row is in sync with no failure line.
const outside = await tick("site:prod", ALICE, {
  beforeRun: async () => {
    console.log("::group::Deploying site:prod by hand before its run starts");
    await deploy("site", "prod");
    console.log("::endgroup::");
  },
});
endRun(outside);
const [outsideEntry] = outside.matrix;
if (!outsideEntry) throw new Error("The step started no deploy of site:prod.");
good =
  reportStep("Nothing to deploy", outside.resolved, [
    ...checkStarted(outside.resolved, {
      stack: "site:prod",
      environment: "sluiceway",
      ticker: ALICE.login,
      runId: outside.runId,
    }),
    ...checkApply(outside.resolved, {
      stack: "site:prod",
      deployment: outsideEntry.deployment,
      outcome: "in-sync",
    }),
    ...checkSettle(outside.resolved, { ended: undefined, before: outside.resolved.records }),
    // Only the deploy by hand.
    ...checkDeploys("site:prod", await deploysOf("site", "prod"), 1),
  ]) && good;

// 8. The next full scan. Every stack is in sync. The last record of site:prod
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
    ...(dashboardBody(last).includes("- ⚪&nbsp;site:prod · no changes · alice · ")
      ? []
      : ["Recently deployed does not say that site:prod had nothing to deploy."]),
  ]) && good;

// 9. The scan of 8 once more, from the moving tag v0, the way the first user's
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

// 10. Three stacks in a chain (record 0056). The config and two programs
// change in one push, so app:prod and site:prod are pending. The layer between
// them, network:dev, is drifted instead: the file it manages is removed behind
// the tool's back, and only its entry turns the drift check on. alice ticks
// the three in one edit, so the drift repair waits behind app:prod and a later
// run starts it (issue 209, record 0091).
const THIRD_SHA = "3333333333333333333333333333333333333333";
console.log("::group::Pushing a chain of dependencies, a change to two stacks, and drift");
const configFile = join(workspace, "sluiceway.yaml");
writeFileSync(
  configFile,
  `${readFileSync(configFile, "utf8")}\n  - path: network\n    name: dev\n    dependsOn:\n      - app:prod\n    drift:\n      enabled: true\n  - path: site\n    dependsOn:\n      - network:dev\n`,
);
const edit = (file: string, from: string, to: string) => {
  const path = join(workspace, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${file} holds no "${from}".`);
  writeFileSync(path, text.replace(from, to));
};
// Both network stacks write this file, and only network:dev checks drift.
const notesFile = join(workspace, "network", "out", "notes.txt");
rmSync(notesFile);
edit("app/Pulumi.prod.yml", "app:tier: standard", "app:tier: premium");
edit("site/Pulumi.prod.yaml", "    - contact\n", "    - contact\n    - blog\n");
console.log(readFileSync(configFile, "utf8"));
console.log("::endgroup::");
const chainScan = await scanStep(THIRD_SHA, "schedule");
const chainRows = { "app:prod": "pending", "network:dev": "drift", "site:prod": "pending" };
good =
  report(
    "The scan before the chain",
    checkFullScan(chainScan, {
      ...afterLoop,
      sha: THIRD_SHA,
      actionRef: THIRD_SHA,
      rows: { ...afterLoop.rows, ...chainRows },
    }),
  ) && good;

async function tickAll(stacks: string[]): Promise<IssuesRun> {
  const [dashboard] = await fake.listIssues({ label: "sluiceway", state: "open" });
  if (!dashboard) throw new Error("There is no dashboard to tick.");
  fake.editBody(
    dashboard.number,
    stacks.reduce((body, stack) => tickRow(body, stack), dashboard.body),
    ALICE,
  );
  runNumber++;
  const runId = String(runNumber);
  fake.seedIssuesRun(WORKFLOW, { id: runId, completed: false });
  const payload = fake.deliverEvent();
  const resolved = await loopStep(undefined, {
    runId,
    sha: THIRD_SHA,
    event: "issues",
    payload,
    title: `Run ${runId}: the one step, after alice ticked ${stacks.join(", ")}`,
  });
  endRun({ runId, payload, resolved, matrix: [] });
  return { runId, payload, resolved, matrix: matrixEntries(resolved.outputs.matrix ?? "") };
}

// The run that settle starts, on a dispatch: the one step resolves, deploys
// the next layer, scans and settles.
async function dispatchedRun(): Promise<IssuesRun> {
  runNumber++;
  const runId = String(runNumber);
  fake.seedRun(runId, { completed: false });
  const payload = { ref: "refs/heads/main" };
  const resolved = await loopStep(undefined, {
    runId,
    sha: THIRD_SHA,
    event: "workflow_dispatch",
    payload,
    title: `Run ${runId}: the one step, started by settle`,
  });
  fake.seedRun(runId, { completed: true });
  return { runId, payload, resolved, matrix: matrixEntries(resolved.outputs.matrix ?? "") };
}

// One layer, deployed with the real tool in the one step of its run, which
// settles last.
function deployLayer(layer: IssuesRun, stack: string, environment: string) {
  const problems = checkStarted(layer.resolved, {
    stack,
    environment,
    ticker: ALICE.login,
    runId: layer.runId,
  });
  const [entry] = layer.matrix;
  if (!entry) return { problems, settled: undefined };
  problems.push(
    ...checkApply(layer.resolved, { stack, deployment: entry.deployment, outcome: "deployed" }),
  );
  return { problems, settled: layer.resolved };
}

const chainTick = await tickAll(["site:prod", "app:prod", "network:dev"]);
const firstLayer = deployLayer(chainTick, "app:prod", "sluiceway");
good =
  reportStep("The chain: the first layer", chainTick.resolved, [
    ...firstLayer.problems,
    ...checkQueued(chainTick.resolved, [
      { stack: "network:dev", behind: ["app:prod"] },
      { stack: "site:prod", behind: ["network:dev"] },
    ]),
    ...checkDriftRepair(chainTick.resolved, "network:dev"),
    // network:dev and site:prod wait, and nothing of them went out yet.
    ...checkDeploys("app:prod", await deploysOf("app", "prod"), 2),
    ...checkDeploys("network:dev", await deploysOf("network", "dev"), 1),
    ...checkDeploys("site:prod", await deploysOf("site", "prod"), 1),
    ...(firstLayer.settled?.newDispatches === 1
      ? []
      : ["settle did not start the workflow again after the first layer."]),
  ]) && good;

const secondRun = await dispatchedRun();
const secondLayer = deployLayer(secondRun, "network:dev", "network");
good =
  reportStep("The chain: the second layer", secondRun.resolved, [
    ...secondLayer.problems,
    ...checkQueued(secondRun.resolved, [{ stack: "site:prod", behind: ["network:dev"] }]),
    // The record this run started for the queued repair is still a drift
    // repair, and the deploy put the file back (issue 209, record 0091).
    ...checkDriftRepair(secondRun.resolved, "network:dev"),
    ...checkTrail(secondRun.resolved.body, "network:dev", "drift fixed"),
    ...(existsSync(notesFile)
      ? []
      : ["The drift repair of network:dev did not put its file back."]),
    ...checkDeploys("network:dev", await deploysOf("network", "dev"), 2),
    ...checkDeploys("site:prod", await deploysOf("site", "prod"), 1),
    ...(secondLayer.settled?.newDispatches === 1
      ? []
      : ["settle did not start the workflow again after the second layer."]),
  ]) && good;

const thirdRun = await dispatchedRun();
const thirdLayer = deployLayer(thirdRun, "site:prod", "sluiceway");
good =
  reportStep("The chain: the third layer", thirdRun.resolved, [
    ...thirdLayer.problems,
    ...checkDeploys("site:prod", await deploysOf("site", "prod"), 2),
    ...(thirdLayer.settled?.newDispatches === 0
      ? []
      : ["settle started the workflow again with nothing left in the chain."]),
  ]) && good;

const afterChain = await scanStep(THIRD_SHA, "workflow_dispatch");
good =
  report(
    "The scan after the chain",
    checkFullScan(afterChain, {
      ...afterLoop,
      sha: THIRD_SHA,
      actionRef: THIRD_SHA,
      rows: { ...afterLoop.rows, "site:prod": "in-sync" },
    }),
  ) && good;

// 11. Merge and deploy (record 0054). The repo turns it on for Renovate, and
// Renovate opens a pull request that changes shared/motd.txt, which only
// app:prod claims. A scan lists it, alice ticks it, resolve merges it on the
// fake and starts a scan, and that scan, on the merge commit, hands the fresh
// diff of app:prod to apply, which deploys it with the real tool.
console.log("::group::Turning on merge and deploy, and Renovate opens a pull request");
appendFileSync(
  join(workspace, "sluiceway.yaml"),
  "\nmergeAndDeploy:\n  authors:\n    - renovate[bot]\n",
);
const RENOVATE_PR = 50;
fake.seedOpenPullRequest({
  number: RENOVATE_PR,
  head: "4444444444444444444444444444444444444444",
  title: "Update the message of the day",
  author: "renovate[bot]",
  files: ["shared/motd.txt"],
});
console.log("::endgroup::");
const listing = await scanStep(THIRD_SHA, "schedule");
const listed = mergeRows(dashboardBody(listing));
good =
  report("The update waiting to merge", [
    ...(listing.exitCode === 0 ? [] : [`The scan ended with exit code ${listing.exitCode}.`]),
    ...(listed.length === 1 &&
    listed[0]?.pr === String(RENOVATE_PR) &&
    listed[0]?.stack === "app:prod"
      ? []
      : [
          `The dashboard lists ${JSON.stringify(listed)} to merge, expected #${RENOVATE_PR} for app:prod.`,
        ]),
  ]) && good;

const [board] = await fake.listIssues({ label: "sluiceway", state: "open" });
if (!board) throw new Error("There is no dashboard to tick.");
fake.editBody(board.number, tickMerge(board.body, RENOVATE_PR), ALICE);
runNumber++;
const mergeRun = String(runNumber);
fake.seedIssuesRun(WORKFLOW, { id: mergeRun, completed: false });
const merging = await loopStep(undefined, {
  runId: mergeRun,
  sha: THIRD_SHA,
  event: "issues",
  payload: fake.deliverEvent(),
  title: `Run ${mergeRun}: the one step, after alice ticked the merge of #${RENOVATE_PR}`,
});
fake.seedIssuesRun(WORKFLOW, { id: mergeRun, completed: true });
const [merged] = fake.merges;
good =
  reportStep("The merge tick: resolve", merging, [
    ...checkMergeTick(merging, {
      pr: RENOVATE_PR,
      stack: "app:prod",
      ticker: ALICE.login,
      runId: mergeRun,
    }),
    ...(merged?.number === RENOVATE_PR && merged.method === "squash"
      ? []
      : [
          `The fake holds the merges ${JSON.stringify(fake.merges)}, expected a squash of #${RENOVATE_PR}.`,
        ]),
  ]) && good;
if (!merged) throw new Error(`#${RENOVATE_PR} was not merged.`);
const mergeRecord = merging.records.find(
  ({ payload }) => (payload as { merge?: unknown }).merge === RENOVATE_PR,
);

// The runner checks out the merge commit for the scan that resolve started.
writeFileSync(join(workspace, "shared/motd.txt"), "Merged from the dashboard.\n");
const appDeploys = await deploysOf("app", "prod");
runNumber++;
const handOffRun = String(runNumber);
// GitHub knows the run of the scan while it runs.
fake.seedRun(handOffRun, { completed: false });
// The run resolve started: the one step scans, hands the merged change on,
// deploys it and settles.
const handingOn = await loopStep(undefined, {
  runId: handOffRun,
  sha: merged.sha,
  event: "workflow_dispatch",
  title: `Run ${handOffRun}: the one step, started by resolve after the merge`,
});
fake.seedRun(handOffRun, { completed: true });
const [handedEntry] = matrixEntries(handingOn.outputs.matrix ?? "");
good =
  reportStep("The merge tick: the run after the merge", handingOn, [
    ...checkHandOff(handingOn, {
      stack: "app:prod",
      merge: mergeRecord?.id ?? 0,
      ticker: ALICE.login,
      runId: handOffRun,
      deployed: true,
    }),
    ...(handedEntry === undefined
      ? []
      : checkApply(handingOn, {
          stack: "app:prod",
          deployment: handedEntry.deployment,
          outcome: "deployed",
        })),
    ...checkSettle(handingOn, { ended: undefined, before: handingOn.records }),
    ...checkDeploys("app:prod", await deploysOf("app", "prod"), appDeploys + 1),
  ]) && good;

// 12. Deploy on merge (record 0095). The repo sets site:prod to on-merge,
// and alice merges a change to its program. The push starts the one step,
// whose scan finds site:prod pending and hands it to apply in the same step,
// which deploys it with the real tool. Nobody ticks. The record, the trail
// and the row say it went out on merge and who merged it.
console.log("::group::Setting site:prod to deploy on merge, and alice merges a change to it");
edit(
  "sluiceway.yaml",
  "  - path: site\n    dependsOn:\n      - network:dev\n",
  "  - path: site\n    dependsOn:\n      - network:dev\n    deploy: on-merge\n",
);
edit("site/Pulumi.prod.yaml", "    - blog\n", "    - blog\n    - shop\n");
console.log(readFileSync(configFile, "utf8"));
console.log("::endgroup::");
const ON_MERGE_SHA = "6666666666666666666666666666666666666666";
const siteDeploys = await deploysOf("site", "prod");
runNumber++;
const pushRun = String(runNumber);
// GitHub knows the run of the push while it runs.
fake.seedRun(pushRun, { completed: false });
const onMerge = await loopStep(undefined, {
  runId: pushRun,
  sha: ON_MERGE_SHA,
  event: "push",
  payload: {
    ref: "refs/heads/main",
    repository: { default_branch: "main" },
    sender: { login: ALICE.login, type: "User" },
  },
  title: `Run ${pushRun}: the one step, after alice merged a change to site:prod`,
});
fake.seedRun(pushRun, { completed: true });
const [onMergeEntry] = matrixEntries(onMerge.outputs.matrix ?? "");
const onMergeRecord = onMerge.records.find(({ id }) => id === onMergeEntry?.deployment);
good =
  reportStep("Deploy on merge: the push", onMerge, [
    ...(onMergeEntry?.stack === "site:prod"
      ? []
      : [`The push handed on ${JSON.stringify(onMergeEntry)}, expected site:prod.`]),
    ...(onMergeRecord &&
    (onMergeRecord.payload as { onMerge?: unknown; ticker?: unknown }).onMerge === true &&
    (onMergeRecord.payload as { ticker?: unknown }).ticker === ALICE.login
      ? []
      : [
          `The record of site:prod says ${JSON.stringify(onMergeRecord?.payload)}, expected onMerge and ticker ${ALICE.login}.`,
        ]),
    ...(onMergeEntry === undefined
      ? []
      : checkApply(onMerge, {
          stack: "site:prod",
          deployment: onMergeEntry.deployment,
          outcome: "deployed",
        })),
    // The fake's records keep times of their own, older than the tool's own
    // history, so the line is looked for rather than taken as the newest.
    ...(new RegExp(`^- (\\S+&nbsp;)?site:prod · merged by ${ALICE.login} · `, "m").test(
      onMerge.body,
    )
      ? []
      : ["Recently deployed has no line of site:prod that says merged by alice."]),
    ...checkDeploys("site:prod", await deploysOf("site", "prod"), siteDeploys + 1),
    ...(onMerge.newComments.length === 0
      ? []
      : [`The push wrote comments: ${JSON.stringify(onMerge.newComments)}.`]),
  ]) && good;

// 13. An outside record (record 0109). A reader of the published shape opens
// a deployment record of app:prod itself, with the diff hash of the row and a
// ticker of its own word, and starts the workflow with a dispatch, naming the
// run in the record. The one step resolves, which hands the record on as it
// is, deploys it with the real tool through the fresh preview and the hash
// check, settles, and skips its scan.
console.log("::group::A change to app:prod, for a record another writer opens");
edit("app/Pulumi.prod.yml", "app:tier: premium", "app:tier: business");
// The repo names the app that may open records (record 0109).
appendFileSync(configFile, "\nrecordWriters:\n  - deploy-bot[bot]\n");
console.log(readFileSync(configFile, "utf8"));
console.log("::endgroup::");
const OUTSIDE_SHA = "7777777777777777777777777777777777777777";
const beforeOutside = await scanStep(OUTSIDE_SHA, "schedule");
const outsideHash = rowHash(dashboardBody(beforeOutside), "app:prod");
const outsideFingerprint = rowFingerprint(dashboardBody(beforeOutside), "app:prod");
good =
  report("The scan before the outside record", [
    ...(beforeOutside.exitCode === 0
      ? []
      : [`The scan ended with exit code ${beforeOutside.exitCode}.`]),
    ...(outsideHash === undefined ? ["The row of app:prod is not pending with a hash."] : []),
  ]) && good;
const appDeploysBefore = await deploysOf("app", "prod");
runNumber++;
const outsideRun = String(runNumber);
// The writer found the run it started, and GitHub knows it while it runs.
fake.seedRun(outsideRun, { completed: false });
const outsideRecord = fake.seedDeployment({
  task: "sluiceway:app:prod",
  environment: "sluiceway",
  sha: OUTSIDE_SHA,
  // The writer is the app GitHub names as the creator. The ticker is its word.
  creator: "deploy-bot[bot]",
  payload: {
    v: 1,
    hash: outsideHash ?? "",
    ticker: "dave",
    run: outsideRun,
    ...(outsideFingerprint === undefined ? {} : { fingerprint: outsideFingerprint }),
  },
  status: { state: "queued" },
});
const outsideStep = await loopStep(undefined, {
  runId: outsideRun,
  sha: OUTSIDE_SHA,
  event: "workflow_dispatch",
  payload: { ref: "refs/heads/main", inputs: {} },
  title: `Run ${outsideRun}: the one step, dispatched by the writer of record ${outsideRecord.id}`,
});
fake.seedRun(outsideRun, { completed: true });
good =
  reportStep("The outside record: the run its writer dispatched", outsideStep, [
    ...checkOutsideRecord(outsideStep, { stack: "app:prod", deployment: outsideRecord.id }),
    ...checkApply(outsideStep, {
      stack: "app:prod",
      deployment: outsideRecord.id,
      outcome: "deployed",
    }),
    ...checkSettle(outsideStep, { ended: undefined, before: outsideStep.records }),
    // The trail is not checked here: the fake's records keep times of their
    // own, older than the tool's own history, and by now the outside deploys
    // of that history fill its ten lines. The record, the row and the tool's
    // history above are the proof.
    ...checkDeploys("app:prod", await deploysOf("app", "prod"), appDeploysBefore + 1),
    ...(outsideStep.newComments.length === 0
      ? []
      : [`The run wrote comments: ${JSON.stringify(outsideStep.newComments)}.`]),
  ]) && good;

// 14. A push between the tick and the deploy (record 0111). alice ticks
// app:prod in the split workflow, and before its apply job starts a push
// changes the file app:prod reads its config from. The apply job checked out
// the commit of the tick, so no fresh preview of it could show the push:
// apply compares that commit with main, refuses as moved before the tool
// runs, starts a full scan and tells alice. The scan of the newer commit
// shows app:prod pending with the push, never in sync.
console.log("::group::A change to app:prod, ticked, then a push to it before apply");
edit("app/Pulumi.prod.yml", "app:tier: business", "app:tier: enterprise");
console.log("::endgroup::");
const TICKED_SHA = "8888888888888888888888888888888888888888";
const PUSHED_SHA = "9999999999999999999999999999999999999999";
const beforePush = await scanStep(TICKED_SHA, "schedule");
good =
  report("The scan before the tick of app:prod", [
    ...(beforePush.exitCode === 0 ? [] : [`The scan ended with exit code ${beforePush.exitCode}.`]),
    ...(rowHash(dashboardBody(beforePush), "app:prod") === undefined
      ? ["The row of app:prod is not pending with a hash."]
      : []),
  ]) && good;
const appDeploysBeforePush = await deploysOf("app", "prod");
const tickedBeforePush = await tick("app:prod", ALICE, { mode: "resolve", sha: TICKED_SHA });
const [pushedEntry] = tickedBeforePush.matrix;
// The push: main moves on, and the working copy holds what it pushed, for the
// scan after it.
edit("app/Pulumi.prod.yml", "app:tier: enterprise", "app:tier: platinum");
fake.seedComparison(TICKED_SHA, PUSHED_SHA, {
  status: "ahead",
  files: [{ path: "app/Pulumi.prod.yml" }],
});
const refusedForPush =
  pushedEntry === undefined
    ? undefined
    : await applyStep(
        tickedBeforePush,
        pushedEntry.deployment,
        "1",
        {},
        {
          sha: TICKED_SHA,
          branchHead: PUSHED_SHA,
        },
      );
const settledAfterPush = await settleStep(tickedBeforePush);
const afterPush = await scanStep(PUSHED_SHA, "workflow_dispatch");
good =
  report("A push between the tick and the deploy", [
    ...(pushedEntry === undefined ? ["resolve handed nothing on for app:prod."] : []),
    ...(refusedForPush === undefined || pushedEntry === undefined
      ? []
      : checkBranchMoved(refusedForPush, {
          stack: "app:prod",
          deployment: pushedEntry.deployment,
        })),
    ...(settledAfterPush.exitCode === 0
      ? []
      : [`settle ended with exit code ${settledAfterPush.exitCode}.`]),
    ...checkDeploys("app:prod", await deploysOf("app", "prod"), appDeploysBeforePush),
    ...(afterPush.exitCode === 0 ? [] : [`The scan ended with exit code ${afterPush.exitCode}.`]),
    ...checkPendingAfterRefusal(dashboardBody(afterPush), "app:prod"),
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
