// A stack is a path, an optional name and an options bag that only its adapter
// reads (record 0006). No tool word belongs in this file.
export interface Stack {
  // Relative to the repo root, with forward slashes, no leading "./" and no
  // trailing slash. Whoever builds a Stack hands the path over in this form.
  path: string;
  name?: string;
  options: Record<string, unknown>;
  // The text of each key of the tool's own file that a `phase: { from }`
  // entry points at, when the file holds it as text (record 0067). Nothing
  // else of the file leaves discovery.
  phaseKeys?: Readonly<Record<string, string>>;
}

// The stack id is derived, never chosen. Nothing splits it back apart: the
// adapter gets path and name as separate fields.
export function stackId(stack: Pick<Stack, "path" | "name">): string {
  return stack.name === undefined ? stack.path : `${stack.path}:${stack.name}`;
}
