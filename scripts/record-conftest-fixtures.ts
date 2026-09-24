// Runs Conftest over the policies and inputs of scripts/fixtures/conftest/,
// with the conftest binary on PATH, and saves what it printed under
// <out>/<version>/<scenario>/recording.json (record 0106). Fixtures are never
// written by hand (record 0001): what a test of the policy runner replays is
// what the real binary printed, on the minimum version Sluiceway supports and
// on the newest one.
//
//   bun run record:conftest [--out <dir>] [--expect-version 0.70.1] [--only <scenario>]
//
// Conftest reads the files it is given and nothing else: no network, no
// credentials, no repo but the fixture directory.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CONFTEST_VERSION_ARGV, conftestArgv, parseConftestVersion } from "../src/core/policy.ts";

const FIXTURES = resolve(import.meta.dir, "fixtures/conftest");

const { values } = parseArgs({
  options: {
    out: { type: "string", default: resolve(import.meta.dir, "../test/fixtures/conftest") },
    "expect-version": { type: "string" },
    only: { type: "string" },
  },
});

interface Recorded {
  argv: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function run(argv: string[]): Promise<Recorded> {
  const [command = "", ...args] = argv;
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      cwd: FIXTURES,
      // Conftest 0.70.1 finds its plugin cache under HOME and stops without one.
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", fail);
    child.on("close", (exitCode) =>
      done({
        argv,
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

// Each scenario is one run: the policy directories and the input file, as
// the runner builds the command. The expectation says what the recording is
// for, so a recording that does not show it fails the script.
const SCENARIOS: Record<
  string,
  { policies: string[]; input: string; expect: (recorded: Recorded) => boolean }
> = {
  // Every rule passes: exit 0 and a report with successes only.
  pass: {
    policies: ["policy"],
    input: "inputs/pass.json",
    expect: ({ exitCode, stdout }) => exitCode === 0 && !stdout.includes('"failures"'),
  },
  // Failures in two namespaces and a warning: exit 1 with a report.
  failures: {
    policies: ["policy"],
    input: "inputs/fail.json",
    expect: ({ exitCode, stdout }) =>
      exitCode === 1 && stdout.includes('"failures"') && stdout.includes('"warnings"'),
  },
  // A policy that does not parse: exit 1 and no report.
  "broken-policy": {
    policies: ["broken"],
    input: "inputs/pass.json",
    expect: ({ exitCode, stdout }) => exitCode === 1 && stdout.trim() === "",
  },
  // A policy directory that is not there: exit 1 and no report.
  "missing-policy": {
    policies: ["does-not-exist"],
    input: "inputs/pass.json",
    expect: ({ exitCode, stdout }) => exitCode === 1 && stdout.trim() === "",
  },
  // An input that is not JSON: exit 1 and no report.
  "unreadable-input": {
    policies: ["policy"],
    input: "inputs/broken.json",
    expect: ({ exitCode, stdout }) => exitCode === 1 && stdout.trim() === "",
  },
  // A policy directory with a package and no deny or warn rule.
  "no-rules": {
    policies: ["no-rules"],
    input: "inputs/pass.json",
    expect: ({ exitCode, stdout }) => exitCode === 0 && stdout.includes('"successes": 0'),
  },
  // Two policy directories at once.
  "two-directories": {
    policies: ["policy", "no-rules"],
    input: "inputs/fail.json",
    expect: ({ exitCode, stdout }) => exitCode === 1 && stdout.includes('"failures"'),
  },
  // A YAML stream of several objects, as a kubectl or Helm stack hands one.
  manifests: {
    policies: ["policy"],
    input: "inputs/manifests.yaml",
    expect: ({ exitCode, stdout }) => exitCode === 1 && stdout.includes("2 replicas"),
  },
};

const version = await run(CONFTEST_VERSION_ARGV);
const found = parseConftestVersion(version.stdout);
if (found === undefined) {
  throw new Error(`conftest did not say its version:\n${version.stdout}${version.stderr}`);
}
if (values["expect-version"] !== undefined && found !== values["expect-version"]) {
  throw new Error(`Expected conftest ${values["expect-version"]}, found ${found}.`);
}
const out = join(values.out ?? "", `v${found}`);
mkdirSync(join(out, "version"), { recursive: true });
writeFileSync(join(out, "version", "recording.json"), `${JSON.stringify(version, null, 2)}\n`);
console.log(`conftest ${found}: recording into ${out}`);

for (const [name, scenario] of Object.entries(SCENARIOS)) {
  if (values.only !== undefined && values.only !== name) continue;
  const recorded = await run(conftestArgv(scenario.policies, scenario.input));
  if (!scenario.expect(recorded)) {
    throw new Error(
      `The ${name} scenario did not show what it is for (exit ${recorded.exitCode}):\n${recorded.stdout}${recorded.stderr}`,
    );
  }
  mkdirSync(join(out, name), { recursive: true });
  writeFileSync(join(out, name, "recording.json"), `${JSON.stringify(recorded, null, 2)}\n`);
  console.log(`${name}: exit ${recorded.exitCode}`);
}
