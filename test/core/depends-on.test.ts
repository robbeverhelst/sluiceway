import { describe, expect, test } from "bun:test";
import { applyConfig, ConfigError, type ConfigIssue, parseConfig } from "../../src/core/config.ts";
import type { Stack } from "../../src/core/stack.ts";

// `dependsOn` in sluiceway.yaml (slice 4.4, record 0056): stack ids of the
// stacks a stack depends on. Checked against discovery, like every other
// setting on a stack, so a dependency that could never hold anything back is
// an error and never a gate that stays silent.

const stack = (path: string, name?: string): Stack =>
  name === undefined ? { path, options: {} } : { path, name, options: {} };

const FOUND = [
  stack("network", "dev"),
  stack("network", "prod"),
  stack("app", "prod"),
  stack("site", "prod"),
  stack("playground", "dev"),
];

function configured(text: string, found = FOUND) {
  return applyConfig(parseConfig(text), found);
}

// The issues as facts. Their words are test/render/config-problems.test.ts's.
function issues(text: string, found = FOUND): ConfigIssue[] {
  try {
    configured(text, found);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("expected the config to be refused");
}

const dependsOn = (text: string) =>
  Object.fromEntries(
    configured(text).map((one) => [`${one.stack.path}:${one.stack.name}`, one.dependsOn]),
  );

describe("dependsOn", () => {
  test("is absent on a stack that has none", () => {
    expect(configured("").every((one) => one.dependsOn === undefined)).toBe(true);
  });

  test("gives a stack the stack ids it depends on", () => {
    expect(
      dependsOn(
        "stacks:\n  - path: app\n    dependsOn: [network:prod]\n  - path: site\n    name: prod\n    dependsOn: [app:prod, network:prod]\n",
      ),
    ).toEqual({
      "network:dev": undefined,
      "network:prod": undefined,
      "app:prod": ["network:prod"],
      "site:prod": ["app:prod", "network:prod"],
      "playground:dev": undefined,
    });
  });

  test("an entry without a name gives it to every stack in its path, and entries add up", () => {
    expect(
      dependsOn(
        "stacks:\n  - path: network\n    name: prod\n    dependsOn: [network:dev]\n  - path: app\n    dependsOn: [network:dev]\n  - path: app\n    name: prod\n    dependsOn: [network:prod, network:dev]\n",
      )["app:prod"],
    ).toEqual(["network:dev", "network:prod"]);
  });

  test("a stack that discovery did not find is an error", () => {
    expect(issues("stacks:\n  - path: app\n    dependsOn: [network:staging]\n")).toEqual([
      {
        kind: "depends-on-unknown",
        stackId: "network:staging",
        example: "network:dev",
        path: ["stacks", 0, "dependsOn", 0],
      },
    ]);
  });

  test("an ignored stack is an error, because the dependency could never hold anything back", () => {
    expect(
      issues('ignore: ["playground:*"]\nstacks:\n  - path: app\n    dependsOn: [playground:dev]\n'),
    ).toEqual([
      {
        kind: "depends-on-ignored",
        stackId: "playground:dev",
        path: ["stacks", 0, "dependsOn", 0],
      },
    ]);
  });

  test("an ignored stack whose ignore entry has a reason is refused with that reason (record 0059)", () => {
    expect(
      issues(
        'ignore:\n  - glob: "playground:*"\n    reason: a sandbox nobody deploys\nstacks:\n  - path: app\n    dependsOn: [playground:dev]\n',
      ),
    ).toEqual([
      {
        kind: "depends-on-ignored",
        stackId: "playground:dev",
        reason: "a sandbox nobody deploys",
        path: ["stacks", 0, "dependsOn", 0],
      },
    ]);
  });

  test("a stack that depends on itself is refused", () => {
    expect(issues("stacks:\n  - path: app\n    dependsOn: [app:prod]\n")).toEqual([
      { kind: "depends-on-itself", stackId: "app:prod", path: ["stacks", 0, "dependsOn", 0] },
    ]);
  });

  test("a cycle is refused at config load, named once in stack id order", () => {
    expect(
      issues(
        "stacks:\n  - path: network\n    name: prod\n    dependsOn: [site:prod]\n  - path: app\n    dependsOn: [network:prod]\n  - path: site\n    dependsOn: [app:prod]\n",
      ),
    ).toEqual([
      {
        kind: "depends-on-circle",
        circle: [
          { stack: "app:prod" },
          { stack: "network:prod" },
          { stack: "site:prod" },
          { stack: "app:prod" },
        ],
        path: [],
      },
    ]);
  });

  test("the list is text, and an empty entry is refused", () => {
    expect(issues("stacks:\n  - path: app\n    dependsOn: network:prod\n")).toEqual([
      {
        kind: "not-a-depends-on",
        value: "network:prod",
        auto: "auto",
        path: ["stacks", 0, "dependsOn"],
      },
    ]);
    expect(issues('stacks:\n  - path: app\n    dependsOn: [""]\n')).toEqual([
      { kind: "empty", path: ["stacks", 0, "dependsOn", 0] },
    ]);
  });
});

// `dependsOn: auto` (slice 4.7, record 0059): the stacks a stack depends on
// are read from its program's stack references at each preview, not named in
// the file.
describe("dependsOn: auto", () => {
  test("marks the stack, and names no stack in the file", () => {
    const stacks = configured("stacks:\n  - path: app\n    dependsOn: auto\n");
    const app = stacks.find((one) => one.stack.path === "app");
    expect(app?.dependsOnAuto).toBe(true);
    expect(app?.dependsOn).toBeUndefined();
    expect(stacks.filter((one) => one.dependsOnAuto).length).toBe(1);
  });

  test("adds up with a list from another entry", () => {
    const stacks = configured(
      "stacks:\n  - path: app\n    dependsOn: auto\n  - path: app\n    name: prod\n    dependsOn: [network:dev]\n",
    );
    const app = stacks.find((one) => one.stack.path === "app");
    expect(app?.dependsOnAuto).toBe(true);
    expect(app?.dependsOn).toEqual(["network:dev"]);
  });

  test("any other word is refused", () => {
    expect(issues("stacks:\n  - path: app\n    dependsOn: automatic\n")).toEqual([
      {
        kind: "not-a-depends-on",
        value: "automatic",
        auto: "auto",
        path: ["stacks", 0, "dependsOn"],
      },
    ]);
  });
});
