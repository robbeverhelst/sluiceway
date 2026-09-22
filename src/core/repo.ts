import {
  applyConfig,
  type Config,
  type ConfiguredStack,
  type IgnoredStack,
  ignoredStacks,
} from "./config.ts";
import { loadConfig } from "./config-file.ts";
import { type Stack, stackId } from "./stack.ts";

// The one way a mode works out which stacks a repo has: the config file, then
// discovery with it, then the stacks that exist for Sluiceway and the ones an
// `ignore` entry with a reason leaves out. A mode opens the repo once per run
// and asks it, so the config file is read once and discovery runs once, and
// every mode sees the stacks in the same order: the order of the rows.
//
// Both halves wait until they are asked. A mode that has nothing to do never
// reads the file, and one that needs only the config never runs discovery, so
// a broken file or a failed discovery fails only a run that needed it.

// What discovery is asked, the adapter's own call.
export interface Discovery {
  discover(root: string, config: Config): Promise<Stack[]>;
}

export interface RepoStacks {
  // Every stack that exists for Sluiceway, with what config gives it, in
  // stack id order.
  stacks: ConfiguredStack[];
  // The stacks an `ignore` entry with a reason leaves out (record 0051), in
  // stack id order.
  ignored: IgnoredStack[];
}

export interface Repo {
  // The config file, read on the first ask. A file that cannot be read throws
  // the same error on every ask.
  config(): Config;
  // Discovery with that config, run on the first ask. A config error comes
  // first, then a discovery error, then an error of `stacks` entries against
  // what discovery found (record 0012).
  stacks(): Promise<RepoStacks>;
}

export function openRepo(root: string, discovery: Discovery): Repo {
  let read: { config: Config } | { error: unknown } | undefined;
  let stacks: Promise<RepoStacks> | undefined;
  const config = (): Config => {
    if (read === undefined) {
      try {
        read = { config: loadConfig(root) };
      } catch (error) {
        read = { error };
      }
    }
    if ("error" in read) throw read.error;
    return read.config;
  };
  const load = async (): Promise<RepoStacks> => {
    const loaded = config();
    const found = await discovery.discover(root, loaded);
    const ignored = ignoredStacks(loaded, found);
    return {
      stacks: applyConfig(loaded, found).sort((a, b) =>
        byCodeUnit(stackId(a.stack), stackId(b.stack)),
      ),
      ignored,
    };
  };
  return {
    config,
    stacks: () => {
      stacks ??= load();
      return stacks;
    },
  };
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
