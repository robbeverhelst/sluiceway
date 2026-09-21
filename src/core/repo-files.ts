import { readdir } from "node:fs/promises";
import { join } from "node:path";

// The same two directories discovery never enters.
const SKIPPED = new Set([".git", "node_modules"]);

// The files of the checked-out repo, relative to its root, with forward
// slashes, in code unit order. The check (record 0042) stands this in for the
// tracked files: right after a checkout they are the same, and asking git would
// mean starting a process. A symlink counts as a file, as git tracks it, and a
// link to a directory is never followed.
export async function repoFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (relative: string[]): Promise<void> => {
    const entries = await readdir(join(root, ...relative), { withFileTypes: true });
    for (const entry of entries) {
      // In a worktree or a submodule, .git is a file. It is still git's.
      if (entry.name === ".git") continue;
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) await walk([...relative, entry.name]);
      } else {
        files.push([...relative, entry.name].join("/"));
      }
    }
  };
  await walk([]);
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
