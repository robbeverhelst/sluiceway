// The end to end run (build plan, section 6): the committed bundle, started the
// way a runner starts a step, scans a copy of examples/pulumi-basic with the
// pulumi CLI on PATH, and writes its dashboard to the fake GitHub server.
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
// The tool only runs in a copy inside the work directory, against a file
// backend made there, with an environment built from nothing. `node` on PATH
// has to be the version that action.yml names, because it stands in for the
// runner's own.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { FakeGitHub } from "../test/fake-github/fake-github.ts";
import { startFakeGitHubServer } from "../test/fake-github/server.ts";
import { checkFullScan, checkNarrowedScan, type Expected, type Observed } from "./e2e/checks.ts";
import { type ActionMetadata, stepEnvironment } from "./e2e/step.ts";
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
let runNumber = 0;

// One step of `uses: ./` with `mode: scan` and nothing else set, so every
// other input is the default of action.yml.
async function scanStep(sha: string): Promise<Observed & { requests: string[] }> {
  runNumber++;
  const summaryFile = join(temp, `summary-${runNumber}.md`);
  writeFileSync(summaryFile, "");
  const server = await startFakeGitHubServer(fake);
  const requestsBefore = fake.requests.length;
  try {
    const env = stepEnvironment(
      action,
      { mode: "scan" },
      {
        workspace,
        actionPath: REPO,
        repository: "acme/infra",
        apiUrl: server.url,
        runId: String(runNumber),
        sha,
        event: "push",
        token: "not-a-token",
        summaryFile,
        temp,
      },
      jobEnvironment,
    );
    const ran = await run(["node", join(REPO, action.runs.main)], workspace, env);
    console.log(`::group::Scan ${runNumber}: what the step printed`);
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
    };
  } finally {
    await server.close();
  }
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
