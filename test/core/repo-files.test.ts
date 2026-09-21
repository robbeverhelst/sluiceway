import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { repoFiles } from "../../src/core/repo-files.ts";

function repo(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-files-"));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  return root;
}

describe("repoFiles", () => {
  test("lists every file, relative to the root, with forward slashes, in code unit order", async () => {
    const root = repo(["b.md", "a/z.ts", "a/b/c/d.ts", ".github/workflows/ci.yml", "A.md"]);
    expect(await repoFiles(root)).toEqual([
      ".github/workflows/ci.yml",
      "A.md",
      "a/b/c/d.ts",
      "a/z.ts",
      "b.md",
    ]);
  });

  // The same two directories discovery never enters (pull request 42).
  test("never enters .git or node_modules, at any depth", async () => {
    const root = repo([
      ".git/HEAD",
      "node_modules/x/index.js",
      "app/node_modules/y/index.js",
      "app/a.ts",
    ]);
    expect(await repoFiles(root)).toEqual(["app/a.ts"]);
  });

  // In a worktree or a submodule, .git is a file that points at the real one.
  test("leaves out a .git that is a file", async () => {
    expect(await repoFiles(repo([".git", "app/a.ts", "vendor/lib/.git"]))).toEqual(["app/a.ts"]);
  });

  test("lists a symlink as a file and follows no link to a directory", async () => {
    const root = repo(["real/a.ts"]);
    symlinkSync(join(root, "real"), join(root, "linked"));
    symlinkSync(join(root, "real/a.ts"), join(root, "b.ts"));
    expect(await repoFiles(root)).toEqual(["b.ts", "linked", "real/a.ts"]);
  });

  test("an empty repo has no files", async () => {
    expect(await repoFiles(repo([]))).toEqual([]);
  });
});
