// The end to end run of one repo with Pulumi, OpenTofu, Helm and Kubernetes
// manifests stacks (records 0053, 0058 and 0060): the committed bundle,
// started the way a runner starts a step, with the pulumi, tofu, helm and
// kubectl CLIs on PATH and the fake GitHub server. The repo is
// examples/pulumi-basic with examples/opentofu-basic in infra/,
// examples/helm-basic in helm/ and the web directory of
// examples/kubernetes-basic in k8s/web. Helm and kubectl need a cluster:
// KUBECONFIG names a kind cluster made for this, and HELM_PLUGINS the
// directory of the diff plugin.
//
//   bun run e2e:mixed [--work-dir <dir>] [--expect-tofu v1.12.6]
//                     [--expect-helm v4.3.0] [--expect-kubectl v1.37.0]
//
//   1. A full scan: one dashboard with the rows of all four tools, every
//      stack pending, each OpenTofu directory initialised and the Helm chart
//      with a dependency built before any preview.
//   2. alice ticks infra/network:dev. resolve hands on a record, apply deploys
//      the plan its fresh preview saved and hashed, with the real tofu, and
//      settle finds nothing open.
//   3. alice ticks infra/dns, and the code of infra/dns moves before its apply
//      job starts. The fresh preview gives another hash, so nothing is
//      deployed and the record ends as error.
//   4. alice ticks network:dev, a Pulumi stack of the same repo, which deploys
//      with the real pulumi.
//   5. alice ticks helm/web, and its values move before its apply job starts:
//      nothing is deployed and the release is not installed.
//   6. A scan, and alice ticks helm/web again: apply renders the chart in its
//      fresh preview and once more right before the deploy, and the real helm
//      installs the release.
//   7. alice ticks k8s/web, and a manifest is added before its apply job
//      starts: nothing reaches the cluster. She ticks the fresh row, and
//      apply deploys the rendered set its fresh preview diffed.
//   8. A last full scan: the four deployed stacks are in sync, infra/dns is
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
    "expect-helm": { type: "string" },
    "expect-kubectl": { type: "string" },
  },
});

const work = resolve(values["work-dir"]);
const workspace = join(work, "repo");
const backend = join(work, "backend");
const temp = join(work, "temp");

// Helm reaches the cluster and finds its plugin through these, which whoever
// runs this has to give.
function needed(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`The end to end run of a repo with Helm stacks needs ${name}.`);
  }
  return value;
}

// What the workflow of a real repo prepares for the job: the tools on PATH, a
// backend and a passphrase for Pulumi, a provider cache for OpenTofu, and a
// kubeconfig and the diff plugin for Helm. Only PATH, KUBECONFIG and
// HELM_PLUGINS come from whoever runs this.
const jobEnvironment: Record<string, string> = {
  PATH: process.env.PATH ?? "",
  HOME: join(work, "home"),
  USER: "sluiceway",
  PULUMI_BACKEND_URL: `file://${backend}`,
  PULUMI_HOME: join(work, "pulumi-home"),
  PULUMI_CONFIG_PASSPHRASE: EXAMPLE_PASSPHRASE,
  PULUMI_SKIP_UPDATE_CHECK: "true",
  TF_PLUGIN_CACHE_DIR: join(work, "plugin-cache"),
  KUBECONFIG: needed("KUBECONFIG"),
  HELM_PLUGINS: needed("HELM_PLUGINS"),
  NO_COLOR: "1",
};

// The namespace of the kubectl stack, made anew for every run.
const K8S_NAMESPACE = "sluiceway-e2e";

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
  - path: helm/web
    tool: helm
    inputs:
      - helm/charts/web/**
    options:
      release: web
      namespace: sluiceway-web
      chart: ../charts/web
      valuesFiles: [values.yaml]
  - path: helm/worker
    tool: helm
    inputs:
      - helm/charts/**
    options:
      release: worker
      namespace: sluiceway-worker
      chart: ../charts/worker
      valuesFiles: [values.yaml]
  - path: k8s/web
    tool: kubectl
    options:
      namespace: ${K8S_NAMESPACE}
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

// Whether helm holds the release, the one way to see that a deploy really
// went out and that a refused one sent nothing.
async function installed(release: string, namespace: string): Promise<boolean> {
  const ran = await run(["helm", "status", release, `--namespace=${namespace}`], work);
  return ran.exitCode === 0;
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

// The helm on PATH, and its diff plugin.
const helmVersion = (await run(["helm", "version", "--template={{.Version}}"], REPO)).output.trim();
const diffVersion = (await run(["helm", "diff", "version"], REPO)).output.trim();
console.log(`helm ${helmVersion}, helm-diff ${diffVersion}`);
if (values["expect-helm"] && helmVersion !== values["expect-helm"]) {
  throw new Error(`Expected helm ${values["expect-helm"]} on PATH, found ${helmVersion}.`);
}

// The kubectl on PATH, and a cluster that is a kind cluster made for this.
const kubectlVersion = await run(["kubectl", "version", "--client", "--output=json"], REPO);
const kubectl =
  (JSON.parse(kubectlVersion.output) as { clientVersion?: { gitVersion?: string } }).clientVersion
    ?.gitVersion ?? "";
console.log(`kubectl ${kubectl}`);
if (values["expect-kubectl"] && kubectl !== values["expect-kubectl"]) {
  throw new Error(`Expected kubectl ${values["expect-kubectl"]} on PATH, found ${kubectl}.`);
}
const context = await run(["kubectl", "config", "current-context"], REPO);
if (!context.output.trim().startsWith("kind-")) {
  throw new Error(
    "The current context of KUBECONFIG is not a kind cluster. The e2e only runs against one.",
  );
}

cpSync(join(REPO, "examples/pulumi-basic"), workspace, { recursive: true });
cpSync(join(REPO, "examples/opentofu-basic"), join(workspace, "infra"), { recursive: true });
rmSync(join(workspace, "infra/sluiceway.yaml"));
cpSync(join(REPO, "examples/helm-basic"), join(workspace, "helm"), { recursive: true });
rmSync(join(workspace, "helm/sluiceway.yaml"));
cpSync(join(REPO, "examples/kubernetes-basic/web"), join(workspace, "k8s/web"), {
  recursive: true,
});
writeFileSync(join(workspace, "sluiceway.yaml"), CONFIG);

// The Pulumi stacks exist in the backend. The OpenTofu workspaces do not,
// and need not: the local backend plans a workspace it does not hold as all
// creates, and the deploy makes it.
console.log("::group::Preparing the example project");
const QUIET = ["--non-interactive", "--color", "never"];
await prepare(["pulumi", "stack", "init", "dev", ...QUIET], "network");
await prepare(["pulumi", "stack", "init", "prod", ...QUIET], "network");
await prepare(["pulumi", "stack", "init", "prod", ...QUIET], "app");
// A release needs its namespace, which the workflow of a real repo, or the
// cluster, holds already. The cluster may hold the releases of an earlier run.
for (const [release, namespace] of [
  ["web", "sluiceway-web"],
  ["worker", "sluiceway-worker"],
] as const) {
  await prepare(
    ["helm", "uninstall", release, `--namespace=${namespace}`, "--ignore-not-found", "--wait"],
    ".",
  );
  const there = await run(["kubectl", "get", "namespace", namespace], workspace);
  if (there.exitCode !== 0) await prepare(["kubectl", "create", "namespace", namespace], ".");
}
// The namespace of k8s/web exists, empty: Sluiceway never makes one.
await prepare(
  ["kubectl", "delete", "namespace", K8S_NAMESPACE, "--ignore-not-found", "--wait"],
  ".",
);
await prepare(["kubectl", "create", "namespace", K8S_NAMESPACE], ".");
console.log("::endgroup::");

// 1. The full scan.
const first = await scanStep("workflow_dispatch");
const firstLog = first.log.split("\n");
const preparedAt = firstLog.findIndex((line) => line.includes("Prepared infra/network"));
const builtAt = firstLog.findIndex((line) => line.includes("Prepared helm/charts/worker"));
const previewedAt = firstLog.findIndex((line) => line.startsWith("Previewed "));
good =
  report("The first scan", first, [
    ...(first.exitCode === 0 ? [] : [`The scan ended with exit code ${first.exitCode}.`]),
    ...expectRows(first.body, {
      "app:prod": "pending",
      "helm/web": "pending",
      "helm/worker": "pending",
      "infra/dns": "pending",
      "infra/network:dev": "pending",
      "infra/network:prod": "pending",
      "k8s/web": "pending",
      "network:dev": "pending",
      "network:prod": "pending",
    }),
    ...(preparedAt >= 0 && previewedAt > preparedAt
      ? []
      : ["The job log does not show infra/network prepared before the first preview."]),
    ...(builtAt >= 0 && previewedAt > builtAt
      ? []
      : ["The job log does not show helm/charts/worker built before the first preview."]),
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

// 5. helm/web moves after its tick, so nothing goes out.
const webRun = await tick("helm/web");
const [webEntry] = webRun.matrix;
if (!webEntry) throw new Error("resolve handed on no deploy of helm/web.");
const webValues = join(workspace, "helm/web/values.yaml");
// A new object changes the diff. A new value of a field the row names would
// not: the hash covers what the row shows (record 0008).
writeFileSync(webValues, `${readFileSync(webValues, "utf8")}extra:\n  enabled: true\n`);
const webMoved = await step("apply", {
  inputs: { "deployment-id": String(webEntry.deployment) },
  runId: webRun.runId,
  event: "issues",
  payload: webRun.payload,
  title: `Run ${webRun.runId}: apply of helm/web, after its values moved`,
});
good =
  report("The moved change of helm/web", webMoved, [
    ...checkApply(webMoved, {
      stack: "helm/web",
      deployment: webEntry.deployment,
      outcome: "moved",
      rowState: "pending",
    }),
    ...((await installed("web", "sluiceway-web"))
      ? ["The release web is installed, and its change moved before the deploy."]
      : []),
  ]) && good;
await settled(webRun);

// 6. A scan shows the fresh diff, and a fresh tick deploys it with the real
// helm, held to the render of its fresh preview.
const rescanned = await scanStep("workflow_dispatch");
good =
  report(
    "The scan after the moved change of helm/web",
    rescanned,
    rescanned.exitCode === 0 ? [] : [`The scan ended with exit code ${rescanned.exitCode}.`],
  ) && good;
const web = await deployed("helm/web", "sluiceway");
const webLog = web.applied.log.split("\n");
good =
  report("The tick of helm/web: apply", web.applied, [
    ...checkApply(web.applied, {
      stack: "helm/web",
      deployment: web.entry.deployment,
      outcome: "deployed",
    }),
    ...((await installed("web", "sluiceway-web"))
      ? []
      : ["The release web is not installed after its deploy."]),
    ...(webLog.some((line) => line.includes("helm upgrade") || line.includes("STATUS: deployed"))
      ? []
      : ["The job log does not show the words of the deploy."]),
  ]) && good;
await settled(web.run);

// 7. k8s/web: a change that moved deploys nothing, then the fresh row deploys.
// How many objects of the example the namespace holds, the one way to see
// that a deploy really went out and that a refused one sent nothing.
async function k8sObjects(): Promise<number> {
  const ran = await run(
    [
      "kubectl",
      "get",
      "configmap,secret,deployment,service",
      "--namespace",
      K8S_NAMESPACE,
      "-o",
      "name",
    ],
    workspace,
  );
  if (ran.exitCode !== 0) return -1;
  return ran.output
    .split("\n")
    .filter((line) => /^(configmap|secret|deployment|service)/.test(line))
    .filter((line) => !line.includes("kube-root-ca")).length;
}
const k8sRun = await tick("k8s/web");
const [k8sEntry] = k8sRun.matrix;
if (!k8sEntry) throw new Error("resolve handed on no deploy of k8s/web.");
// A new object changes the diff.
writeFileSync(
  join(workspace, "k8s/web/extra.yaml"),
  "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web-extra\ndata:\n  motd: hello\n",
);
const k8sMoved = await step("apply", {
  inputs: { "deployment-id": String(k8sEntry.deployment) },
  runId: k8sRun.runId,
  event: "issues",
  payload: k8sRun.payload,
  title: `Run ${k8sRun.runId}: apply of k8s/web, after its manifests moved`,
});
good =
  report("The moved change of k8s/web", k8sMoved, [
    ...checkApply(k8sMoved, {
      stack: "k8s/web",
      deployment: k8sEntry.deployment,
      outcome: "moved",
      rowState: "pending",
    }),
    ...((await k8sObjects()) === 0
      ? []
      : ["The namespace of k8s/web holds objects, and its change moved before the deploy."]),
  ]) && good;
await settled(k8sRun);

const k8s = await deployed("k8s/web", "sluiceway");
good =
  report("The tick of k8s/web: apply", k8s.applied, [
    ...checkApply(k8s.applied, {
      stack: "k8s/web",
      deployment: k8s.entry.deployment,
      outcome: "deployed",
    }),
    ...((await k8sObjects()) === 5
      ? []
      : ["The namespace of k8s/web does not hold the 5 objects of the rendered set."]),
  ]) && good;
await settled(k8s.run);

// 8. The last full scan.
const last = await scanStep("schedule");
good =
  report("The last scan", last, [
    ...(last.exitCode === 0 ? [] : [`The scan ended with exit code ${last.exitCode}.`]),
    ...expectRows(last.body, {
      "app:prod": "pending",
      "helm/web": "in-sync",
      "helm/worker": "pending",
      "infra/dns": "pending",
      "infra/network:dev": "in-sync",
      "infra/network:prod": "pending",
      "k8s/web": "in-sync",
      "network:dev": "in-sync",
      "network:prod": "pending",
    }),
    ...checkRowFacts(last.body, {
      failed: ["infra/dns"],
      recentlyDeployed: ["helm/web", "infra/network:dev", "k8s/web", "network:dev"],
    }),
  ]) && good;

rmSync(work, { recursive: true, force: true });
if (!good) {
  console.log("The end to end run of a repo with four tools found problems.");
  process.exit(1);
}
console.log(
  "The end to end run of a repo with Pulumi, OpenTofu, Helm and Kubernetes manifests stacks is good.",
);
