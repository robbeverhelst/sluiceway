import { globMatcher } from "./glob.ts";

// The claim rule of record 0010. A stack claims a changed file when the file
// lies inside the stack's directory, or matches one of the stack's `inputs`
// globs. Several stacks can claim one file, and a file that no stack claims is
// what turns a narrowed scan into a full one. Attribution uses this same rule
// (record 0026).

// What the rule needs to know of a stack.
export interface Claimant {
  id: string;
  // In the form of `Stack.path`: relative to the repo root, forward slashes,
  // and "." for a stack at the root.
  path: string;
  inputs: string[];
}

export interface Claims {
  // The files each stack claims, by stack id. A stack that claims nothing is
  // not in it.
  claims: Map<string, string[]>;
  // The files no stack claims, in the order they came.
  unclaimed: string[];
}

function inside(directory: string, file: string): boolean {
  return directory === "." || file.startsWith(`${directory}/`);
}

// `changed` holds paths relative to the repo root with forward slashes, as
// GitHub writes them. A file that matches a `scan.unrelated` glob claims
// nothing and forces nothing, so it is dropped before the rule sees it.
export function claim(stacks: Claimant[], changed: string[], unrelated: string[]): Claims {
  const isUnrelated = globMatcher(unrelated);
  const matchers = stacks.map((stack) => ({ stack, matches: globMatcher(stack.inputs) }));
  const claims = new Map<string, string[]>();
  const unclaimed: string[] = [];

  for (const file of new Set(changed)) {
    if (isUnrelated(file)) continue;
    const claimants = matchers.filter(
      ({ stack, matches }) => inside(stack.path, file) || matches(file),
    );
    if (claimants.length === 0) unclaimed.push(file);
    for (const { stack } of claimants) claims.set(stack.id, [...(claims.get(stack.id) ?? []), file]);
  }
  return { claims, unclaimed };
}
