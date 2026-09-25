import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CONFTEST_MINIMUM_VERSION,
  CONFTEST_VERSION_ARGV,
  conftestArgv,
  conftestVersionProblem,
  parseConftestVersion,
  policyOutcome,
  policyRunFailureText,
} from "../../src/core/policy.ts";
import type { ToolRun } from "../../src/core/tool-result.ts";

// Slice 5.41 (record 0106): Conftest is the policy runner, installed by the
// workflow and started by Sluiceway against the preview document of a stack,
// never wrapped. Its command line, its version and its report are read here,
// in the core, so the runner in src/policy/ only starts the process.

describe("the conftest command", () => {
  test("tests one document against the policy directories, every namespace, as JSON", () => {
    expect(conftestArgv(["policies", "policies/prod"], "/tmp/x/preview.json")).toEqual([
      "conftest",
      "test",
      "--output",
      "json",
      "--all-namespaces",
      "--no-color",
      "--policy",
      "policies",
      "--policy",
      "policies/prod",
      "/tmp/x/preview.json",
    ]);
  });

  test("asks for the version with the flag both supported versions know", () => {
    expect(CONFTEST_VERSION_ARGV).toEqual(["conftest", "--version"]);
  });
});

describe("the conftest version", () => {
  test("is read from the line that names it, and nothing else of the output", () => {
    expect(parseConftestVersion("Conftest: 0.70.1\nOPA: 1.20.2\n")).toBe("0.70.1");
    expect(parseConftestVersion("Conftest: 0.50.0\nOPA: 0.62.1\n")).toBe("0.50.0");
  });

  test("is not read from output that does not name one", () => {
    expect(parseConftestVersion("")).toBeUndefined();
    expect(parseConftestVersion("OPA: 1.20.2\n")).toBeUndefined();
    expect(parseConftestVersion("conftest version 0.70.1")).toBeUndefined();
  });

  test("the minimum is 0.50.0, and an older one is refused in Sluiceway's words", () => {
    expect(CONFTEST_MINIMUM_VERSION).toBe("0.50.0");
    expect(conftestVersionProblem("0.50.0")).toBeUndefined();
    expect(conftestVersionProblem("0.70.1")).toBeUndefined();
    expect(conftestVersionProblem("1.2.0")).toBeUndefined();
    expect(conftestVersionProblem("0.49.1")).toEqual({ kind: "too-old", found: "0.49.1" });
    expect(conftestVersionProblem(undefined)).toEqual({ kind: "no-version" });
  });
});

// The report of each recorded scenario, on every recorded version. Fixtures
// are never written by hand (record 0001).
const FIXTURES = resolve(import.meta.dir, "../fixtures/conftest");
const VERSIONS = readdirSync(FIXTURES).sort();

function recorded(version: string, scenario: string): ToolRun {
  const file = join(FIXTURES, version, scenario, "recording.json");
  const { exitCode, stdout, stderr } = JSON.parse(readFileSync(file, "utf8")) as {
    exitCode: number;
    stdout: string;
    stderr: string;
  };
  // The runner reads the report after exit 0 and 1 (CONFTEST_EXIT_CODES).
  return exitCode === 0 || exitCode === 1
    ? { ok: true, exitCode, stdout, stderr }
    : { ok: false, reason: { kind: "tool-error", exitCode }, stdout, stderr };
}

describe.each(VERSIONS)("the report of conftest %s", (version) => {
  test("the fixtures were recorded with two versions", () => {
    expect(VERSIONS).toEqual(["v0.50.0", "v0.70.1"]);
  });

  test("every rule passes: nothing failed, and the rules are counted", () => {
    expect(policyOutcome(recorded(version, "pass"))).toEqual({
      kind: "passed",
      report: { failures: [], warnings: [], passed: 5, namespaces: ["main", "manifests", "prod"] },
    });
  });

  test("failures in two namespaces, sorted by namespace, each in the policy's own words", () => {
    const outcome = policyOutcome(recorded(version, "failures"));
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.report.failures).toEqual([
      {
        namespace: "main",
        message: "urn:pulumi:prod::app::aws:s3/bucket:Bucket::uploads must not be deleted",
      },
      {
        namespace: "prod",
        message:
          "no deletes in prod <b>bold</b> *star* [link](https://example.com) #123 @alice `tick` line one\nline two",
      },
      { namespace: "prod", message: "a structured message" },
    ]);
    expect(outcome.report.warnings).toEqual([
      {
        namespace: "main",
        message: "urn:pulumi:prod::app::aws:s3/bucket:Bucket::logs is replaced",
      },
    ]);
    expect(outcome.report.passed).toBe(1);
    expect(outcome.report.namespaces).toEqual(["main", "manifests", "prod"]);
  });

  test("a policy that does not parse is a run that failed, never a failed policy", () => {
    expect(policyOutcome(recorded(version, "broken-policy"))).toEqual({
      kind: "not-run",
      reason: { kind: "tool-error", exitCode: 1 },
    });
  });

  test("a policy directory that is not there and an input that is not JSON are the same", () => {
    expect(policyOutcome(recorded(version, "missing-policy"))).toEqual({
      kind: "not-run",
      reason: { kind: "tool-error", exitCode: 1 },
    });
    expect(policyOutcome(recorded(version, "unreadable-input"))).toEqual({
      kind: "not-run",
      reason: { kind: "tool-error", exitCode: 1 },
    });
  });

  test("a directory with no deny or warn rule passes with nothing counted", () => {
    expect(policyOutcome(recorded(version, "no-rules"))).toEqual({
      kind: "passed",
      report: { failures: [], warnings: [], passed: 0, namespaces: ["main"] },
    });
  });

  test("two directories are one report", () => {
    const outcome = policyOutcome(recorded(version, "two-directories"));
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.report.failures.length).toBe(3);
  });

  test("a YAML stream of several objects is judged object by object", () => {
    const outcome = policyOutcome(recorded(version, "manifests"));
    expect(outcome).toMatchObject({
      kind: "failed",
      report: { failures: [{ namespace: "manifests", message: "web needs at least 2 replicas" }] },
    });
  });
});

describe("what a run of conftest comes to", () => {
  test("a run that could not start is the tool missing", () => {
    expect(
      policyOutcome({
        ok: false,
        reason: { kind: "tool-error", exitCode: null },
        stdout: "",
        stderr: "",
      }),
    ).toEqual({ kind: "not-run", reason: { kind: "tool-missing" } });
  });

  test("a run that ran out of time says so", () => {
    expect(
      policyOutcome({
        ok: false,
        reason: { kind: "timed-out", minutes: 10 },
        stdout: "",
        stderr: "",
      }),
    ).toEqual({ kind: "not-run", reason: { kind: "timed-out", minutes: 10 } });
  });

  test("a report that is not JSON, or not a report, could not be read", () => {
    for (const stdout of [
      "not json",
      "{}",
      '[{"namespace": 1}]',
      '[{"filename":"a","namespace":"main","failures":[{"msg":3}]}]',
    ]) {
      expect(policyOutcome({ ok: true, exitCode: 0, stdout, stderr: "" })).toEqual({
        kind: "not-run",
        reason: { kind: "unreadable-output" },
      });
    }
  });

  test("a failure that is an object with a message reads as its message, and metadata is dropped", () => {
    const stdout = JSON.stringify([
      {
        filename: "x",
        namespace: "a",
        successes: 0,
        failures: [{ msg: "m", metadata: { severity: "high" } }],
      },
    ]);
    expect(policyOutcome({ ok: true, exitCode: 1, stdout, stderr: "" })).toEqual({
      kind: "failed",
      report: {
        failures: [{ namespace: "a", message: "m" }],
        warnings: [],
        passed: 0,
        namespaces: ["a"],
      },
    });
  });

  test("an exit code of 1 with a report is the report, and any other code is a run that failed", () => {
    const stdout = JSON.stringify([{ filename: "x", namespace: "main", successes: 1 }]);
    expect(policyOutcome({ ok: true, exitCode: 1, stdout, stderr: "" })).toMatchObject({
      kind: "passed",
    });
    // The runner reads no report after any other code (CONFTEST_EXIT_CODES).
    expect(
      policyOutcome({ ok: false, reason: { kind: "tool-error", exitCode: 2 }, stdout, stderr: "" }),
    ).toEqual({ kind: "not-run", reason: { kind: "tool-error", exitCode: 2 } });
  });
});

describe("the words for a run that failed", () => {
  test("come from a fixed list and never quote the tool", () => {
    expect(policyRunFailureText({ kind: "tool-missing" })).toBe(
      "conftest is not installed on the runner",
    );
    expect(policyRunFailureText({ kind: "tool-error", exitCode: 1 })).toBe(
      "conftest exited with an error (exit code 1)",
    );
    expect(policyRunFailureText({ kind: "tool-error", exitCode: null })).toBe(
      "conftest exited with an error",
    );
    expect(policyRunFailureText({ kind: "timed-out", minutes: 10 })).toBe(
      "conftest ran out of time (10 minutes)",
    );
    expect(policyRunFailureText({ kind: "unreadable-output" })).toBe(
      "the report of conftest could not be read",
    );
    expect(policyRunFailureText({ kind: "too-old", found: "0.49.1" })).toBe(
      "conftest 0.49.1 is older than the 0.50.0 Sluiceway needs",
    );
    expect(policyRunFailureText({ kind: "no-version" })).toBe(
      "conftest did not say which version it is",
    );
    expect(policyRunFailureText({ kind: "path-missing", path: "policies/prod" })).toBe(
      "the policy path policies/prod is not in the repo",
    );
    expect(policyRunFailureText({ kind: "no-document" })).toBe(
      "the preview gave no document to test",
    );
  });
});
