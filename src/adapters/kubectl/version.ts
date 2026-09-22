import type { Stack } from "../../core/stack.ts";
import { type ToolContext, ToolVersionError } from "../adapter.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
import { versionCommand } from "./commands.ts";
import { kubectlEnvironment } from "./environment.ts";

// The floor of record 0060: the oldest Kubernetes release line still patched
// on 2026-09-22. The releases page on kubernetes.io lists 1.37, 1.36, 1.35
// and 1.34 as supported, 1.34 until 2026-10-27, and 1.33 as ended in June
// 2026. Everything the adapter reads was recorded with v1.34.0 against a 1.34
// cluster and v1.37.0 against a 1.37 cluster.
export const MINIMUM_VERSION = [1, 34, 0] as const;

const NEEDS = `Sluiceway needs kubectl v${MINIMUM_VERSION.join(".")} or newer`;

// The client version needs no cluster.
const TIME_LIMIT_MS = 60_000;

export async function checkVersion(context: ToolContext, _stacks: Stack[]): Promise<void> {
  const result = await context.run({
    argv: versionCommand(),
    cwd: context.root,
    env: kubectlEnvironment(context.env),
    timeoutMs: TIME_LIMIT_MS,
  });
  if (result.status === "not-started") {
    throw new ToolVersionError(
      `Could not start kubectl. ${NEEDS} on PATH and does not install it. Add a workflow step that installs kubectl before the step that runs Sluiceway.`,
    );
  }

  const version =
    result.status === "exited" && result.exitCode === 0 ? readVersion(result.stdout) : undefined;
  // A pre-release, or the build of a provider's distribution, counts as its
  // version.
  const found =
    version === undefined ? null : /^v(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]*)?$/.exec(version);
  if (found === null || version === undefined) {
    throw new ToolVersionError(
      `"${versionCommand().join(" ")}" did not print a version Sluiceway can read. ${NEEDS}. The job log holds what the tool printed.`,
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
      `Found kubectl ${version}. ${NEEDS}. Change the workflow step that installs kubectl so it installs a newer version.`,
    );
  }
}

function readVersion(stdout: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const client = (parsed as { clientVersion?: { gitVersion?: unknown } }).clientVersion;
    return typeof client?.gitVersion === "string" ? client.gitVersion : undefined;
  } catch {
    return undefined;
  }
}
