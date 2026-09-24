// The policy runner (record 0106): starts conftest over the preview document
// of one stack, through the process runner every tool is started through,
// and hands back what the core makes of the report. Conftest is installed by
// the workflow, like the tool, and never wrapped (record 0013). The document
// is the tool's own preview, values and all (record 0021), so it is written
// to a file in a directory of its own, readable by nobody else, only for as
// long as conftest runs, and removed on every way out.

import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { PreviewDocument, ToolContext } from "../adapters/adapter.ts";
import { toolEnvironment } from "../adapters/environment.ts";
import { runTool } from "../adapters/tool-run.ts";
import {
  CONFTEST_EXIT_CODES,
  CONFTEST_VERSION_ARGV,
  type ConftestVersionProblem,
  conftestArgv,
  conftestVersionProblem,
  type PolicyOutcome,
  parseConftestVersion,
  policyOutcome,
} from "../core/policy.ts";

export interface PolicyRunSpec extends ToolContext {
  // The stack's time limit, in whole minutes, as for its preview.
  timeoutMinutes: number;
  // The policy paths of the stack, relative to the root, as the config lists
  // them.
  policies: readonly string[];
  // What the preview gave, or nothing for a tool that gives no document.
  document: PreviewDocument | undefined;
}

export interface PolicyRunResult {
  outcome: PolicyOutcome;
  // Conftest's own words, its stderr, for the job log and nowhere else
  // (record 0022).
  toolLog: string;
}

export async function runPolicies(spec: PolicyRunSpec): Promise<PolicyRunResult> {
  if (spec.document === undefined) {
    return { outcome: { kind: "not-run", reason: { kind: "no-document" } }, toolLog: "" };
  }
  // A path the checkout does not hold is said in Sluiceway's words, before
  // conftest is started: its own error would be one more "exited with an
  // error", and the path is the config's, not the tool's.
  for (const path of spec.policies) {
    if (isAbsolute(path) || !(await exists(join(spec.root, path)))) {
      return { outcome: { kind: "not-run", reason: { kind: "path-missing", path } }, toolLog: "" };
    }
  }
  const dir = await mkdtemp(join(tmpdir(), "sluiceway-policy-"));
  try {
    const file = join(dir, `preview.${spec.document.format}`);
    await writeFile(file, spec.document.text, { mode: 0o600 });
    const run = await runTool(spec.run, {
      argv: conftestArgv(spec.policies, file),
      cwd: spec.root,
      env: toolEnvironment(spec.env),
      timeoutMinutes: spec.timeoutMinutes,
      exitCodes: CONFTEST_EXIT_CODES,
    });
    // Never stdout: it is the report, which the core reads, and the policy
    // may quote the document in it.
    return { outcome: policyOutcome(run), toolLog: run.stderr };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export type ConftestCheck =
  | { ok: true; version: string }
  | { ok: false; reason: { kind: "tool-missing" } | ConftestVersionProblem };

// Once a job, before any policy runs: conftest is there and new enough. A
// conftest that is missing or too old is no failure of the job (record
// 0106): every stack's policies are then a warning line, not a failed
// policy, and the job log says what to install.
export async function checkConftest(context: ToolContext): Promise<ConftestCheck> {
  const result = await context.run({
    argv: CONFTEST_VERSION_ARGV,
    cwd: context.root,
    env: toolEnvironment(context.env),
    timeoutMs: 60_000,
  });
  if (result.status === "not-started") return { ok: false, reason: { kind: "tool-missing" } };
  const found = result.status === "exited" ? parseConftestVersion(result.stdout) : undefined;
  const problem = conftestVersionProblem(found);
  if (problem !== undefined) return { ok: false, reason: problem };
  return { ok: true, version: found ?? "" };
}
