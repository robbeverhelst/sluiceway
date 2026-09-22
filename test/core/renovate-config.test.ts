import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renovateMergeSetting } from "../../src/core/renovate-config.ts";

// The merge method Renovate is set to use (slice 4.13): its config file found
// as Renovate finds it on GitHub, read as JSONC or JSON5, and its presets
// followed as far as they live in this same repo. Since slice 5.4 presets
// in other GitHub repos and at a tag are read through the GitHub API.

const REPO = { owner: "acme", repo: "infra" };

function files(map: Record<string, string>) {
  return (path: string): string | undefined => map[path];
}

describe("finding Renovate's config file", () => {
  test("reads automergeStrategy from renovate.json", async () => {
    expect(
      await renovateMergeSetting(
        files({ "renovate.json": '{ "automergeStrategy": "rebase" }' }),
        REPO,
      ),
    ).toEqual({ strategy: "rebase", file: "renovate.json", unread: [] });
  });

  test("takes the first file in Renovate's own order", async () => {
    const read = files({
      ".renovaterc": '{ "automergeStrategy": "merge-commit" }',
      ".github/renovate.json5": "{ automergeStrategy: 'squash' }",
    });
    expect(await renovateMergeSetting(read, REPO)).toMatchObject({
      strategy: "squash",
      file: ".github/renovate.json5",
    });
  });

  test("reads the JSON5 and JSONC files Renovate reads", async () => {
    for (const file of ["renovate.json5", "renovate.jsonc", ".renovaterc.json5"]) {
      const read = files({
        [file]: "{\n  // how Renovate merges\n  automergeStrategy: 'rebase',\n}",
      });
      expect((await renovateMergeSetting(read, REPO)).strategy).toBe("rebase");
    }
    // Renovate reads a .json file as JSON5 too when it is not JSONC.
    const read = files({ "renovate.json": "{ automergeStrategy: 'rebase' }" });
    expect((await renovateMergeSetting(read, REPO)).strategy).toBe("rebase");
  });

  test("skips the GitLab file, which Renovate does not read on GitHub", async () => {
    const read = files({ ".gitlab/renovate.json": '{ "automergeStrategy": "rebase" }' });
    expect(await renovateMergeSetting(read, REPO)).toEqual({
      strategy: undefined,
      file: undefined,
      unread: [],
    });
  });

  test("reads the renovate key of package.json last", async () => {
    const read = files({
      "package.json": '{ "name": "x", "renovate": { "automergeStrategy": "merge-commit" } }',
    });
    expect(await renovateMergeSetting(read, REPO)).toMatchObject({
      strategy: "merge-commit",
      file: "package.json",
    });
    expect(
      (await renovateMergeSetting(files({ "package.json": '{ "name": "x" }' }), REPO)).file,
    ).toBe(undefined);
  });

  test("gives nothing for a file that does not read, or a strategy that is not a word", async () => {
    expect(await renovateMergeSetting(files({ "renovate.json": "{ nope" }), REPO)).toEqual({
      strategy: undefined,
      file: "renovate.json",
      unread: [],
    });
    expect(
      (await renovateMergeSetting(files({ "renovate.json": '{ "automergeStrategy": 3 }' }), REPO))
        .strategy,
    ).toBeUndefined();
    expect(
      (await renovateMergeSetting(files({ "renovate.json": "[]" }), REPO)).strategy,
    ).toBeUndefined();
  });
});

describe("following presets", () => {
  test("reads a preset in this same repo, and the file's own key wins over it", async () => {
    const read = files({
      "renovate.json": '{ "extends": ["github>acme/infra"] }',
      "default.json": '{ "automergeStrategy": "rebase" }',
    });
    expect(await renovateMergeSetting(read, REPO)).toEqual({
      strategy: "rebase",
      file: "renovate.json",
      unread: [],
    });
    const own = files({
      "renovate.json": '{ "extends": ["github>acme/infra"], "automergeStrategy": "squash" }',
      "default.json": '{ "automergeStrategy": "rebase" }',
    });
    expect((await renovateMergeSetting(own, REPO)).strategy).toBe("squash");
  });

  test("reads every form of a preset in this repo, and a later preset wins", async () => {
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
    expect((await renovateMergeSetting(read, REPO)).strategy).toBe("squash");
  });

  test("falls back to renovate.json for a default preset, as Renovate does", async () => {
    const read = files({
      "renovate.json": '{ "extends": ["github>acme/infra//presets/default"] }',
      "presets/renovate.json": '{ "automergeStrategy": "rebase" }',
    });
    expect(await renovateMergeSetting(read, REPO)).toEqual({
      strategy: "rebase",
      file: "renovate.json",
      unread: [],
    });
  });

  test("follows presets inside presets, and stops at a loop", async () => {
    const read = files({
      "renovate.json": '{ "extends": ["github>acme/infra:a"] }',
      "a.json": '{ "extends": ["github>acme/infra:b"] }',
      "b.json": '{ "extends": ["github>acme/infra:a"], "automergeStrategy": "rebase" }',
    });
    expect((await renovateMergeSetting(read, REPO)).strategy).toBe("rebase");
  });

  test("names the presets it did not read, and leaves Renovate's own presets alone", async () => {
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
    expect(await renovateMergeSetting(read, REPO)).toEqual({
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
  test("gives the strategy of the fixture", async () => {
    const root = join(import.meta.dir, "../fixtures/renovate/json5-with-preset");
    const read = (path: string) => {
      try {
        return readFileSync(join(root, path), "utf8");
      } catch {
        return undefined;
      }
    };
    expect(await renovateMergeSetting(read, REPO)).toEqual({
      strategy: "merge-commit",
      file: ".github/renovate.json5",
      unread: ["github>acme/shared-renovate"],
    });
  });
});

// Slice 5.4 (record 0071): a preset outside the checkout is read through the
// GitHub API, the way Renovate reads a GitHub preset. npm and web addresses
// stay unread: that would be a network call that is not GitHub's.
describe("presets outside this repo", () => {
  type Remote = { owner: string; repo: string; path: string; ref: string | undefined };
  function remote(map: Record<string, string>, asked: Remote[] = []) {
    return async (file: Remote): Promise<string | undefined> => {
      asked.push(file);
      const key = `${file.owner}/${file.repo}${file.ref === undefined ? "" : `#${file.ref}`}:${file.path}`;
      if (key.startsWith("acme/private")) throw new Error("Not Found for a private repository");
      return map[key];
    };
  }

  test("reads a preset of another repo, its default falling back to renovate.json", async () => {
    const read = files({
      "renovate.json": '{ "extends": ["github>acme/renovate-config"] }',
    });
    const asked: Remote[] = [];
    const setting = await renovateMergeSetting(
      read,
      REPO,
      remote({ "acme/renovate-config:renovate.json": '{ "automergeStrategy": "rebase" }' }, asked),
    );
    expect(setting).toEqual({ strategy: "rebase", file: "renovate.json", unread: [] });
    expect(asked.map(({ path }) => path)).toEqual(["default.json", "renovate.json"]);
  });

  test("reads a preset at a tag at that tag, this repo's too", async () => {
    const read = files({
      "renovate.json":
        '{ "extends": ["github>acme/infra:merging#v1", "local>acme/shared//merge/how#v2.1.0"] }',
      "merging.json": '{ "automergeStrategy": "squash" }',
    });
    const asked: Remote[] = [];
    const setting = await renovateMergeSetting(
      read,
      REPO,
      remote(
        {
          "acme/infra#v1:merging.json": '{ "automergeStrategy": "rebase" }',
          "acme/shared#v2.1.0:merge/how.json": '{ "automergeStrategy": "merge-commit" }',
        },
        asked,
      ),
    );
    expect(setting.strategy).toBe("merge-commit");
    expect(asked.map(({ ref }) => ref)).toEqual(["v1", "v2.1.0"]);
  });

  test("follows a preset inside another repo's preset, and a later one still wins", async () => {
    const read = files({
      "renovate.json": '{ "extends": ["github>acme/base", "github>acme/infra:local"] }',
      "local.json": '{ "automergeStrategy": "squash" }',
    });
    const setting = await renovateMergeSetting(
      read,
      REPO,
      remote({
        "acme/base:default.json": '{ "extends": ["github>acme/deeper:merge"] }',
        "acme/deeper:merge.json": '{ "automergeStrategy": "rebase" }',
      }),
    );
    expect(setting.strategy).toBe("squash");
    const without = files({ "renovate.json": '{ "extends": ["github>acme/base"] }' });
    expect(
      (
        await renovateMergeSetting(
          without,
          REPO,
          remote({
            "acme/base:default.json": '{ "extends": ["github>acme/deeper:merge"] }',
            "acme/deeper:merge.json": '{ "automergeStrategy": "rebase" }',
          }),
        )
      ).strategy,
    ).toBe("rebase");
  });

  test("names a preset GitHub would not give, and one that is not there", async () => {
    const read = files({
      "renovate.json": '{ "extends": ["github>acme/private-config", "github>acme/gone"] }',
    });
    expect(await renovateMergeSetting(read, REPO, remote({}))).toEqual({
      strategy: undefined,
      file: "renovate.json",
      unread: ["github>acme/private-config", "github>acme/gone"],
    });
  });

  test("never asks GitHub for npm, a web address, another platform, parameters or a relative preset", async () => {
    const read = files({
      "renovate.json": JSON.stringify({
        extends: [
          "renovate-config-acme",
          "@acme/renovate-config",
          "https://example.com/preset.json",
          "gitlab>acme/renovate-config",
          "github>acme/renovate-config:args(1)",
          "./relative",
        ],
      }),
    });
    const asked: Remote[] = [];
    const setting = await renovateMergeSetting(read, REPO, remote({}, asked));
    expect(asked).toEqual([]);
    expect(setting.unread).toHaveLength(6);
  });
});
