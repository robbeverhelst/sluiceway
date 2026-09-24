import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProcessRunner, Run, RunResult } from "../../src/adapters/process.ts";
import { checkConftest, runPolicies } from "../../src/policy/conftest.ts";

// Slice 5.41 (record 0106): the runner writes the preview document of a stack
// to a file of its own, starts conftest over it through the process runner,
// and removes the file whatever happened. The document holds values (record
// 0021), so it never stays on disk and never goes anywhere else.

const FIXTURES = join(import.meta.dir, "../fixtures/conftest/v0.70.1");

function recorded(scenario: string): RunResult {
  const { exitCode, stdout, stderr } = JSON.parse(
    readFileSync(join(FIXTURES, scenario, "recording.json"), "utf8"),
  ) as { exitCode: number; stdout: string; stderr: string };
  return { status: "exited", exitCode, stdout, stderr };
}

// A repo root with the policy directories the tests name.
function root(...policies: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "sluiceway-policy-test-"));
  for (const path of policies) mkdirSync(join(dir, path), { recursive: true });
  return dir;
}

// A runner that answers with a recording and remembers what it was asked,
// and what the document file held while it ran.
function replay(answer: RunResult) {
  const runs: Run[] = [];
  const seen: { path: string; text: string; mode: number; exists: boolean }[] = [];
  const run: ProcessRunner = async (one) => {
    runs.push(one);
    const path = one.argv[one.argv.length - 1] ?? "";
    const exists = existsSync(path);
    seen.push({
      path,
      text: exists ? readFileSync(path, "utf8") : "",
      mode: exists ? statSync(path).mode & 0o777 : 0,
      exists,
    });
    return answer;
  };
  return { run, runs, seen };
}

const DOCUMENT = { text: '{"steps":[{"op":"delete"}]}', format: "json" as const };

describe("running the policies of a stack", () => {
  test("writes the document to a file of its own, tests it, and removes the file", async () => {
    const dir = root("policies");
    const { run, runs, seen } = replay(recorded("failures"));
    const { outcome, toolLog } = await runPolicies({
      root: dir,
      env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "secret", HOME: "/home/runner" },
      run,
      timeoutMinutes: 10,
      policies: ["policies"],
      document: DOCUMENT,
    });

    expect(outcome.kind).toBe("failed");
    expect(toolLog).toBe("");
    expect(runs.length).toBe(1);
    const [one] = runs;
    expect(one?.argv.slice(0, -1)).toEqual([
      "conftest",
      "test",
      "--output",
      "json",
      "--all-namespaces",
      "--no-color",
      "--policy",
      "policies",
    ]);
    expect(one?.cwd).toBe(dir);
    // The whole environment minus INPUT_* (record 0013): the tool the
    // policies run next to gets the same.
    expect(one?.env).toEqual({ PATH: "/usr/bin", HOME: "/home/runner" });
    expect(one?.timeoutMs).toBe(600_000);
    // The file held the document while conftest ran, readable by nobody
    // else, and is gone with its directory once it is over.
    const [file] = seen;
    expect(file?.exists).toBe(true);
    expect(file?.text).toBe(DOCUMENT.text);
    expect(file?.mode).toBe(0o600);
    expect(file?.path.endsWith("/preview.json")).toBe(true);
    expect(existsSync(dirname(file?.path ?? ""))).toBe(false);
  });

  test("a YAML document is written with the extension conftest reads it by", async () => {
    const dir = root("policies");
    const { run, seen } = replay(recorded("manifests"));
    const { outcome } = await runPolicies({
      root: dir,
      env: {},
      run,
      timeoutMinutes: 1,
      policies: ["policies"],
      document: { text: "kind: Deployment\n", format: "yaml" },
    });
    expect(outcome.kind).toBe("failed");
    expect(seen[0]?.path.endsWith("/preview.yaml")).toBe(true);
  });

  test("the file is removed when the runner throws, and the error goes on", async () => {
    const dir = root("policies");
    let path = "";
    const run: ProcessRunner = async (one) => {
      path = one.argv[one.argv.length - 1] ?? "";
      throw new Error("the runner broke");
    };
    await expect(
      runPolicies({
        root: dir,
        env: {},
        run,
        timeoutMinutes: 1,
        policies: ["policies"],
        document: DOCUMENT,
      }),
    ).rejects.toThrow("the runner broke");
    expect(path).not.toBe("");
    expect(existsSync(dirname(path))).toBe(false);
  });

  test("the tool's own words go to the tool log, and a run that failed is not a failed policy", async () => {
    const dir = root("policies");
    const { run } = replay(recorded("broken-policy"));
    const { outcome, toolLog } = await runPolicies({
      root: dir,
      env: {},
      run,
      timeoutMinutes: 1,
      policies: ["policies"],
      document: DOCUMENT,
    });
    expect(outcome).toEqual({ kind: "not-run", reason: { kind: "tool-error", exitCode: 1 } });
    expect(toolLog).toContain("rego_parse_error");
  });

  test("a policy path the checkout does not hold is said before conftest starts", async () => {
    const dir = root("policies");
    const { run, runs } = replay(recorded("pass"));
    const { outcome } = await runPolicies({
      root: dir,
      env: {},
      run,
      timeoutMinutes: 1,
      policies: ["policies", "policies/prod"],
      document: DOCUMENT,
    });
    expect(outcome).toEqual({
      kind: "not-run",
      reason: { kind: "path-missing", path: "policies/prod" },
    });
    expect(runs).toEqual([]);
  });

  test("a preview without a document has nothing to test", async () => {
    const { run, runs } = replay(recorded("pass"));
    const { outcome } = await runPolicies({
      root: root("policies"),
      env: {},
      run,
      timeoutMinutes: 1,
      policies: ["policies"],
      document: undefined,
    });
    expect(outcome).toEqual({ kind: "not-run", reason: { kind: "no-document" } });
    expect(runs).toEqual([]);
  });

  test("conftest that is not on PATH is the tool missing", async () => {
    const run: ProcessRunner = async () => ({ status: "not-started" });
    const { outcome } = await runPolicies({
      root: root("policies"),
      env: {},
      run,
      timeoutMinutes: 1,
      policies: ["policies"],
      document: DOCUMENT,
    });
    expect(outcome).toEqual({ kind: "not-run", reason: { kind: "tool-missing" } });
  });
});

describe("checking conftest before the previews", () => {
  test("a version new enough is found once", async () => {
    const { run, runs } = replay(recorded("version"));
    expect(await checkConftest({ root: "/repo", env: { INPUT_X: "1", A: "b" }, run })).toEqual({
      ok: true,
      version: "0.70.1",
    });
    expect(runs[0]?.argv).toEqual(["conftest", "--version"]);
    expect(runs[0]?.env).toEqual({ A: "b" });
    expect(runs[0]?.cwd).toBe("/repo");
  });

  test("one that is too old, one that names no version, and one that is missing", async () => {
    const old = replay({ status: "exited", exitCode: 0, stdout: "Conftest: 0.49.1\n", stderr: "" });
    expect(await checkConftest({ root: "/repo", env: {}, run: old.run })).toEqual({
      ok: false,
      reason: { kind: "too-old", found: "0.49.1" },
    });
    const mute = replay({ status: "exited", exitCode: 0, stdout: "", stderr: "" });
    expect(await checkConftest({ root: "/repo", env: {}, run: mute.run })).toEqual({
      ok: false,
      reason: { kind: "no-version" },
    });
    const missing: ProcessRunner = async () => ({ status: "not-started" });
    expect(await checkConftest({ root: "/repo", env: {}, run: missing })).toEqual({
      ok: false,
      reason: { kind: "tool-missing" },
    });
  });
});
