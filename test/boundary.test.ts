import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

// core/, adapters/ and render/ must stay free of GitHub and Actions glue, so a
// hosted version can reuse them. Biome enforces the same rule while editing
// (noRestrictedImports in biome.json). This test is the net under it.

const SRC = resolve(import.meta.dir, "../src");
const PURE_DIRS = ["core", "adapters", "render"];
// The two a hosted version, or a reader of the published shape, takes as a
// library: they reach no tool, not even the interface of one (issue 245).
const LIBRARY_DIRS = ["core", "render"];
const BANNED_PACKAGES = ["@actions/", "@octokit/"];
const BANNED_PATHS = ["github", "modes", "notify", "cli", "main.ts", "mode.ts", "cli.ts"];
const LIBRARY_BANNED_PATHS = [...BANNED_PATHS, "adapters"];

const transpiler = new Bun.Transpiler({ loader: "ts" });

// The transpiler drops an `import type` and an `export type {} from` before
// it scans, as a build would. A consumer who walks imports to prove a library
// reaches nothing it should not walks those too, so they count here: each
// becomes a plain import before the scan. `export type X = ...` has no
// source and stays as it is.
function withTypeImports(code: string): string {
  return code
    .replace(/\bimport\s+type\b/g, "import")
    .replace(/\bexport\s+type\s*(?=[{*])/g, "export ");
}

function violations(file: string, code: string, bannedPaths = BANNED_PATHS): string[] {
  return transpiler
    .scanImports(withTypeImports(code))
    .map((imported) => imported.path)
    .filter((specifier) => {
      if (BANNED_PACKAGES.some((prefix) => specifier.startsWith(prefix))) return true;
      if (!specifier.startsWith(".")) return false;
      const target = relative(SRC, resolve(dirname(file), specifier));
      return bannedPaths.some((banned) => target === banned || target.startsWith(banned + sep));
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

  // A type import costs nothing at run time, but a consumer that reuses
  // core/ and render/ as a library and walks imports to prove it never
  // reaches the glue or a tool walks type imports too (issue 245).
  test("flags a type import and a type re-export", () => {
    const code =
      'import type { Port } from "../github/port.ts";\nimport { type Mode, run } from "../modes/scan.ts";\nexport type { Send } from "../notify/send.ts";';
    expect(violations(file, code)).toEqual([
      "../github/port.ts",
      "../modes/scan.ts",
      "../notify/send.ts",
    ]);
  });

  test("flags an adapters file for core and render, not for adapters", () => {
    const code = 'import type { PreviewResult } from "../adapters/adapter.ts";';
    expect(violations(file, code, LIBRARY_BANNED_PATHS)).toEqual(["../adapters/adapter.ts"]);
    expect(violations(join(SRC, "render", "row.ts"), code, LIBRARY_BANNED_PATHS)).toEqual([
      "../adapters/adapter.ts",
    ]);
    expect(
      violations(
        join(SRC, "adapters", "pulumi", "tool.ts"),
        'import type { Adapter } from "../adapter.ts";',
      ),
    ).toEqual([]);
  });
});

function found(dir: string, bannedPaths: string[]): string[] {
  return sourceFiles(join(SRC, dir)).flatMap((file) =>
    violations(file, readFileSync(file, "utf8"), bannedPaths).map(
      (specifier) => `${relative(SRC, file)} imports ${specifier}`,
    ),
  );
}

describe.each(PURE_DIRS)("src/%s", (dir) => {
  test("imports no GitHub or Actions glue", () => {
    expect(found(dir, BANNED_PATHS)).toEqual([]);
  });
});

// The adapters import from core, never the other way (issue 245): what a
// tool's run comes to is a core type, and an adapter fills it in.
describe.each(LIBRARY_DIRS)("src/%s", (dir) => {
  test("reaches no adapters file, not even by a type import", () => {
    expect(found(dir, LIBRARY_BANNED_PATHS)).toEqual([]);
  });
});
