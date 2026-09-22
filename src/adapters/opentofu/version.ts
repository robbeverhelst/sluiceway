import type { Stack } from "../../core/stack.ts";
import { type ToolContext, ToolVersionError } from "../adapter.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
import { versionCommand } from "./commands.ts";
import { tofuEnvironment } from "./environment.ts";

// The floor of record 0053: the oldest release line that OpenTofu still
// patches, 1.11, on 2026-09-22 (its releases page: 1.12.6 and 1.11.14 came
// out together, and 1.10 got its last patch in May 2026). Everything the
// adapter reads was recorded with v1.11.0 and v1.12.6.
export const MINIMUM_VERSION = [1, 11, 0] as const;

const NEEDS = `Sluiceway needs tofu v${MINIMUM_VERSION.join(".")} or newer`;

// "tofu version -json" needs no backend and no init.
const TIME_LIMIT_MS = 60_000;

export async function checkVersion(context: ToolContext, _stacks: Stack[]): Promise<void> {
  const result = await context.run({
    argv: versionCommand(),
    cwd: context.root,
    env: tofuEnvironment(context.env),
    timeoutMs: TIME_LIMIT_MS,
  });
  if (result.status === "not-started") {
    throw new ToolVersionError(
      `Could not start tofu. ${NEEDS} on PATH and does not install it. Add a workflow step that installs tofu before the step that runs Sluiceway.`,
    );
  }

  const version =
    result.status === "exited" && result.exitCode === 0 ? readVersion(result.stdout) : undefined;
  // A pre-release or a build counts as its version.
  const found =
    version === undefined ? null : /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]*)?$/.exec(version);
  if (found === null || version === undefined) {
    throw new ToolVersionError(
      `"tofu version -json" did not print a version Sluiceway can read. ${NEEDS}. The job log holds what the tool printed.`,
      stripAnsi(result.stdout + result.stderr),
    );
  }
  const numbers = [Number(found[1]), Number(found[2]), Number(found[3])];
  const older = MINIMUM_VERSION.map((floor, index) => (numbers[index] ?? 0) - floor).find(
    (difference) => difference !== 0,
  );
  if (older !== undefined && older < 0) {
    // The text is one the pattern above let through.
    throw new ToolVersionError(
      `Found tofu v${version}. ${NEEDS}. Change the workflow step that installs tofu so it installs a newer version.`,
    );
  }
}

// The key keeps its old name in OpenTofu for compatibility (the docs).
function readVersion(stdout: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const version = (parsed as { terraform_version?: unknown }).terraform_version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}
