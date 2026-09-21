import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fences, ROOT, read } from "./docs.ts";

// Onboarding log, hurdles 3 and 11: the recipe in docs/credentials.md that
// loads a secret manager's env file into the job. It runs inside the secret
// manager's `run` command, so every name of the file is already resolved in its
// environment. Here the test plays that part with fake values, and reads
// GITHUB_ENV the way the runner does.

const SCRIPT = "examples/workflows/export-env.sh";
const dir = mkdtempSync(join(tmpdir(), "export-env-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ENV_FILE = [
  "# The env file of the stacks. Comments and blank lines are skipped.",
  "",
  "PULUMI_CONFIG_PASSPHRASE=op://ci/pulumi/passphrase",
  "export CLOUD_TOKEN = op://ci/cloud/token",
  "TLS_KEY=op://ci/tls/key",
  "ODD=op://ci/odd/value",
  "EMPTY=op://ci/empty/value",
  "REGION=eu-west-1",
  "OWNER=platform-team",
  "OP_SERVICE_ACCOUNT_TOKEN=op://ci/op/token",
  "GITHUB_TOKEN=op://ci/github/token",
  "RUNNER_DEBUG=1",
  "not a variable line",
].join("\n");

const RESOLVED = {
  PULUMI_CONFIG_PASSPHRASE: "correct horse battery staple",
  CLOUD_TOKEN: "tok_123=456",
  TLS_KEY: "-----BEGIN KEY-----\nAAA%0ABBB\n\nCCC\r\n-----END KEY-----",
  ODD: `100% "quoted" #hash 'single'`,
  EMPTY: "",
  REGION: "eu-west-1",
  OWNER: "platform-team",
  OP_SERVICE_ACCOUNT_TOKEN: "ops_secret",
  GITHUB_TOKEN: "ghs_secret",
  RUNNER_DEBUG: "1",
};

// What the runner reads from GITHUB_ENV: `NAME=value` on one line, or
// `NAME<<DELIMITER`, the lines of the value, then the delimiter alone.
function readGithubEnv(text: string): Record<string, string> {
  const lines = text.split("\n");
  const env: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line === "") continue;
    const heredoc = line.match(/^([^=<]+)<<(.+)$/);
    if (heredoc) {
      const [, name = "", delimiter] = heredoc;
      const end = lines.indexOf(delimiter ?? "", i + 1);
      if (end < 0) throw new Error(`no closing delimiter for ${name}`);
      env[name] = lines.slice(i + 1, end).join("\n");
      i = end;
    } else {
      const at = line.indexOf("=");
      env[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  return env;
}

function run(envFile: string, extra: Record<string, string> = {}) {
  const file = join(dir, `ci-${Math.random().toString(16).slice(2)}.env`);
  const githubEnv = join(dir, `github-env-${Math.random().toString(16).slice(2)}`);
  writeFileSync(file, envFile);
  writeFileSync(githubEnv, "");
  const result = Bun.spawnSync(["bash", resolve(ROOT, SCRIPT), file], {
    env: { PATH: process.env.PATH ?? "", GITHUB_ENV: githubEnv, ...RESOLVED, ...extra },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    written: readGithubEnv(readFileSync(githubEnv, "utf8")),
  };
}

describe("the env loading recipe", () => {
  const result = run(ENV_FILE);
  const masks = result.stdout.split("\n").filter((line) => line !== "");

  test("succeeds and prints nothing but masks", () => {
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(masks.every((line) => line.startsWith("::add-mask::"))).toBe(true);
  });

  test("writes every value of the file unchanged, the multi-line one too", () => {
    expect(result.written).toEqual({
      PULUMI_CONFIG_PASSPHRASE: RESOLVED.PULUMI_CONFIG_PASSPHRASE,
      CLOUD_TOKEN: RESOLVED.CLOUD_TOKEN,
      TLS_KEY: RESOLVED.TLS_KEY,
      ODD: RESOLVED.ODD,
      REGION: "eu-west-1",
      OWNER: "platform-team",
    });
  });

  test("masks every line of every value that comes from a secret reference", () => {
    expect(masks).toEqual([
      "::add-mask::correct horse battery staple",
      "::add-mask::tok_123=456",
      "::add-mask::-----BEGIN KEY-----",
      "::add-mask::AAA%250ABBB",
      "::add-mask::CCC",
      "::add-mask::-----END KEY-----",
      `::add-mask::100%25 "quoted" #hash 'single'`,
    ]);
  });

  // Hurdle 11: a plain word that is masked turns the whole log into stars.
  test("leaves plain values unmasked", () => {
    expect(result.stdout).not.toContain("eu-west-1");
    expect(result.stdout).not.toContain("platform-team");
  });

  // The secret manager's own token and settings stay on the loading step, and
  // the runner refuses to overwrite its own names.
  test("skips OP_*, GITHUB_* and RUNNER_* names", () => {
    expect(Object.keys(result.written).filter((name) => /^(OP|GITHUB|RUNNER)_/.test(name))).toEqual(
      [],
    );
    expect(result.stdout).not.toContain("ops_secret");
    expect(result.stdout).not.toContain("ghs_secret");
  });

  test("skips a value that is empty", () => {
    expect(result.written).not.toHaveProperty("EMPTY");
  });

  // The delimiter is random per value, so a value cannot end its own entry
  // early, even one that looks like a delimiter.
  test("keeps a value that looks like a delimiter whole", () => {
    const tricky = run("TRICKY=op://ci/tricky/value\nLATER=plain\n", {
      TRICKY: "line\nghadelimiter_0000\nLATER=injected\n",
      LATER: "plain",
    });
    expect(tricky.exitCode).toBe(0);
    expect(tricky.written).toEqual({
      TRICKY: "line\nghadelimiter_0000\nLATER=injected\n",
      LATER: "plain",
    });
  });

  test("reads a file with Windows line endings", () => {
    const crlf = run("REGION=eu-west-1\r\nCLOUD_TOKEN=op://ci/cloud/token\r\n");
    expect(crlf.written).toEqual({ REGION: "eu-west-1", CLOUD_TOKEN: "tok_123=456" });
    expect(crlf.stdout).toBe("::add-mask::tok_123=456\n");
  });
});

describe("docs/credentials.md", () => {
  test("shows the recipe exactly as the tested file has it", () => {
    const blocks = fences(read("docs/credentials.md")).filter((fence) => fence.language === "bash");
    expect(blocks.map((block) => block.text)).toContainEqual(read(SCRIPT));
  });

  // Hurdle 11.
  test("says that only values from a secret reference are masked", () => {
    const text = read("docs/credentials.md");
    expect(text.includes("masks only the values that come from a secret reference")).toBe(true);
  });
});
