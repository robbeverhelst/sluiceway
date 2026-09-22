import { type ToolContext, ToolVersionError } from "../adapter.ts";
import { stripAnsi } from "../tool-run.ts";
import { pulumiEnvironment } from "./environment.ts";

// The floor of record 0001: exit codes are only distinct from v3.226.1, and
// "refresh --preview-only" stops taking the stack lock in v3.229.0.
export const MINIMUM_VERSION = [3, 229, 0] as const;

const NEEDS = `Sluiceway needs pulumi v${MINIMUM_VERSION.join(".")} or newer`;

// "pulumi version" prints nothing but the version. It needs no backend.
const TIME_LIMIT_MS = 60_000;

export async function checkVersion(context: ToolContext): Promise<void> {
  const result = await context.run({
    argv: ["pulumi", "version"],
    cwd: context.root,
    env: pulumiEnvironment(context.env),
    timeoutMs: TIME_LIMIT_MS,
  });
  if (result.status === "not-started") {
    throw new ToolVersionError(
      `Could not start pulumi. ${NEEDS} on PATH and does not install it. Add a workflow step that installs pulumi before the step that runs Sluiceway.`,
    );
  }

  // A pre-release or a build of the floor counts as the floor.
  const found =
    result.status === "exited" && result.exitCode === 0
      ? /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]*)?\s*$/.exec(result.stdout)
      : null;
  if (found === null) {
    throw new ToolVersionError(
      `"pulumi version" did not print a version Sluiceway can read. ${NEEDS}. The job log holds what the tool printed.`,
      stripAnsi(result.stdout + result.stderr),
    );
  }

  const numbers = [Number(found[1]), Number(found[2]), Number(found[3])];
  const older = MINIMUM_VERSION.map((floor, index) => (numbers[index] ?? 0) - floor).find(
    (difference) => difference !== 0,
  );
  if (older !== undefined && older < 0) {
    // The text is one the pattern above let through: digits, dots and a suffix.
    throw new ToolVersionError(
      `Found pulumi ${result.stdout.trim()}. ${NEEDS}. Change the workflow step that installs pulumi so it installs a newer version.`,
    );
  }
}
