// Drives examples/pulumi-basic through the scenarios of scripts/fixtures/ with
// the pulumi CLI on PATH, and saves what the tool printed under
// <out>/<cli version>/<scenario>/. Fixtures are never written by hand (0001).
// With --tool opentofu it drives examples/opentofu-basic with tofu instead
// (record 0053), and with --tool helm examples/helm-basic with helm and its
// diff plugin, against the cluster KUBECONFIG names (record 0058), and with
// --tool kubectl examples/kubernetes-basic with kubectl, against that cluster
// too, which has to be a kind cluster (record 0060). --tool terraform drives
// examples/opentofu-basic with terraform, --tool terragrunt
// examples/terragrunt-basic and --tool cdktf examples/cdktf-basic, both with
// tofu behind them (record 0068). cdktf needs the example's packages
// installed first, with npm ci in examples/cdktf-basic.
//
//   bun run record:fixtures [--tool pulumi|opentofu|terraform|terragrunt|cdktf|helm|kubectl] [--out <dir>]
//                           [--work-dir <dir>] [--expect-version v3.229.0]
//                           [--only <scenario>]
//
// The tool only runs in copies inside the work directory, against a file
// backend made there, with an environment built from nothing. It cannot reach
// a real stack, a real backend or an account. Helm is the exception that
// needs a cluster: give it one made for this, such as kind, and nothing else.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { bundleManifests } from "../src/adapters/kubectl/render.ts";
import { CDKTF_SCENARIOS, cdktfEnvironment } from "./fixtures/cdktf-scenarios.ts";
import {
  HELM,
  HELM_NAMESPACES,
  helmEnvironment,
  helmOps,
  helmScenarios,
} from "./fixtures/helm-scenarios.ts";
import {
  KUBECTL,
  KUBECTL_SCENARIOS,
  kubectlEnvironment,
  kubectlOps,
  RENDERED_SET,
} from "./fixtures/kubectl-scenarios.ts";
import {
  OPENTOFU_SCENARIOS,
  openTofuEnvironment,
  openTofuOps,
  TERRAFORM_SCENARIOS,
} from "./fixtures/opentofu-scenarios.ts";
import {
  checkRecording,
  type RecordOptions,
  type Run,
  type RunResult,
  recordScenario,
} from "./fixtures/recorder.ts";
import { SCENARIOS } from "./fixtures/scenarios.ts";
import { TERRAGRUNT_SCENARIOS } from "./fixtures/terragrunt-scenarios.ts";

const REPO = resolve(import.meta.dir, "..");

const { values } = parseArgs({
  options: {
    tool: { type: "string", default: "pulumi" },
    out: { type: "string" },
    // A fixed path, because the tool prints absolute paths of the program and
    // they end up in the fixtures. Record on a machine where this path says
    // nothing about anyone.
    "work-dir": { type: "string", default: join(tmpdir(), "sluiceway-fixtures") },
    "expect-version": { type: "string" },
    only: { type: "string" },
  },
});

function run({ argv, cwd, env }: Run): Promise<RunResult> {
  const [command = "", ...args] = argv;
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", fail);
    child.on("close", (code, signal) =>
      done({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? (signal === null ? 1 : 128),
      }),
    );
  });
}

interface Tool {
  name: string;
  example: string;
  fixtures: string;
  versionArgv: string[];
  version: (stdout: string) => string;
  // The scenarios, or how to make them for the version found, when a
  // command line differs between versions (record 0069).
  scenarios: typeof SCENARIOS | ((cliVersion: string) => typeof SCENARIOS);
  environment?: RecordOptions["environment"];
  ops?: (document: unknown) => string[];
  // What the recorder needs for a tool whose plan file it writes itself.
  planFileName?: string;
  bundle?: (dir: string) => string;
}

const TOOLS: Record<string, Tool> = {
  pulumi: {
    name: "pulumi",
    example: "examples/pulumi-basic",
    fixtures: "pulumi",
    versionArgv: ["pulumi", "version"],
    version: (stdout) => stdout.trim(),
    scenarios: SCENARIOS,
  },
  opentofu: {
    name: "tofu",
    example: "examples/opentofu-basic",
    fixtures: "opentofu",
    versionArgv: ["tofu", "version", "-json"],
    version: (stdout) =>
      `v${(JSON.parse(stdout || "{}") as { terraform_version?: string }).terraform_version ?? ""}`,
    scenarios: OPENTOFU_SCENARIOS,
    environment: openTofuEnvironment,
    ops: openTofuOps,
  },
  // The Terraform family behind the OpenTofu adapter (record 0068).
  // terraform drives the same example as tofu. terragrunt and cdktf drive an
  // example of their own, with tofu behind them, and are named by their own
  // version.
  terraform: {
    name: "terraform",
    example: "examples/opentofu-basic",
    fixtures: "terraform",
    versionArgv: ["terraform", "version", "-json"],
    version: (stdout) =>
      `v${(JSON.parse(stdout || "{}") as { terraform_version?: string }).terraform_version ?? ""}`,
    scenarios: TERRAFORM_SCENARIOS,
    environment: openTofuEnvironment,
    ops: openTofuOps,
  },
  terragrunt: {
    name: "terragrunt",
    example: "examples/terragrunt-basic",
    fixtures: "terragrunt",
    versionArgv: ["terragrunt", "--version"],
    version: (stdout) => /v\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? "",
    scenarios: TERRAGRUNT_SCENARIOS,
    environment: openTofuEnvironment,
    ops: openTofuOps,
  },
  cdktf: {
    name: "cdktf",
    example: "examples/cdktf-basic",
    fixtures: "cdktf",
    versionArgv: ["cdktf", "--version"],
    version: (stdout) => `v${stdout.trim()}`,
    scenarios: CDKTF_SCENARIOS,
    environment: cdktfEnvironment,
    ops: openTofuOps,
  },
  helm: {
    name: "helm",
    example: "examples/helm-basic",
    fixtures: "helm",
    versionArgv: HELM.version,
    version: (stdout) => stdout.trim(),
    scenarios: helmScenarios,
    environment: helmEnvironment,
    ops: helmOps,
  },
  kubectl: {
    name: "kubectl",
    example: "examples/kubernetes-basic",
    fixtures: "kubectl",
    versionArgv: KUBECTL.version,
    version: (stdout) =>
      (JSON.parse(stdout || "{}") as { clientVersion?: { gitVersion?: string } }).clientVersion
        ?.gitVersion ?? "",
    scenarios: KUBECTL_SCENARIOS,
    environment: kubectlEnvironment,
    ops: kubectlOps,
    planFileName: RENDERED_SET,
    bundle: bundleManifests,
  },
};

const tool = TOOLS[values.tool ?? ""];
if (tool === undefined) throw new Error(`No tool is named "${values.tool}".`);
const toolName = tool.name;

const workDir = resolve(values["work-dir"]);
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
if (tool.environment !== undefined) {
  mkdirSync(join(workDir, "plugin-cache"), { recursive: true });
  mkdirSync(join(workDir, "home"), { recursive: true });
}

// The kubectl scenarios delete and make a namespace, and the Helm scenarios
// change and delete objects behind helm's back (record 0069). They never run
// against a cluster that is not a kind cluster made for them.
if (tool.fixtures === "kubectl" || tool.fixtures === "helm") {
  const context = await run({
    argv: ["kubectl", "config", "current-context"],
    cwd: workDir,
    env: { PATH: process.env.PATH ?? "", KUBECONFIG: process.env.KUBECONFIG ?? "" },
  });
  if (context.exitCode !== 0 || !context.stdout.trim().startsWith("kind-")) {
    throw new Error(
      `The current context of KUBECONFIG is not a kind cluster. The ${tool.fixtures} scenarios only run against one.`,
    );
  }
}

const found = await run({
  argv: tool.versionArgv,
  cwd: workDir,
  env: { PATH: process.env.PATH ?? "" },
});
const cliVersion = found.exitCode === 0 ? tool.version(found.stdout) : "";
if (!/^v\d+\.\d+\.\d+$/.test(cliVersion)) {
  throw new Error(`"${toolName} version" did not give a release version. Is the CLI on PATH?`);
}
if (values["expect-version"] !== undefined && values["expect-version"] !== cliVersion) {
  throw new Error(`Expected ${toolName} ${values["expect-version"]} on PATH, found ${cliVersion}.`);
}

const all = typeof tool.scenarios === "function" ? tool.scenarios(cliVersion) : tool.scenarios;
const scenarios = all.filter(
  (scenario) => values.only === undefined || scenario.name === values.only,
);
if (scenarios.length === 0) throw new Error(`No scenario is named "${values.only}".`);

const outDir = join(resolve(values.out ?? join(REPO, "test/fixtures", tool.fixtures)), cliVersion);
if (values.only === undefined) rmSync(outDir, { recursive: true, force: true });

// A release needs its namespace. The cluster is the recorder's own, so the
// namespaces of the example are made once, before any scenario.
if (tool.fixtures === "helm") {
  const env = helmEnvironment({ workDir, parentEnv: process.env } as RecordOptions);
  for (const namespace of HELM_NAMESPACES) {
    const there = await run({
      argv: ["kubectl", "get", "namespace", namespace],
      cwd: workDir,
      env,
    });
    if (there.exitCode === 0) continue;
    const made = await run({
      argv: ["kubectl", "create", "namespace", namespace],
      cwd: workDir,
      env,
    });
    if (made.exitCode !== 0)
      throw new Error(`Could not make the namespace ${namespace}.\n${made.stderr}`);
  }
}

const problems: string[] = [];
for (const scenario of scenarios) {
  const started = Date.now();
  await recordScenario(scenario, {
    exampleDir: join(REPO, tool.example),
    workDir,
    outDir,
    cliVersion,
    parentEnv: process.env,
    runner: run,
    ...(tool.environment === undefined ? {} : { environment: tool.environment }),
    ...(tool.planFileName === undefined ? {} : { planFileName: tool.planFileName }),
    ...(tool.bundle === undefined ? {} : { bundle: tool.bundle }),
  });
  const found = checkRecording(
    join(outDir, scenario.name),
    scenario,
    ...(tool.ops === undefined ? [] : [tool.ops]),
  );
  problems.push(...found);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${found.length === 0 ? "ok  " : "FAIL"} ${scenario.name} (${seconds} s)`);
}

rmSync(workDir, { recursive: true, force: true });

if (problems.length > 0) {
  console.error(
    `\nThe recording with ${toolName} ${cliVersion} does not show what the scenarios are for:`,
  );
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(
  `\nRecorded ${scenarios.length} scenarios with ${toolName} ${cliVersion} into ${outDir}`,
);
