import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renovateMergeSetting } from "../../src/core/renovate-config.ts";

// The merge method Renovate is set to use (slice 4.13): its config file found
// as Renovate finds it on GitHub, read as JSONC or JSON5, and its presets
// followed as far as they live in this same repo.

const REPO = { owner: "acme", repo: "infra" };

function files(map: Record<string, string>) {
  return (path: string): string | undefined => map[path];
}

describe("finding Renovate's config file", () => {
  test("reads automergeStrategy from renovate.json", () => {
    expect(
      renovateMergeSetting(files({ "renovate.json": '{ "automergeStrategy": "rebase" }' }), REPO),
    ).toEqual({ strategy: "rebase", file: "renovate.json", unread: [] });
  });

  test("takes the first file in Renovate's own order", () => {
    const read = files({
      ".renovaterc": '{ "automergeStrategy": "merge-commit" }',
      ".github/renovate.json5": "{ automergeStrategy: 'squash' }",
    });
    expect(renovateMergeSetting(read, REPO)).toMatchObject({
      strategy: "squash",
      file: ".github/renovate.json5",
    });
  });

  test("reads the JSON5 and JSONC files Renovate reads", () => {
    for (const file of ["renovate.json5", "renovate.jsonc", ".renovaterc.json5"]) {
      const read = files({
        [file]: "{\n  // how Renovate merges\n  automergeStrategy: 'rebase',\n}",
      });
      expect(renovateMergeSetting(read, REPO).strategy).toBe("rebase");
    }
    // Renovate reads a .json file as JSON5 too when it is not JSONC.
    const read = files({ "renovate.json": "{ automergeStrategy: 'rebase' }" });
    expect(renovateMergeSetting(read, REPO).strategy).toBe("rebase");
  });

  test("skips the GitLab file, which Renovate does not read on GitHub", () => {
    const read = files({ ".gitlab/renovate.json": '{ "automergeStrategy": "rebase" }' });
    expect(renovateMergeSetting(read, REPO)).toEqual({
      strategy: undefined,
      file: undefined,
      unread: [],
    });
  });

  test("reads the renovate key of package.json last", () => {
    const read = files({
      "package.json": '{ "name": "x", "renovate": { "automergeStrategy": "merge-commit" } }',
    });
    expect(renovateMergeSetting(read, REPO)).toMatchObject({
      strategy: "merge-commit",
      file: "package.json",
    });
    expect(renovateMergeSetting(files({ "package.json": '{ "name": "x" }' }), REPO).file).toBe(
      undefined,
    );
  });

  test("gives nothing for a file that does not read, or a strategy that is not a word", () => {
    expect(renovateMergeSetting(files({ "renovate.json": "{ nope" }), REPO)).toEqual({
      strategy: undefined,
      file: "renovate.json",
      unread: [],
    });
    expect(
      renovateMergeSetting(files({ "renovate.json": '{ "automergeStrategy": 3 }' }), REPO).strategy,
    ).toBeUndefined();
    expect(renovateMergeSetting(files({ "renovate.json": "[]" }), REPO).strategy).toBeUndefined();
  });
});

describe("following presets", () => {
  test("reads a preset in this same repo, and the file's own key wins over it", () => {
    const read = files({
      "renovate.json": '{ "extends": ["github>acme/infra"] }',
      "default.json": '{ "automergeStrategy": "rebase" }',
    });
    expect(renovateMergeSetting(read, REPO)).toEqual({
      strategy: "rebase",
      file: "renovate.json",
      unread: [],
    });
    const own = files({
      "renovate.json": '{ "extends": ["github>acme/infra"], "automergeStrategy": "squash" }',
      "default.json": '{ "automergeStrategy": "rebase" }',
    });
    expect(renovateMergeSetting(own, REPO).strategy).toBe("squash");
  });

  test("reads every form of a preset in this repo, and a later preset wins", () => {
    const read = files({
      "renovate.json": JSON.stringify({
        extends: [
          "local>acme/infra:merging",
          "acme/infra//renovate/presets/merge",
          "github>ACME/Infra:bundle/inner",
        ],
      }),
      "merging.json": '{ "automergeStrategy": "rebase" }',
      "renovate/presets/merge.json": '{ "automergeStrategy": "merge-commit" }',
      "bundle.json": '{ "inner": { "automergeStrategy": "squash" } }',
    });
    expect(renovateMergeSetting(read, REPO).strategy).toBe("squash");
  });

  test("falls back to renovate.json for a default preset, as Renovate does", () => {
    const read = files({
      "renovate.json": '{ "extends": ["github>acme/infra//presets/default"] }',
      "presets/renovate.json": '{ "automergeStrategy": "rebase" }',
    });
    expect(renovateMergeSetting(read, REPO)).toEqual({
      strategy: "rebase",
      file: "renovate.json",
      unread: [],
    });
  });

  test("follows presets inside presets, and stops at a loop", () => {
    const read = files({
      "renovate.json": '{ "extends": ["github>acme/infra:a"] }',
      "a.json": '{ "extends": ["github>acme/infra:b"] }',
      "b.json": '{ "extends": ["github>acme/infra:a"], "automergeStrategy": "rebase" }',
    });
    expect(renovateMergeSetting(read, REPO).strategy).toBe("rebase");
  });

  test("names the presets it did not read, and leaves Renovate's own presets alone", () => {
    const read = files({
      "renovate.json": JSON.stringify({
        extends: [
          "config:recommended",
          ":automergeBranch",
          "github>acme/renovate-config",
          "github>acme/infra#v1",
          "github>acme/infra:args(1)",
          "https://example.com/preset.json",
          "./relative",
          "github>acme/infra:missing",
        ],
      }),
    });
    expect(renovateMergeSetting(read, REPO)).toEqual({
      strategy: undefined,
      file: "renovate.json",
      unread: [
        "github>acme/renovate-config",
        "github>acme/infra#v1",
        "github>acme/infra:args(1)",
        "https://example.com/preset.json",
        "./relative",
        "github>acme/infra:missing",
      ],
    });
  });
});

describe("a Renovate config in a repo", () => {
  test("gives the strategy of the fixture", () => {
    const root = join(import.meta.dir, "../fixtures/renovate/json5-with-preset");
    const read = (path: string) => {
      try {
        return readFileSync(join(root, path), "utf8");
      } catch {
        return undefined;
      }
    };
    expect(renovateMergeSetting(read, REPO)).toEqual({
      strategy: "merge-commit",
      file: ".github/renovate.json5",
      unread: ["github>acme/shared-renovate"],
    });
  });
});
