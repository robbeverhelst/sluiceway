import { describe, expect, test } from "bun:test";
import { applyConfig, ConfigError, parseConfig } from "../../src/core/config.ts";
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

function problems(text: string, found = FOUND): string[] {
  try {
    configured(text, found);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
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
    expect(problems("stacks:\n  - path: app\n    dependsOn: [network:staging]\n")).toEqual([
      'stacks[0].dependsOn[0]: "network:staging" is not a stack that discovery found. Write the stack id as a row shows it, such as "network:dev".',
    ]);
  });

  test("an ignored stack is an error, because the dependency could never hold anything back", () => {
    expect(
      problems(
        'ignore: ["playground:*"]\nstacks:\n  - path: app\n    dependsOn: [playground:dev]\n',
      ),
    ).toEqual([
      'stacks[0].dependsOn[0]: "playground:dev" is left out by ignore, so it never has a change to wait for. Remove it here, or change ignore.',
    ]);
  });

  test("a stack that depends on itself is refused", () => {
    expect(problems("stacks:\n  - path: app\n    dependsOn: [app:prod]\n")).toEqual([
      'stacks[0].dependsOn[0]: "app:prod" is the stack itself. A stack cannot depend on itself.',
    ]);
  });

  test("a cycle is refused at config load, named once in stack id order", () => {
    expect(
      problems(
        "stacks:\n  - path: network\n    name: prod\n    dependsOn: [site:prod]\n  - path: app\n    dependsOn: [network:prod]\n  - path: site\n    dependsOn: [app:prod]\n",
      ),
    ).toEqual([
      "dependsOn goes round in a circle: app:prod depends on network:prod, which depends on site:prod, which depends on app:prod. Nothing in a circle could ever deploy first, so take one of these out.",
    ]);
  });

  test("the list is text, and an empty entry is refused", () => {
    expect(problems("stacks:\n  - path: app\n    dependsOn: network:prod\n")).toEqual([
      'stacks[0].dependsOn: expected a list, got "network:prod".',
    ]);
    expect(problems('stacks:\n  - path: app\n    dependsOn: [""]\n')).toEqual([
      "stacks[0].dependsOn[0]: must not be empty.",
    ]);
  });
});
