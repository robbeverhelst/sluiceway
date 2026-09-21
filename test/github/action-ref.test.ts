import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { actionDirectory, actionRef, readActionRef } from "../../src/github/action-ref.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const HEAD = "fedcba9876543210fedcba9876543210fedcba98";

// The rule of the build plan, section 3: the header images are served from
// the exact release tag of the running action, or its commit SHA, never from
// a moving tag (record 0033).
describe("the action ref", () => {
  test("1. a full commit SHA is used as it is", () => {
    expect(actionRef({ actionRef: SHA, packageVersion: "0.1.0", sha: HEAD })).toBe(SHA);
  });

  test("1. an exact version tag is used as it is", () => {
    expect(actionRef({ actionRef: "v1.2.3", packageVersion: "9.9.9", sha: HEAD })).toBe("v1.2.3");
    expect(actionRef({ actionRef: "v0.10.0", packageVersion: "9.9.9", sha: HEAD })).toBe("v0.10.0");
  });

  test.each(["v0", "v1", "v1.2", "main", "1.2.3", "v1.2.3-rc.1", "v1.2.3.4", SHA.slice(0, 7)])(
    "2. %s is not exact, so the version next to the action names the tag",
    (moving) => {
      expect(actionRef({ actionRef: moving, packageVersion: "0.1.0", sha: HEAD })).toBe("v0.1.0");
    },
  );

  test("3. `uses: ./` has no action ref, so it is the commit of the run", () => {
    expect(actionRef({ actionRef: undefined, packageVersion: "0.1.0", sha: HEAD })).toBe(HEAD);
    expect(actionRef({ actionRef: "", packageVersion: undefined, sha: HEAD })).toBe(HEAD);
  });

  test("a moving ref with no version next to the action is an error, never a moving url", () => {
    expect(() => actionRef({ actionRef: "v0", packageVersion: undefined, sha: HEAD })).toThrow(
      "The action was started from the ref v0, which can move, and its package.json holds no version. The header images need an exact release tag or a commit SHA.",
    );
  });

  test("an upper case SHA is not a SHA GitHub hands out, so it is not exact", () => {
    expect(actionRef({ actionRef: SHA.toUpperCase(), packageVersion: "0.1.0", sha: HEAD })).toBe(
      "v0.1.0",
    );
  });
});

// The glue around the rule. The environment comes in as data, the directory
// the action was downloaded to is handed over by the entry point, and the file
// is read through a function the caller hands over.
describe("reading the action ref", () => {
  // Where a runner puts `uses: sluiceway/sluiceway@v0`, seen in the lab.
  const ACTION = "/home/runner/work/_actions/sluiceway/sluiceway/v0";
  const files = (version: unknown) => (path: string) => {
    if (path !== `${ACTION}/package.json`) throw new Error(`ENOENT ${path}`);
    return JSON.stringify({ name: "sluiceway", version });
  };
  // What a runner sets for a JavaScript action: no GITHUB_ACTION_PATH, which
  // GitHub sets for composite actions only.
  const env = { GITHUB_SHA: HEAD };

  test("a moving tag reads the version from the package.json next to the action", () => {
    expect(readActionRef({ ...env, GITHUB_ACTION_REF: "v0" }, ACTION, files("0.3.1"))).toBe(
      "v0.3.1",
    );
  });

  // The bug of 0.1.0: the version was only looked for under
  // GITHUB_ACTION_PATH, which a runner never sets for a JavaScript action.
  test("GITHUB_ACTION_PATH is not where the version is found", () => {
    const elsewhere = { ...env, GITHUB_ACTION_REF: "v0", GITHUB_ACTION_PATH: "/somewhere/else" };
    expect(readActionRef(elsewhere, ACTION, files("0.3.1"))).toBe("v0.3.1");
  });

  // The version is read at run time and only when the rule needs it.
  test("an exact ref reads no file", () => {
    const never = () => {
      throw new Error("read a file");
    };
    expect(readActionRef({ ...env, GITHUB_ACTION_REF: "v1.2.3" }, ACTION, never)).toBe("v1.2.3");
    expect(readActionRef({ ...env, GITHUB_ACTION_REF: SHA }, ACTION, never)).toBe(SHA);
    expect(readActionRef(env, ACTION, never)).toBe(HEAD);
  });

  test("a package.json that is missing, broken or without a version is the rule's error", () => {
    const moving = { ...env, GITHUB_ACTION_REF: "main" };
    expect(() => readActionRef(moving, ACTION, files(undefined))).toThrow("holds no version");
    expect(() => readActionRef(moving, ACTION, files(7))).toThrow("holds no version");
    expect(() => readActionRef(moving, ACTION, () => "{ not json")).toThrow("holds no version");
    expect(() => readActionRef(moving, "/not/the/action", files("1.0.0"))).toThrow(
      "holds no version",
    );
  });

  test("a run with no commit at all is an error", () => {
    expect(() => readActionRef({}, ACTION, files("1.0.0"))).toThrow("GITHUB_SHA is not set");
  });
});

// The entry point knows where it runs from, in the source and in the bundle.
describe("the directory of the action", () => {
  test("the bundle a runner starts sits in dist/, one below the action's directory", () => {
    expect(
      actionDirectory("file:///home/runner/work/_actions/sluiceway/sluiceway/v0/dist/index.js"),
    ).toBe("/home/runner/work/_actions/sluiceway/sluiceway/v0");
  });

  test("the source entry sits in src/, one below the repo's root", () => {
    expect(actionDirectory("file:///work/sluiceway/src/main.ts")).toBe("/work/sluiceway");
  });

  test("the bundle and the entry it is built from are both one directory deep", () => {
    const action = Bun.YAML.parse(readFileSync("action.yml", "utf8")) as { runs: { main: string } };
    const build: string = JSON.parse(readFileSync("package.json", "utf8")).scripts.build;
    expect(action.runs.main).toBe("dist/index.js");
    expect(build).toContain("src/main.ts");
    expect(build).toContain("--outfile=dist/index.js");
  });
});
