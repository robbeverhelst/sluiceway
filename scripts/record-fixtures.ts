// Drives examples/pulumi-basic through the scenarios of scripts/fixtures/ with
// the pulumi CLI on PATH, and saves what the tool printed under
// <out>/<cli version>/<scenario>/. Fixtures are never written by hand (0001).
// With --tool opentofu it drives examples/opentofu-basic with tofu instead
// (record 0053).
//
//   bun run record:fixtures [--tool pulumi|opentofu] [--out <dir>]
//                           [--work-dir <dir>] [--expect-version v3.229.0]
//                           [--only <scenario>]
//
// The tool only runs in copies inside the work directory, against a file
// backend made there, with an environment built from nothing. It cannot reach
// a real stack, a real backend or an account.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  OPENTOFU_SCENARIOS,
  openTofuEnvironment,
  openTofuOps,
} from "./fixtures/opentofu-scenarios.ts";
import { checkRecording, type Run, type RunResult, recordScenario } from "./fixtures/recorder.ts";
import { SCENARIOS } from "./fixtures/scenarios.ts";

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

const tofu = values.tool === "opentofu";
if (!tofu && values.tool !== "pulumi") throw new Error(`No tool is named "${values.tool}".`);
const toolName = tofu ? "tofu" : "pulumi";

const workDir = resolve(values["work-dir"]);
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
if (tofu) {
  mkdirSync(join(workDir, "plugin-cache"), { recursive: true });
  mkdirSync(join(workDir, "home"), { recursive: true });
}

const found = await run({
  argv: tofu ? ["tofu", "version", "-json"] : ["pulumi", "version"],
  cwd: workDir,
  env: { PATH: process.env.PATH ?? "" },
});
const cliVersion = tofu
  ? `v${(JSON.parse(found.exitCode === 0 ? found.stdout : "{}") as { terraform_version?: string }).terraform_version ?? ""}`
  : found.stdout.trim();
if (found.exitCode !== 0 || !/^v\d+\.\d+\.\d+$/.test(cliVersion)) {
  throw new Error(`"${toolName} version" did not give a release version. Is the CLI on PATH?`);
}
if (values["expect-version"] !== undefined && values["expect-version"] !== cliVersion) {
  throw new Error(`Expected ${toolName} ${values["expect-version"]} on PATH, found ${cliVersion}.`);
}

const scenarios = (tofu ? OPENTOFU_SCENARIOS : SCENARIOS).filter(
  (scenario) => values.only === undefined || scenario.name === values.only,
);
if (scenarios.length === 0) throw new Error(`No scenario is named "${values.only}".`);

const outDir = join(
  resolve(values.out ?? join(REPO, "test/fixtures", tofu ? "opentofu" : "pulumi")),
  cliVersion,
);
if (values.only === undefined) rmSync(outDir, { recursive: true, force: true });

const problems: string[] = [];
for (const scenario of scenarios) {
  const started = Date.now();
  await recordScenario(scenario, {
    exampleDir: join(REPO, tofu ? "examples/opentofu-basic" : "examples/pulumi-basic"),
    workDir,
    outDir,
    cliVersion,
    parentEnv: process.env,
    runner: run,
    ...(tofu ? { environment: openTofuEnvironment } : {}),
  });
  const found = checkRecording(
    join(outDir, scenario.name),
    scenario,
    ...(tofu ? [openTofuOps] : []),
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
