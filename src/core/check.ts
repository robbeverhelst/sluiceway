// The check of record 0042: what a scan would make of this repo's files,
// worked out without a preview, a credential or a GitHub call. It holds the
// facts. The words are render/check.ts.

import { claim } from "./claim.ts";
import { applyConfig, type Config, type ConfiguredStack, ignoreGlob } from "./config.ts";
import type { PreviewFailureReason } from "./failure-reason.ts";
import { globMatcher, globOf } from "./glob.ts";
import { type PhaseGroup, phaseGroups } from "./phases.ts";
import { unclaimedToPlace } from "./scan-plan.ts";
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
  // The unclaimed files that are lockfiles or package manifests, in code unit
  // order. They must stay off scan.unrelated (issue 164).
  shared: string[];
  // The config file, when it is there and no stack claims it. It is left out
  // of unclaimed, and the check says so (issue 164).
  configFile?: string;
  // Every phase in order with its stacks (record 0067). Empty without phases.
  phases: PhaseGroup[];
  // Files and directories that a stack's own files name as read, and that
  // the stack does not claim (record 0074), by stack id and then path.
  reads: StackRead[];
  // The same, as `stacks` entries that add them as inputs. Offered, never
  // applied: inputs add up over entries, so pasting one loses nothing.
  inputs: InputsEntry[];
}

// A file or a directory of the repo that a stack's own files name as read by
// its program or its tool (record 0074): relative to the repo root, forward
// slashes, and there when the check looked. Only its name leaves the adapter,
// never what it holds.
export interface FileReference {
  path: string;
  kind: "file" | "directory";
  // The file of the repo that names it, such as the program or sluiceway.yaml.
  namedIn: string;
}

export interface StackRead extends FileReference {
  stackId: string;
  // A push that changes it does not preview this stack, because another
  // stack claims it or scan.unrelated covers it. Otherwise such a push gives
  // a full scan, which previews the stack anyway.
  missed: boolean;
}

export interface InputsEntry {
  path: string;
  // Only when the stacks of the path do not all read the same.
  name?: string;
  globs: string[];
}

// What the backend said about one stack, for the check with backend: true
// (record 0074). `unchecked` is a stack whose tool has no list to ask.
export type BackendCheck = { stackId: string } & (
  | { found: boolean }
  | { found: "unknown"; reason: PreviewFailureReason }
  | { found: "unchecked" }
);

// Files that look like docs and tooling, which programs seldom read. A fixed
// list, so the suggestion is the same for everyone. A lockfile, a package
// manifest or a tsconfig is left out on purpose: they are the shared files that
// record 0010 wants to give a full scan. The files of DEFAULT_UNRELATED are
// never unclaimed since slice 5.9, so only what lies beyond them is here.
const SUGGESTIONS = ["docs/**"];

// Lockfiles and package manifests by file name, in any directory. A change to
// one can change what every program runs, so the docs say to keep them off
// scan.unrelated, and the hint under the unclaimed files names the ones it
// lists (issue 164). A fixed list of the common package managers; a file
// missing here is only not named, and the hint still says the rule.
const SHARED_FILES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "bun.lock",
  "bun.lockb",
  "deno.json",
  "deno.lock",
  "go.mod",
  "go.sum",
  "go.work",
  "go.work.sum",
  "Cargo.toml",
  "Cargo.lock",
  "pyproject.toml",
  "poetry.lock",
  "uv.lock",
  "Pipfile",
  "Pipfile.lock",
  "requirements.txt",
  "Gemfile",
  "Gemfile.lock",
  "composer.json",
  "composer.lock",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "gradle.lockfile",
  "packages.lock.json",
  "Directory.Packages.props",
]);

// The lockfiles and package manifests among these files, in code unit order.
export function sharedFiles(files: string[]): string[] {
  return files
    .filter((file) => SHARED_FILES.has(file.slice(file.lastIndexOf("/") + 1)))
    .sort(byCodeUnit);
}

// Throws what a scan throws for the same repo: a ConfigError or a
// DiscoveryError, with the same messages, because it is the same code.
// `files` are the files of the repo, relative to its root, forward slashes.
// `references` are what the adapter read from each stack's files, by stack
// id (record 0074).
export function checkSetup(
  config: Config,
  found: Stack[],
  files: string[],
  references: ReadonlyMap<string, FileReference[]> = new Map(),
): CheckReport {
  const stacks = applyConfig(config, found);
  const claimants = stacks.map(({ stack, inputs }) => ({
    id: stackId(stack),
    path: stack.path,
    inputs,
  }));
  const claimed = claim(claimants, files, config.scan.unrelated);
  // No stack is meant to claim the config file, and it must stay off
  // scan.unrelated, so it is not listed, as in a scan's summary (issue 164).
  const unclaimed = unclaimedToPlace(claimed.unclaimed);
  const configFile = claimed.unclaimed.find((file) => !unclaimed.includes(file));
  const reads = readsOf(claimants, files, new Set(claimed.unclaimed), references);
  return {
    stacks,
    ignore: config.ignore.map((entry) => ignoreReport(ignoreGlob(entry), found)),
    unclaimed: groups(unclaimed),
    suggested: suggestedUnrelated(unclaimed),
    shared: sharedFiles(unclaimed),
    ...(configFile === undefined ? {} : { configFile }),
    phases: phaseGroups(
      config.phases,
      new Map(
        stacks.flatMap((one) =>
          one.phase === undefined ? [] : [[stackId(one.stack), one.phase] as const],
        ),
      ),
    ),
    reads,
    inputs: inputsEntries(stacks, reads),
  };
}

// What each stack reads and does not claim itself.
function readsOf(
  claimants: { id: string; path: string; inputs: string[] }[],
  files: string[],
  unclaimed: Set<string>,
  references: ReadonlyMap<string, FileReference[]>,
): StackRead[] {
  return claimants.flatMap(({ id, path, inputs }) => {
    const matches = globMatcher(inputs);
    const claims = (file: string) => path === "." || file.startsWith(`${path}/`) || matches(file);
    const read = references.get(id) ?? [];
    return [...read]
      .sort((a, b) => byCodeUnit(a.path, b.path))
      .flatMap((reference) => {
        const under =
          reference.kind === "file"
            ? [reference.path]
            : files.filter((file) => file.startsWith(`${reference.path}/`));
        const left = under.filter((file) => !claims(file));
        if (left.length === 0) return [];
        const missed = left.some((file) => !unclaimed.has(file));
        return [{ ...reference, stackId: id, missed }];
      });
  });
}

function globFor({ path, kind }: FileReference): string {
  return kind === "file" ? globOf(path) : `${globOf(path)}/**`;
}

// One entry per path when all its stacks read the same, else one per stack.
function inputsEntries(stacks: ConfiguredStack[], reads: StackRead[]): InputsEntry[] {
  const byStack = Map.groupBy(reads, (read) => read.stackId);
  const byPath = Map.groupBy(stacks, ({ stack }) => stack.path);
  return [...byPath].flatMap(([path, inPath]) => {
    const globs = inPath.map(({ stack }) =>
      (byStack.get(stackId(stack)) ?? []).map(globFor).join("\n"),
    );
    if (globs.every((one) => one === "")) return [];
    if (globs.every((one) => one === globs[0])) {
      return [{ path, globs: (globs[0] ?? "").split("\n") }];
    }
    return inPath.flatMap(({ stack }, index) => {
      const own = globs[index] ?? "";
      if (own === "") return [];
      return [
        { path, ...(stack.name === undefined ? {} : { name: stack.name }), globs: own.split("\n") },
      ];
    });
  });
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
