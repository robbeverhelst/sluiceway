// The end to end run of one repo with Pulumi and OpenTofu stacks (record
// 0053): the committed bundle, started the way a runner starts a step, with
// the pulumi and tofu CLIs on PATH and the fake GitHub server. The repo is
// examples/pulumi-basic with examples/opentofu-basic in infra/.
//
//   bun run e2e:mixed [--work-dir <dir>] [--expect-tofu v1.12.6]
//
//   1. A full scan: one dashboard with the rows of both tools, every stack
//      pending, and each OpenTofu directory initialised before any preview.
//   2. alice ticks infra/network:dev. resolve hands on a record, apply deploys
//      the plan its fresh preview saved and hashed, with the real tofu, and
//      settle finds nothing open.
//   3. alice ticks infra/dns, and the code of infra/dns moves before its apply
//      job starts. The fresh preview gives another hash, so nothing is
//      deployed and the record ends as error.
//   4. alice ticks network:dev, a Pulumi stack of the same repo, which deploys
//      with the real pulumi.
//   5. A last full scan: the two deployed stacks are in sync, infra/dns is
//      pending with the moved change and a failure line.
//
// The tools only run in a copy inside the work directory, with state in local
// backends made there and an environment built from nothing.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { FakeGitHub } from "../test/fake-github/fake-github.ts";
import { startFakeGitHubServer } from "../test/fake-github/server.ts";
import {
  checkApply,
  checkNothingLeaks,
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
    "work-dir": { type: "string", default: join(tmpdir(), "sluiceway-e2e-mixed") },
    "expect-tofu": { type: "string" },
  },
});

const work = resolve(values["work-dir"]);
const workspace = join(work, "repo");
const backend = join(work, "backend");
const temp = join(work, "temp");

// What the workflow of a real repo prepares for the job: both tools on PATH, a
// backend and a passphrase for Pulumi, a provider cache for OpenTofu. Only
// PATH comes from whoever runs this.
const jobEnvironment: Record<string, string> = {
  PATH: process.env.PATH ?? "",
  HOME: join(work, "home"),
  USER: "sluiceway",
  PULUMI_BACKEND_URL: `file://${backend}`,
  PULUMI_HOME: join(work, "pulumi-home"),
  PULUMI_CONFIG_PASSPHRASE: EXAMPLE_PASSPHRASE,
  PULUMI_SKIP_UPDATE_CHECK: "true",
  TF_PLUGIN_CACHE_DIR: join(work, "plugin-cache"),
  NO_COLOR: "1",
};

const CONFIG = `ignore:
  - "playground:*"
  - "site:*"

stacks:
  - path: network
    environment: network
  - path: app
    inputs:
      - shared/**
  - path: infra/network
    name: dev
    tool: opentofu
    options:
      workspace: dev
      varFiles: [dev.tfvars]
  - path: infra/network
    name: prod
    tool: opentofu
    options:
      workspace: prod
      varFiles: [prod.tfvars]
  - path: infra/dns
    tool: opentofu
`;

interface Ran {
  exitCode: number;
  output: string;
}

function run(
  argv: string[],
  cwd: string,
  env: Record<string, string> = jobEnvironment,
): Promise<Ran> {
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

async function prepare(argv: string[], dir: string, env?: Record<string, string>): Promise<string> {
  console.log(`$ ${argv.join(" ")}  (in ${dir})`);
  const ran = await run(argv, join(workspace, dir), { ...jobEnvironment, ...env });
  if (ran.exitCode !== 0) {
    throw new Error(`"${argv.join(" ")}" ended with exit code ${ran.exitCode}.\n${ran.output}`);
  }
  return ran.output;
}

const action = Bun.YAML.parse(readFileSync(join(REPO, "action.yml"), "utf8")) as ActionMetadata;
const fake = new FakeGitHub();
const SHA = "3333333333333333333333333333333333333333";
const WORKFLOW = "sluiceway.yml";
const ALICE = { login: "alice", type: "User" };
fake.seedPermission(ALICE.login, { push: true, maintain: false, admin: false });

let stepNumber = 0;
let runNumber = 0;

// One step of `uses: ./`, with only the inputs given here set.
async function step(
  mode: string,
  options: {
    inputs?: Record<string, string>;
    runId: string;
    event: string;
    payload?: unknown;
    title: string;
  },
): Promise<LoopStep> {
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
  const commentsBefore = fake.comments(1).length;
  const dispatchesBefore = fake.dispatches.length;
  const server = await startFakeGitHubServer(fake);
  const requestsBefore = fake.requests.length;
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
        sha: SHA,
        event: options.event,
        token: "not-a-token",
        summaryFile,
        temp,
        outputFile,
        ...(eventPath === undefined ? {} : { eventPath }),
      },
      jobEnvironment,
    );
    const ran = await run(["node", join(REPO, action.runs.main)], workspace, env);
    console.log(`::group::${options.title}: what the step printed`);
    console.log(ran.output.replace(/^::/gm, ": :"));
    console.log("::endgroup::");
    const requests = fake.requests.slice(requestsBefore);
    const [dashboard] = await fake.listIssues({ label: "sluiceway", state: "open" });
    return {
      exitCode: ran.exitCode,
      log: ran.output,
      summary: readFileSync(summaryFile, "utf8"),
      outputs: readStepOutputs(readFileSync(outputFile, "utf8")),
      body: dashboard?.body ?? "",
      newComments: fake.comments(1).slice(commentsBefore),
      records: records(),
      requests,
      newDispatches: fake.dispatches.length - dispatchesBefore,
    };
  } finally {
    await server.close();
  }
}

function records(): LoopRecord[] {
  const found: LoopRecord[] = [];
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

function scanStep(event: string): Promise<LoopStep> {
  runNumber++;
  return step("scan", { runId: String(runNumber), event, title: `Scan ${runNumber}` });
}

interface IssuesRun {
  runId: string;
  payload: unknown;
  resolved: LoopStep;
  matrix: MatrixEntry[];
}

async function tick(stack: string): Promise<IssuesRun> {
  const [dashboard] = await fake.listIssues({ label: "sluiceway", state: "open" });
  if (!dashboard) throw new Error("There is no dashboard to tick.");
  fake.editBody(dashboard.number, tickRow(dashboard.body, stack), ALICE);
  runNumber++;
  const runId = String(runNumber);
  fake.seedIssuesRun(WORKFLOW, { id: runId, completed: false });
  const payload = fake.deliverEvent();
  const resolved = await step("resolve", {
    runId,
    event: "issues",
    payload,
    title: `Run ${runId}: resolve, after alice ticked ${stack}`,
  });
  return { runId, payload, resolved, matrix: matrixEntries(resolved.outputs.matrix ?? "") };
}

async function deployed(
  stack: string,
  environment: string,
): Promise<{ run: IssuesRun; applied: LoopStep; entry: MatrixEntry }> {
  const issuesRun = await tick(stack);
  good =
    report(
      `The tick of ${stack}: resolve`,
      issuesRun.resolved,
      checkResolve(issuesRun.resolved, {
        stack,
        environment,
        ticker: ALICE.login,
        runId: issuesRun.runId,
      }),
    ) && good;
  const [entry] = issuesRun.matrix;
  if (!entry) throw new Error(`resolve handed on no deploy of ${stack}.`);
  const applied = await step("apply", {
    inputs: { "deployment-id": String(entry.deployment) },
    runId: issuesRun.runId,
    event: "issues",
    payload: issuesRun.payload,
    title: `Run ${issuesRun.runId}: apply of ${stack}`,
  });
  return { run: issuesRun, applied, entry };
}

async function settled(issuesRun: IssuesRun): Promise<LoopStep> {
  const result = await step("settle", {
    runId: issuesRun.runId,
    event: "issues",
    payload: issuesRun.payload,
    title: `Run ${issuesRun.runId}: settle`,
  });
  fake.seedIssuesRun(WORKFLOW, { id: issuesRun.runId, completed: true });
  return result;
}

let good = true;
const secrets = [CANARY_VALUE, CANARY_SECRET];

function report(title: string, stepped: LoopStep, problems: string[]): boolean {
  const all = [...problems, ...checkNothingLeaks(stepped, secrets)];
  if (all.length === 0) {
    console.log(`${title}: good.`);
    return true;
  }
  console.log(`${title}: ${all.length} ${all.length === 1 ? "problem" : "problems"}.`);
  for (const problem of all) console.log(`::error title=${title}::${problem}`);
  return false;
}

function rowStates(body: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of body.matchAll(/<!-- sluiceway:row stack="([^"]*)" state="([^"]*)"/g)) {
    found[match[1] ?? ""] = match[2] ?? "";
  }
  return found;
}

function expectRows(body: string, expected: Record<string, string>): string[] {
  const found = Object.fromEntries(Object.entries(rowStates(body)).sort());
  return JSON.stringify(found) === JSON.stringify(expected)
    ? []
    : [`The rows are ${JSON.stringify(found)}, expected ${JSON.stringify(expected)}.`];
}

// How many resources the tool's own state holds, the one way to see that a
// deploy really went out and that a refused one sent nothing.
async function tofuResources(dir: string, workspaceName?: string): Promise<number> {
  const env = workspaceName === undefined ? {} : { TF_WORKSPACE: workspaceName };
  const ran = await run(["tofu", "state", "list"], join(workspace, dir), {
    ...jobEnvironment,
    ...env,
  });
  return ran.exitCode === 0
    ? ran.output.split("\n").filter((line) => line.trim() !== "").length
    : 0;
}

rmSync(work, { recursive: true, force: true });
for (const dir of [
  backend,
  temp,
  jobEnvironment.HOME ?? "",
  jobEnvironment.TF_PLUGIN_CACHE_DIR ?? "",
]) {
  mkdirSync(dir, { recursive: true });
}

// The tofu on PATH. It reads the provider cache of the job, which exists now.
const tofuVersion = await run(["tofu", "version", "-json"], REPO);
const tofu = `v${(JSON.parse(tofuVersion.output) as { terraform_version: string }).terraform_version}`;
console.log(`tofu ${tofu}`);
if (values["expect-tofu"] && tofu !== values["expect-tofu"]) {
  throw new Error(`Expected tofu ${values["expect-tofu"]} on PATH, found ${tofu}.`);
}

cpSync(join(REPO, "examples/pulumi-basic"), workspace, { recursive: true });
cpSync(join(REPO, "examples/opentofu-basic"), join(workspace, "infra"), { recursive: true });
rmSync(join(workspace, "infra/sluiceway.yaml"));
writeFileSync(join(workspace, "sluiceway.yaml"), CONFIG);

// The Pulumi stacks exist in the backend. The OpenTofu workspaces do not,
// and need not: the local backend plans a workspace it does not hold as all
// creates, and the deploy makes it.
console.log("::group::Preparing the example project");
const QUIET = ["--non-interactive", "--color", "never"];
await prepare(["pulumi", "stack", "init", "dev", ...QUIET], "network");
await prepare(["pulumi", "stack", "init", "prod", ...QUIET], "network");
await prepare(["pulumi", "stack", "init", "prod", ...QUIET], "app");
console.log("::endgroup::");

// 1. The full scan.
const first = await scanStep("workflow_dispatch");
const firstLog = first.log.split("\n");
const preparedAt = firstLog.findIndex((line) => line.includes("Prepared infra/network"));
const previewedAt = firstLog.findIndex((line) => line.startsWith("Previewed "));
good =
  report("The first scan", first, [
    ...(first.exitCode === 0 ? [] : [`The scan ended with exit code ${first.exitCode}.`]),
    ...expectRows(first.body, {
      "app:prod": "pending",
      "infra/dns": "pending",
      "infra/network:dev": "pending",
      "infra/network:prod": "pending",
      "network:dev": "pending",
      "network:prod": "pending",
    }),
    ...(preparedAt >= 0 && previewedAt > preparedAt
      ? []
      : ["The job log does not show infra/network prepared before the first preview."]),
  ]) && good;

// 2. infra/network:dev deploys its saved plan.
const network = await deployed("infra/network:dev", "sluiceway");
good =
  report("The tick of infra/network:dev: apply", network.applied, [
    ...checkApply(network.applied, {
      stack: "infra/network:dev",
      deployment: network.entry.deployment,
      outcome: "deployed",
    }),
    ...((await tofuResources("infra/network", "dev")) === 4
      ? []
      : [
          "The state of infra/network in the workspace dev does not hold the 4 resources of the plan.",
        ]),
    ...((await tofuResources("infra/network", "prod")) === 0
      ? []
      : ["The workspace prod holds resources, and nothing deployed it."]),
  ]) && good;
const settledNetwork = await settled(network.run);
good =
  report(
    "The tick of infra/network:dev: settle",
    settledNetwork,
    checkSettle(settledNetwork, { ended: undefined, before: network.applied.records }),
  ) && good;

// 3. infra/dns moves after its tick, so nothing goes out.
const dnsRun = await tick("infra/dns");
const [dnsEntry] = dnsRun.matrix;
if (!dnsEntry) throw new Error("resolve handed on no deploy of infra/dns.");
const dnsFile = join(workspace, "infra/dns/main.tofu");
// A new resource changes the diff. A new value on a create would not: the
// hash covers what the row shows, and a create shows no value (record 0008).
writeFileSync(dnsFile, `${readFileSync(dnsFile, "utf8")}\nresource "random_pet" "moved" {}\n`);
const dnsApplied = await step("apply", {
  inputs: { "deployment-id": String(dnsEntry.deployment) },
  runId: dnsRun.runId,
  event: "issues",
  payload: dnsRun.payload,
  title: `Run ${dnsRun.runId}: apply of infra/dns, after its code moved`,
});
good =
  report("The moved change of infra/dns", dnsApplied, [
    ...checkApply(dnsApplied, {
      stack: "infra/dns",
      deployment: dnsEntry.deployment,
      outcome: "moved",
      rowState: "pending",
    }),
    ...((await tofuResources("infra/dns")) === 0
      ? []
      : ["infra/dns holds resources, and its change moved before the deploy."]),
  ]) && good;
await settled(dnsRun);

// 4. A Pulumi stack of the same repo.
const pulumiStack = await deployed("network:dev", "network");
good =
  report(
    "The tick of network:dev: apply",
    pulumiStack.applied,
    checkApply(pulumiStack.applied, {
      stack: "network:dev",
      deployment: pulumiStack.entry.deployment,
      outcome: "deployed",
    }),
  ) && good;
await settled(pulumiStack.run);

// 5. The last full scan.
const last = await scanStep("schedule");
good =
  report("The last scan", last, [
    ...(last.exitCode === 0 ? [] : [`The scan ended with exit code ${last.exitCode}.`]),
    ...expectRows(last.body, {
      "app:prod": "pending",
      "infra/dns": "pending",
      "infra/network:dev": "in-sync",
      "infra/network:prod": "pending",
      "network:dev": "in-sync",
      "network:prod": "pending",
    }),
    ...checkRowFacts(last.body, {
      failed: ["infra/dns"],
      recentlyDeployed: ["infra/network:dev", "network:dev"],
    }),
  ]) && good;

rmSync(work, { recursive: true, force: true });
if (!good) {
  console.log("The end to end run of a repo with both tools found problems.");
  process.exit(1);
}
console.log("The end to end run of a repo with Pulumi and OpenTofu stacks is good.");
