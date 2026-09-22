// The check of record 0042: what a scan would make of this repo's files,
// worked out without a preview, a credential or a GitHub call. It holds the
// facts. The words are render/check.ts.

import { claim } from "./claim.ts";
import { applyConfig, type Config, type ConfiguredStack, ignoreGlob } from "./config.ts";
import { globMatcher } from "./glob.ts";
import { type Stack, stackId } from "./stack.ts";

// One `ignore` glob and the stacks it leaves out.
export interface IgnoreReport {
  glob: string;
  stacks: string[];
  // Only for a glob that leaves out nothing but matches the directory of a
  // stack: `ignore` is matched against the stack id, never the bare path
  // (record 0010), and this is the glob that would have worked (onboarding
  // log, hurdle 4).
  hint?: { glob: string; stacks: string[] };
}

// Files that no stack claims, under one directory at the top of the repo.
export interface UnclaimedGroup {
  // "." for the files at the repo root.
  directory: string;
  files: string[];
}

export interface CheckReport {
  // Every stack that exists for Sluiceway, with its settings.
  stacks: ConfiguredStack[];
  ignore: IgnoreReport[];
  // A push that changes one of these files is a full scan (record 0010). The
  // root first, then by directory, in code unit order.
  unclaimed: UnclaimedGroup[];
  // Globs from SUGGESTIONS that cover at least one unclaimed file. They are
  // offered for scan.unrelated and never applied: whether a program reads a
  // file is the user's to say (record 0042).
  suggested: string[];
}

// Files that look like docs and tooling, which programs seldom read. A fixed
// list, so the suggestion is the same for everyone. A lockfile, a package
// manifest or a tsconfig is left out on purpose: they are the shared files that
// record 0010 wants to give a full scan.
const SUGGESTIONS = [
  "**/*.md",
  "docs/**",
  ".github/**",
  "LICENSE*",
  "**/.gitignore",
  "**/.gitattributes",
  ".editorconfig",
];

// Throws what a scan throws for the same repo: a ConfigError or a
// DiscoveryError, with the same messages, because it is the same code.
// `files` are the files of the repo, relative to its root, forward slashes.
export function checkSetup(config: Config, found: Stack[], files: string[]): CheckReport {
  const stacks = applyConfig(config, found);
  const { unclaimed } = claim(
    stacks.map(({ stack, inputs }) => ({ id: stackId(stack), path: stack.path, inputs })),
    files,
    config.scan.unrelated,
  );
  return {
    stacks,
    ignore: config.ignore.map((entry) => ignoreReport(ignoreGlob(entry), found)),
    unclaimed: groups(unclaimed),
    suggested: suggestedUnrelated(unclaimed),
  };
}

// The globs of SUGGESTIONS that cover at least one of these unclaimed files,
// in the order of the list. The check offers them for the whole repo, and a
// scan that fell back to a full scan for the files that made it fall back
// (onboarding log, hurdle 5).
export function suggestedUnrelated(unclaimed: string[]): string[] {
  return SUGGESTIONS.filter((glob) => unclaimed.some(globMatcher([glob])));
}

function ignoreReport(glob: string, found: Stack[]): IgnoreReport {
  const matches = globMatcher([glob]);
  const stacks = found.map(stackId).filter(matches);
  if (stacks.length > 0) return { glob, stacks };
  const better = `${glob}:*`;
  const works = globMatcher([better]);
  const hinted = found
    .filter((stack) => matches(stack.path))
    .map(stackId)
    .filter(works);
  return hinted.length === 0
    ? { glob, stacks }
    : { glob, stacks, hint: { glob: better, stacks: hinted } };
}

function groups(files: string[]): UnclaimedGroup[] {
  const top = (file: string): string => {
    const slash = file.indexOf("/");
    return slash === -1 ? "." : file.slice(0, slash);
  };
  const byDirectory = Map.groupBy([...files].sort(byCodeUnit), top);
  return [...byDirectory]
    .sort(([a], [b]) => (a === "." ? -1 : b === "." ? 1 : byCodeUnit(a, b)))
    .map(([directory, grouped]) => ({ directory, files: grouped }));
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
