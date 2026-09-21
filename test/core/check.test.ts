import { describe, expect, test } from "bun:test";
import { checkSetup } from "../../src/core/check.ts";
import { parseConfig } from "../../src/core/config.ts";
import type { Stack } from "../../src/core/stack.ts";

function stack(id: string): Stack {
  const [path = "", name] = id.split(":");
  return { path, ...(name === undefined ? {} : { name }), options: {} };
}

const FOUND = ["apps/web:dev", "apps/web:prod", "network:prod"].map(stack);

describe("ignore", () => {
  test("names the stacks each glob leaves out", () => {
    const report = checkSetup(parseConfig('ignore: ["**/*:dev"]'), FOUND, []);
    expect(report.ignore).toEqual([{ glob: "**/*:dev", stacks: ["apps/web:dev"] }]);
    expect(report.stacks.map(({ stack }) => stack.path)).toEqual(["apps/web", "network"]);
  });

  test("a glob that matches a stack's path but not its id names the glob that would work", () => {
    const report = checkSetup(parseConfig('ignore: ["apps/web"]'), FOUND, []);
    expect(report.ignore).toEqual([
      {
        glob: "apps/web",
        stacks: [],
        hint: { glob: "apps/web:*", stacks: ["apps/web:dev", "apps/web:prod"] },
      },
    ]);
  });

  test("a glob that matches no path either gets no hint", () => {
    const report = checkSetup(parseConfig('ignore: ["apps/loki:*"]'), FOUND, []);
    expect(report.ignore).toEqual([{ glob: "apps/loki:*", stacks: [] }]);
  });

  // "*" crosses the colon, so a pattern that ends in one already works.
  test("a pattern that ends in * matches the ids and needs no hint", () => {
    const report = checkSetup(parseConfig('ignore: ["apps/*"]'), FOUND, []);
    expect(report.ignore).toEqual([{ glob: "apps/*", stacks: ["apps/web:dev", "apps/web:prod"] }]);
  });

  test("a pattern over nested directories gets the hint too", () => {
    const report = checkSetup(parseConfig('ignore: ["apps/**/web"]'), FOUND, []);
    expect(report.ignore[0]?.hint).toEqual({
      glob: "apps/**/web:*",
      stacks: ["apps/web:dev", "apps/web:prod"],
    });
  });

  test("an ignored stack claims nothing, so the files in its directory are unclaimed", () => {
    const report = checkSetup(parseConfig('ignore: ["**/*:dev", "apps/web:*"]'), FOUND, [
      "apps/web/index.ts",
      "network/index.ts",
    ]);
    expect(report.unclaimed).toEqual([{ directory: "apps", files: ["apps/web/index.ts"] }]);
  });

  test("a stack at the repo root", () => {
    const report = checkSetup(parseConfig('ignore: ["."]'), [stack(".:prod")], []);
    expect(report.ignore[0]?.hint).toEqual({ glob: ".:*", stacks: [".:prod"] });
  });
});

describe("the files no stack claims", () => {
  const FILES = [
    "README.md",
    "package.json",
    "sluiceway.yaml",
    ".github/workflows/ci.yml",
    "apps/web/index.ts",
    "apps/web/README.md",
    "docs/setup.md",
    "docs/diagram.png",
    "network/index.ts",
    "packages/shared/src/index.ts",
    "packages/shared/package.json",
  ];

  test("are grouped by the directory at the top of the repo, the root first, in code unit order", () => {
    const report = checkSetup(parseConfig(undefined), FOUND, FILES);
    expect(report.unclaimed).toEqual([
      { directory: ".", files: ["README.md", "package.json", "sluiceway.yaml"] },
      { directory: ".github", files: [".github/workflows/ci.yml"] },
      { directory: "docs", files: ["docs/diagram.png", "docs/setup.md"] },
      {
        directory: "packages",
        files: ["packages/shared/package.json", "packages/shared/src/index.ts"],
      },
    ]);
  });

  test("leave out what inputs claim and what scan.unrelated covers", () => {
    const config = parseConfig(
      [
        "scan:",
        '  unrelated: ["**/*.md"]',
        "stacks:",
        "  - path: network",
        '    inputs: ["packages/shared/**"]',
      ].join("\n"),
    );
    const report = checkSetup(config, FOUND, FILES);
    expect(report.unclaimed.flatMap((group) => group.files)).toEqual([
      "package.json",
      "sluiceway.yaml",
      ".github/workflows/ci.yml",
      "docs/diagram.png",
    ]);
  });

  test("a stack at the repo root claims every file", () => {
    const report = checkSetup(parseConfig(undefined), [stack(".:prod")], FILES);
    expect(report.unclaimed).toEqual([]);
  });
});

describe("the ready-to-paste block", () => {
  test("suggests globs for docs and tooling and nothing a program is likely to read", () => {
    const report = checkSetup(parseConfig(undefined), FOUND, [
      "README.md",
      "apps/web/README.md",
      "LICENSE",
      ".github/workflows/ci.yml",
      ".github/CODEOWNERS",
      "docs/diagram.png",
      ".gitignore",
      "apps/web/.gitignore",
      ".gitattributes",
      ".editorconfig",
      "package.json",
      "bun.lock",
      "tsconfig.json",
      "sluiceway.yaml",
      "packages/shared/src/index.ts",
    ]);
    expect(report.suggested).toEqual([
      "**/*.md",
      "docs/**",
      ".github/**",
      "LICENSE*",
      "**/.gitignore",
      "**/.gitattributes",
      ".editorconfig",
    ]);
  });

  test("suggests only the globs that cover an unclaimed file, and none that scan.unrelated has", () => {
    const report = checkSetup(parseConfig('scan:\n  unrelated: ["**/*.md"]'), FOUND, [
      "README.md",
      ".github/workflows/ci.yml",
      "network/README.md",
    ]);
    expect(report.suggested).toEqual([".github/**"]);
  });

  test("suggests nothing when nothing is unclaimed", () => {
    const report = checkSetup(parseConfig(undefined), FOUND, ["network/index.ts"]);
    expect(report.suggested).toEqual([]);
  });
});
