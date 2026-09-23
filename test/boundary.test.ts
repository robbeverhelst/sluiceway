import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

// core/, adapters/ and render/ must stay free of GitHub and Actions glue, so a
// hosted version can reuse them. Biome enforces the same rule while editing
// (noRestrictedImports in biome.json). This test is the net under it.

const SRC = resolve(import.meta.dir, "../src");
const PURE_DIRS = ["core", "adapters", "render"];
const BANNED_PACKAGES = ["@actions/", "@octokit/"];
const BANNED_PATHS = ["github", "modes", "notify", "cli", "main.ts", "mode.ts", "cli.ts"];

const transpiler = new Bun.Transpiler({ loader: "ts" });

function violations(file: string, code: string): string[] {
  return transpiler
    .scanImports(code)
    .map((imported) => imported.path)
    .filter((specifier) => {
      if (BANNED_PACKAGES.some((prefix) => specifier.startsWith(prefix))) return true;
      if (!specifier.startsWith(".")) return false;
      const target = relative(SRC, resolve(dirname(file), specifier));
      return BANNED_PATHS.some((banned) => target === banned || target.startsWith(banned + sep));
    });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.(ts|tsx|mts|js|mjs)$/.test(name))
    .map((name) => join(dir, name))
    .sort();
}

describe("the check itself", () => {
  const file = join(SRC, "core", "example.ts");

  test("flags Actions and Octokit packages", () => {
    const code = 'import * as core from "@actions/core";\nimport { Octokit } from "@octokit/rest";';
    expect(violations(file, code)).toEqual(["@actions/core", "@octokit/rest"]);
  });

  test("flags dynamic imports and require calls", () => {
    const code = 'await import("@actions/github");\nrequire("@actions/exec");';
    expect(violations(file, code)).toEqual(["@actions/github", "@actions/exec"]);
  });

  test("flags the glue directories and the entry point", () => {
    const code = 'import "../github/issue.ts";\nimport "../main.ts";\nimport "../mode.ts";';
    expect(violations(file, code)).toEqual(["../github/issue.ts", "../main.ts", "../mode.ts"]);
  });

  // The sender of record 0078 calls the network, so it is glue too.
  test("flags the notify directory", () => {
    const code = 'import "../notify/send.ts";';
    expect(violations(file, code)).toEqual(["../notify/send.ts"]);
  });

  // The command line is a door, like the action's entry (record 0094).
  test("flags the command line", () => {
    const code = 'import "../cli/run.ts";\nimport "../cli.ts";';
    expect(violations(file, code)).toEqual(["../cli/run.ts", "../cli.ts"]);
  });

  test("flags the modes directory", () => {
    const code = 'import "../modes/scan.ts";';
    expect(violations(file, code)).toEqual(["../modes/scan.ts"]);
  });

  test("allows node built-ins, other packages and pure neighbours", () => {
    const code =
      'import "node:fs";\nimport "zod";\nimport "./types.ts";\nimport "../adapters/x.ts";\nimport "../render/row.ts";';
    expect(violations(file, code)).toEqual([]);
  });
});

describe.each(PURE_DIRS)("src/%s", (dir) => {
  test("imports no GitHub or Actions glue", () => {
    const found = sourceFiles(join(SRC, dir)).flatMap((file) =>
      violations(file, readFileSync(file, "utf8")).map(
        (specifier) => `${relative(SRC, file)} imports ${specifier}`,
      ),
    );
    expect(found).toEqual([]);
  });
});
