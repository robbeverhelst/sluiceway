import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { runCheck } from "../../src/modes/check-job.ts";

const SRC = resolve(import.meta.dir, "../../src");

// Every file under src/ the check job can reach, and every package it
// imports. Type-only imports are left out by the transpiler, so this is what
// the job can run.
function reach(entry: string): { files: string[]; packages: string[] } {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (path.startsWith(".")) visit(resolve(dirname(file), path));
      else packages.add(path);
    }
  };
  visit(join(SRC, entry));
  return {
    files: [...files].map((file) => relative(SRC, file)).sort(),
    packages: [...packages].sort(),
  };
}

// Record 0042: the check needs no credential, no tool and no GitHub API. The
// process runner and the port are never constructed, because the check job
// cannot reach the code that builds them.
describe("the check job never constructs the process runner or the GitHub port", () => {
  const { files, packages } = reach("modes/check-job.ts");

  test("it reaches neither the process runner nor anything that talks to GitHub", () => {
    expect(files).not.toContain("adapters/process.ts");
    expect(files.filter((file) => file.startsWith("github/"))).toEqual(["github/job-log.ts"]);
    expect(files.filter((file) => file.startsWith("modes/"))).toEqual([
      "modes/check-job.ts",
      "modes/check.ts",
    ]);
  });

  // @actions/core is the job log and the summary. Nothing here starts a
  // process or opens a connection.
  test("the packages it imports", () => {
    expect(packages).toEqual([
      "@actions/core",
      "node:fs",
      "node:fs/promises",
      "node:path",
      "picomatch",
      "yaml",
      "zod",
    ]);
  });
});

describe("runCheck, as a step runs it", () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  afterEach(() => {
    process.env = { ...saved };
    globalThis.fetch = realFetch;
  });

  // @actions/core keeps the first summary file it is handed for the whole
  // process, so this test hands it none: the summary fails, the check says so
  // in the log and goes on. The summary itself is tested in check.test.ts.
  test("makes no network call and runs to the end", async () => {
    const root = mkdtempSync(join(tmpdir(), "sluiceway-check-job-"));
    for (const [file, text] of Object.entries({
      "network/Pulumi.yaml": "name: network\nruntime: yaml\n",
      "network/Pulumi.prod.yaml": "",
      "README.md": "",
    })) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    const calls: unknown[] = [];
    globalThis.fetch = Object.assign(
      async (...args: unknown[]) => {
        calls.push(args);
        throw new Error("The check makes no network call.");
      },
      { preconnect: () => {} },
    ) as typeof fetch;
    // A step of a check job has the workflow token in its inputs too. The
    // check never reads it.
    process.env = {
      ...saved,
      GITHUB_WORKSPACE: root,
      GITHUB_STEP_SUMMARY: "",
      "INPUT_GITHUB-TOKEN": "ghs_not_a_token",
    };

    const written: string[] = [];
    const realWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) =>
      written.push(String(chunk)) > 0) as typeof process.stdout.write;
    try {
      await runCheck();
    } finally {
      process.stdout.write = realWrite;
    }

    expect(calls).toEqual([]);
    expect(written.join("")).toContain("Found 1 stack.");
    expect(written.join("")).toContain("The setup is valid.");
  });

  test("fails with a clear message outside a job", async () => {
    process.env = { ...saved, GITHUB_WORKSPACE: "" };
    await expect(runCheck()).rejects.toThrow(
      "GITHUB_WORKSPACE is not set. Sluiceway runs as a step of a GitHub Actions job.",
    );
  });
});
