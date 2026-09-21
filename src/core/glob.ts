import picomatch from "picomatch";

// One place for how Sluiceway reads a glob, so every list of globs in
// sluiceway.yaml means the same thing. "*" stops at a slash and at nothing
// else, "**" crosses slashes, and a leading dot is nothing special: the id of a
// stack at the repo root starts with one.
export function globMatcher(globs: string[]): (text: string) => boolean {
  if (globs.length === 0) return () => false;
  return picomatch(globs, { dot: true });
}

// A glob that matches exactly this text, for a line a person pastes under
// `ignore`: every character a glob acts on is escaped with a backslash.
export function globOf(text: string): string {
  return text.replace(/[\\*?[\]{}()!+@|]/g, "\\$&");
}
