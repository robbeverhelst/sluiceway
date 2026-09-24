// Policies on the preview (record 0106): a repo names directories of Rego
// policies, and a scan runs Conftest over the tool's own preview document of
// every pending stack, in the same job, right after the preview. A policy
// that fails takes the box off the row and names the policy in its own words;
// a policy that could not run is a warning line, not a failed policy. This is
// the pure part: the command line, the version rule, the reading of the
// report and the decision. The runner in src/policy/ starts the process.

import { z } from "zod";
import type { ToolRun } from "../adapters/tool-run.ts";

// The first version whose report the fixtures were recorded with. The JSON
// report, `--all-namespaces` and `--no-color` are the same on the newest one.
export const CONFTEST_MINIMUM_VERSION = "0.50.0";

export const CONFTEST_VERSION_ARGV = ["conftest", "--version"];

// One document, every namespace of every policy directory, as JSON. Colour
// is turned off so a report that is not JSON reads in the job log as it is.
export function conftestArgv(policies: readonly string[], document: string): string[] {
  return [
    "conftest",
    "test",
    "--output",
    "json",
    "--all-namespaces",
    "--no-color",
    ...policies.flatMap((path) => ["--policy", path]),
    document,
  ];
}

// `conftest --version` prints `Conftest: <version>` on a line of its own,
// then the OPA version.
export function parseConftestVersion(stdout: string): string | undefined {
  return /^Conftest: v?(\d+\.\d+\.\d+)\s*$/m.exec(stdout)?.[1];
}

export type ConftestVersionProblem = { kind: "no-version" } | { kind: "too-old"; found: string };

export function conftestVersionProblem(
  found: string | undefined,
): ConftestVersionProblem | undefined {
  if (found === undefined) return { kind: "no-version" };
  const parts = (version: string) => version.split(".").map(Number);
  const [a = 0, b = 0, c = 0] = parts(found);
  const [x = 0, y = 0, w = 0] = parts(CONFTEST_MINIMUM_VERSION);
  const older = a < x || (a === x && (b < y || (b === y && c < w)));
  return older ? { kind: "too-old", found } : undefined;
}

// Conftest exits with 1 both for a failed policy and for a run that failed,
// such as a policy that does not parse (recorded on 0.50.0 and 0.70.1). The
// report on stdout tells them apart: a run that failed prints none.
export const CONFTEST_EXIT_CODES = { success: [0, 1] } as const;

// One failure or warning, in the policy's own words. The words are the
// repo's own, from its policy files on the default branch, and untrusted as
// markup wherever they are shown (record 0106).
export interface PolicyFailure {
  namespace: string;
  message: string;
}

export interface PolicyReport {
  // Sorted by namespace, and within one in the order the policy gave them.
  failures: PolicyFailure[];
  warnings: PolicyFailure[];
  // How many rules gave nothing, over every namespace.
  passed: number;
  // Every namespace the policies hold, sorted.
  namespaces: string[];
}

// Why the policies of a stack could not be run. Each is a constant of
// Sluiceway's own, with facts Sluiceway produced filled in (record 0022):
// an exit code, a time limit, a path from the config. Never the tool's words.
export type PolicyRunFailure =
  | { kind: "tool-missing" }
  | { kind: "tool-error"; exitCode: number | null }
  | { kind: "timed-out"; minutes: number }
  | { kind: "unreadable-output" }
  | ConftestVersionProblem
  // A policy path of the config that the checkout does not hold.
  | { kind: "path-missing"; path: string }
  // The preview gave no document to test, so there was nothing to run on.
  | { kind: "no-document" };

export type PolicyOutcome =
  | { kind: "passed"; report: PolicyReport }
  // A hard failure: the row has no box until it passes (record 0106).
  | { kind: "failed"; report: PolicyReport }
  // A warning line on the row, not a failed policy.
  | { kind: "not-run"; reason: PolicyRunFailure };

// A result is a message, or an object whose `msg` is the message. Conftest
// 0.50.0 prints no metadata; 0.70.1 prints the query under it. Both are
// dropped: only the message leaves.
const result = z.object({ msg: z.string() });

const entry = z.object({
  namespace: z.string(),
  successes: z.number().int().nonnegative().optional(),
  failures: z.array(result).optional(),
  warnings: z.array(result).optional(),
});

const report = z.array(entry);

// The report Conftest printed, or nothing when it is not one.
export function parseConftestReport(stdout: string): PolicyReport | undefined {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const parsed = report.safeParse(json);
  if (!parsed.success) return undefined;
  const byNamespace = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const entries = [...parsed.data].sort((a, b) => byNamespace(a.namespace, b.namespace));
  const found = (key: "failures" | "warnings") =>
    entries.flatMap((one) =>
      (one[key] ?? []).map(({ msg }) => ({ namespace: one.namespace, message: msg })),
    );
  return {
    failures: found("failures"),
    warnings: found("warnings"),
    passed: entries.reduce((sum, one) => sum + (one.successes ?? 0), 0),
    namespaces: [...new Set(entries.map((one) => one.namespace))].sort(byNamespace),
  };
}

// What one run of conftest over one document is, from its exit code and its
// report. A run that could not start is the tool missing: conftest is the
// only command Sluiceway starts by that name.
export function policyOutcome(run: ToolRun): PolicyOutcome {
  if (!run.ok) {
    const { reason } = run;
    if (reason.kind === "tool-error" && reason.exitCode === null) {
      return { kind: "not-run", reason: { kind: "tool-missing" } };
    }
    if (reason.kind === "tool-error") {
      return { kind: "not-run", reason: { kind: "tool-error", exitCode: reason.exitCode } };
    }
    if (reason.kind === "timed-out") return { kind: "not-run", reason };
    return { kind: "not-run", reason: { kind: "unreadable-output" } };
  }
  const parsed = parseConftestReport(run.stdout);
  if (parsed === undefined) {
    return run.exitCode === 0
      ? { kind: "not-run", reason: { kind: "unreadable-output" } }
      : { kind: "not-run", reason: { kind: "tool-error", exitCode: run.exitCode } };
  }
  return parsed.failures.length > 0
    ? { kind: "failed", report: parsed }
    : { kind: "passed", report: parsed };
}

// The fixed words for a run that failed (record 0022): display text, and
// nothing is decided from it.
export function policyRunFailureText(reason: PolicyRunFailure): string {
  switch (reason.kind) {
    case "tool-missing":
      return "conftest is not installed on the runner";
    case "tool-error":
      return reason.exitCode === null
        ? "conftest exited with an error"
        : `conftest exited with an error (exit code ${reason.exitCode})`;
    case "timed-out":
      return `conftest ran out of time (${reason.minutes} ${reason.minutes === 1 ? "minute" : "minutes"})`;
    case "unreadable-output":
      return "the report of conftest could not be read";
    case "too-old":
      return `conftest ${reason.found} is older than the ${CONFTEST_MINIMUM_VERSION} Sluiceway needs`;
    case "no-version":
      return "conftest did not say which version it is";
    case "path-missing":
      return `the policy path ${reason.path} is not in the repo`;
    case "no-document":
      return "the preview gave no document to test";
  }
}
