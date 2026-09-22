import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { refuseOldNode, runInit, terminalLog } from "../../src/modes/init-job.ts";

const SRC = resolve(import.meta.dir, "../../src");

// Every file under src/ the init job can reach, and every package it imports.
function reach(entry: string): { files: string[]; packages: string[] } {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      if (path.endsWith(".sh")) continue;
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

// Record 0065: init reads files and writes files, like the check reads them
// (record 0042). No credential, no tool, no GitHub API.
describe("the init job never constructs the process runner or the GitHub port", () => {
  const { files, packages } = reach("modes/init-job.ts");

  test("it reaches neither the process runner nor anything that talks to GitHub", () => {
    expect(files).not.toContain("adapters/process.ts");
    expect(files.filter((file) => file.startsWith("github/"))).toEqual(["github/job-log.ts"]);
    expect(files.filter((file) => file.startsWith("modes/"))).toEqual([
      "modes/init-job.ts",
      "modes/init.ts",
    ]);
  });

  test("the packages it imports", () => {
    expect(packages).toEqual([
      "@actions/core",
      "node:crypto",
      "node:fs",
      "node:fs/promises",
      "node:path",
      "picomatch",
      "yaml",
      "zod",
    ]);
  });
});

describe("runInit, as a person runs it", () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  afterEach(() => {
    process.env = { ...saved };
    globalThis.fetch = realFetch;
    console.log = realLog;
  });

  test("writes into the workspace, prints plain lines and makes no network call", async () => {
    const root = mkdtempSync(join(tmpdir(), "sluiceway-init-job-"));
    for (const [file, text] of Object.entries({
      ".git/HEAD": "ref: refs/heads/main\n",
      "network/Pulumi.yaml": "name: network\nruntime: yaml\n",
      "network/Pulumi.prod.yaml": "",
    })) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    const calls: unknown[] = [];
    globalThis.fetch = Object.assign(
      async (...args: unknown[]) => {
        calls.push(args);
        throw new Error("init makes no network call.");
      },
      { preconnect: () => {} },
    ) as typeof fetch;
    process.env = { ...saved, GITHUB_WORKSPACE: root, GITHUB_ACTIONS: "" };
    const printed: string[] = [];
    console.log = (line: string) => void printed.push(line);

    await runInit();

    expect(calls).toEqual([]);
    expect(existsSync(join(root, ".github/workflows/deploy-dashboard.yml"))).toBe(true);
    expect(printed).toContain("Found 1 stack.");
    expect(printed).toContain("Stacks");
    expect(printed).toContain("  network:prod");
    expect(printed.join("\n")).not.toContain("::");
  });
});

describe("the terminal log", () => {
  test("indents the lines of a group under its title", () => {
    const printed: string[] = [];
    const log = terminalLog((line) => void printed.push(line));
    log.info("one");
    log.group("Title", ["a", "b"]);
    log.warning("careful", "Heads up");
    expect(printed).toEqual(["one", "Title", "  a", "  b", "Heads up: careful"]);
  });
});

describe("the Node version on a laptop", () => {
  test("Node 20 is refused with words", () => {
    expect(() => refuseOldNode("20.18.1")).toThrow(
      "init needs Node 22 or newer, and this is Node 20.18.1.",
    );
  });

  test("Node 22 and newer go ahead", () => {
    expect(() => refuseOldNode("22.0.0")).not.toThrow();
    expect(() => refuseOldNode("24.15.0")).not.toThrow();
  });
});
