import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Record 0021: the raw output of the tool is a sensitive object, and anything
// an adapter has to write to disk goes in a temporary directory that it
// removes when the preview ends. The Pulumi adapter has nothing to write: the
// output comes through a pipe and is parsed in memory. So there is no
// temporary directory, and what is held here is that there can be none. The
// check reads the imports, because a run that happens not to write proves less.

const SRC = resolve(import.meta.dir, "../../../src");

function packagesOf(entry: string): string[] {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (path.startsWith(".")) visit(resolve(dirname(file), path));
      else packages.add(path);
    }
  };
  visit(join(SRC, entry));
  return [...packages].sort();
}

// node:crypto hashes the value fingerprint (record 0102) and reads no disk.
test("the preview and the version check import nothing that reaches the disk", () => {
  expect(packagesOf("adapters/pulumi/preview.ts")).toEqual(["node:crypto", "node:path", "zod"]);
  expect(packagesOf("adapters/pulumi/version.ts")).toEqual([]);
});

test("the process runner imports nothing but what starts a process", () => {
  expect(packagesOf("adapters/process.ts")).toEqual(["node:child_process"]);
});
