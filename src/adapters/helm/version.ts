import type { Stack } from "../../core/stack.ts";
import { type ToolContext, ToolVersionError } from "../adapter.ts";
import { stripAnsi } from "../tool-run.ts";
import { pluginVersionCommand, versionCommand } from "./commands.ts";
import { helmEnvironment } from "./environment.ts";

// The floors of record 0058. The diff plugin's own README names helm v3.18
// as the oldest it installs into, and v3.15.11 is the first plugin release
// whose structured output reads a list of scalars, such as a container's
// args, instead of leaving the change out. Everything the adapter reads was
// recorded with helm v3.18.0 and plugin v3.15.11, and with helm v4.3.0 and
// plugin v3.15.13.
export const MINIMUM_VERSION = [3, 18, 0] as const;
export const MINIMUM_DIFF_VERSION = [3, 15, 11] as const;

const NEEDS = `Sluiceway needs helm v${MINIMUM_VERSION.join(".")} or newer`;
const NEEDS_DIFF = `Sluiceway needs helm-diff v${MINIMUM_DIFF_VERSION.join(".")} or newer`;

// Neither command reaches a cluster.
const TIME_LIMIT_MS = 60_000;

// A pre-release or a build counts as its version.
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.+-]*)?$/;

export async function checkVersion(context: ToolContext, _stacks: Stack[]): Promise<void> {
  const run = (argv: string[]) =>
    context.run({
      argv,
      cwd: context.root,
      env: helmEnvironment(context.env),
      timeoutMs: TIME_LIMIT_MS,
    });

  const helm = await run(versionCommand());
  if (helm.status === "not-started") {
    throw new ToolVersionError(
      `Could not start helm. ${NEEDS} on PATH and does not install it. Add a workflow step that installs helm before the step that runs Sluiceway.`,
    );
  }
  const found =
    helm.status === "exited" && helm.exitCode === 0 ? readVersion(helm.stdout) : undefined;
  if (found === undefined) {
    throw new ToolVersionError(
      `"${versionCommand().join(" ")}" did not print a version Sluiceway can read. ${NEEDS}. The job log holds what the tool printed.`,
      stripAnsi(helm.stdout + helm.stderr),
    );
  }
  if (older(found.numbers, MINIMUM_VERSION)) {
    // The text is one the pattern let through.
    throw new ToolVersionError(
      `Found helm ${found.text}. ${NEEDS}. Change the workflow step that installs helm so it installs a newer version.`,
    );
  }

  const plugin = await run(pluginVersionCommand());
  const diff =
    plugin.status === "exited" && plugin.exitCode === 0 ? readVersion(plugin.stdout) : undefined;
  if (diff === undefined) {
    throw new ToolVersionError(
      `The helm diff plugin did not say which version it is. ${NEEDS_DIFF} and does not install it. Add a workflow step that runs helm plugin install https://github.com/databus23/helm-diff before the step that runs Sluiceway.`,
      plugin.status === "not-started" ? "" : stripAnsi(plugin.stdout + plugin.stderr),
    );
  }
  if (older(diff.numbers, MINIMUM_DIFF_VERSION)) {
    throw new ToolVersionError(
      `Found helm-diff ${diff.text}. ${NEEDS_DIFF}. Change the workflow step that installs the plugin so it installs a newer version.`,
    );
  }
}

// What `helm version --template={{.Version}}` or `helm diff version` printed,
// as a version. The deploy reads the major version with it too (record 0069).
export function readVersion(stdout: string): { text: string; numbers: number[] } | undefined {
  const trimmed = stdout.trim();
  const found = VERSION.exec(trimmed);
  if (found === null) return undefined;
  const text = trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
  return { text, numbers: [Number(found[1]), Number(found[2]), Number(found[3])] };
}

function older(numbers: number[], floor: readonly number[]): boolean {
  const difference = floor
    .map((minimum, index) => (numbers[index] ?? 0) - minimum)
    .find((one) => one !== 0);
  return difference !== undefined && difference < 0;
}
