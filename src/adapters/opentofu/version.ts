import type { Stack } from "../../core/stack.ts";
import { type ToolContext, ToolVersionError } from "../adapter.ts";
import { stripAnsi } from "../tool-run.ts";
import {
  binaryOf,
  cdktfVersionCommand,
  terragruntVersionCommand,
  versionCommand,
} from "./commands.ts";
import { optionsOf, tofuEnvironment } from "./environment.ts";
import { CDKTF, TERRAGRUNT } from "./options.ts";

// The floor of record 0053: the oldest release line that OpenTofu still
// patches, 1.11, on 2026-09-22 (its releases page: 1.12.6 and 1.11.14 came
// out together, and 1.10 got its last patch in May 2026). Everything the
// adapter reads was recorded with v1.11.0 and v1.12.6.
export const MINIMUM_VERSION = [1, 11, 0] as const;

// The floors of record 0068, on 2026-09-22. Terraform: HashiCorp fixes the
// newest three minor lines (its support policy), 1.16, 1.15 and 1.14, and
// the plan was recorded with v1.14.0 and v1.16.3. Terragrunt: v1.0.0, the
// first release of its stable command line, recorded with v1.0.0 and v1.1.6.
// CDK for Terraform: v0.21.0, its last release, before HashiCorp archived it
// in December 2025.
export const MINIMUM_TERRAFORM_VERSION = [1, 14, 0] as const;
export const MINIMUM_TERRAGRUNT_VERSION = [1, 0, 0] as const;
export const MINIMUM_CDKTF_VERSION = [0, 21, 0] as const;

// A version command needs no backend and no init.
const TIME_LIMIT_MS = 60_000;

interface Check {
  name: string;
  argv: string[];
  floor: readonly [number, number, number];
  read: (stdout: string) => string | undefined;
}

// Each binary the stacks need, once: the tool behind every stack first, in
// the order tofu, terraform, then the wrappers.
export async function checkVersion(context: ToolContext, stacks: Stack[]): Promise<void> {
  const binaries = new Set(stacks.map((stack) => binaryOf(optionsOf(stack).tool)));
  const wrappers = new Set(stacks.map((stack) => optionsOf(stack).wrapper));
  const checks: Check[] = [];
  // No stack at all still checks tofu, as before the family.
  if (binaries.has("tofu") || stacks.length === 0) {
    checks.push({
      name: "tofu",
      argv: versionCommand("tofu"),
      floor: MINIMUM_VERSION,
      read: readJsonVersion,
    });
  }
  if (binaries.has("terraform")) {
    checks.push({
      name: "terraform",
      argv: versionCommand("terraform"),
      floor: MINIMUM_TERRAFORM_VERSION,
      read: readJsonVersion,
    });
  }
  if (wrappers.has(TERRAGRUNT)) {
    checks.push({
      name: TERRAGRUNT,
      argv: terragruntVersionCommand(),
      floor: MINIMUM_TERRAGRUNT_VERSION,
      // "terragrunt version v1.1.6"
      read: (stdout) => /^terragrunt version v(\S+)\s*$/.exec(stdout.trim())?.[1],
    });
  }
  if (wrappers.has(CDKTF)) {
    checks.push({
      name: CDKTF,
      argv: cdktfVersionCommand(),
      floor: MINIMUM_CDKTF_VERSION,
      // "0.21.0"
      read: (stdout) => stdout.trim() || undefined,
    });
  }
  for (const check of checks) await checkOne(context, check);
}

async function checkOne(context: ToolContext, check: Check): Promise<void> {
  const { name, floor } = check;
  const needs = `Sluiceway needs ${name} v${floor.join(".")} or newer`;
  const result = await context.run({
    argv: check.argv,
    cwd: context.root,
    env: tofuEnvironment(context.env),
    timeoutMs: TIME_LIMIT_MS,
  });
  if (result.status === "not-started") {
    throw new ToolVersionError(
      `Could not start ${name}. ${needs} on PATH and does not install it. Add a workflow step that installs ${name} before the step that runs Sluiceway.`,
    );
  }

  const version =
    result.status === "exited" && result.exitCode === 0 ? check.read(result.stdout) : undefined;
  // A pre-release or a build counts as its version.
  const found =
    version === undefined ? null : /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]*)?$/.exec(version);
  if (found === null || version === undefined) {
    throw new ToolVersionError(
      `"${check.argv.join(" ")}" did not print a version Sluiceway can read. ${needs}. The job log holds what the tool printed.`,
      stripAnsi(result.stdout + result.stderr),
    );
  }
  const numbers = [Number(found[1]), Number(found[2]), Number(found[3])];
  const older = floor
    .map((least, index) => (numbers[index] ?? 0) - least)
    .find((difference) => difference !== 0);
  if (older !== undefined && older < 0) {
    // The text is one the pattern above let through.
    throw new ToolVersionError(
      `Found ${name} v${version}. ${needs}. Change the workflow step that installs ${name} so it installs a newer version.`,
    );
  }
}

// The key keeps its old name in OpenTofu for compatibility (the docs), and
// Terraform prints the same.
function readJsonVersion(stdout: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const version = (parsed as { terraform_version?: unknown }).terraform_version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}
