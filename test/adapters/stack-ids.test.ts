import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { discoverAll } from "../../src/adapters/discover-all.ts";
import { applyConfig, ConfigError, ignoredStacks, parseConfig } from "../../src/core/config.ts";
import { stackId } from "../../src/core/stack.ts";

// Slice 5.9: `stacks[].id` gives one stack the id it has everywhere, in place
// of the one derived from its path and name. A stack that moved keeps its
// row, its deployment records and its settings under the id it had. Run on
// the example project.

const EXAMPLE = resolve(import.meta.dir, "../../examples/pulumi-basic");

async function ids(config: string): Promise<string[]> {
  const parsed = parseConfig(config);
  return (await discoverAll(EXAMPLE, parsed)).map(stackId);
}

describe("the id of a stack entry", () => {
  test("names the stack everywhere, in place of the derived id", async () => {
    expect(await ids("stacks:\n  - path: site\n    id: web:prod\n")).toEqual([
      "app:prod",
      "network:dev",
      "network:prod",
      "playground:dev",
      "web:prod",
    ]);
  });

  test("is what ignore, dependsOn and the settings of other entries match", async () => {
    const config = parseConfig(
      [
        'ignore: ["playground:*", "site:*"]',
        "stacks:",
        "  - path: site",
        "    id: web:prod",
        "    dependsOn: [network:prod]",
        "  - path: app",
        "    name: prod",
        "    dependsOn: [web:prod]",
      ].join("\n"),
    );
    const found = await discoverAll(EXAMPLE, config);
    const stacks = applyConfig(config, found);
    expect(stacks.map(({ stack }) => stackId(stack))).toEqual([
      "app:prod",
      "network:dev",
      "network:prod",
      "web:prod",
    ]);
    expect(stacks.find(({ stack }) => stackId(stack) === "app:prod")?.dependsOn).toEqual([
      "web:prod",
    ]);
    expect(ignoredStacks(config, found)).toEqual([]);
  });

  test("an entry that covers more than one stack cannot give them one id", async () => {
    await expect(ids("stacks:\n  - path: network\n    id: net\n")).rejects.toThrow(
      "stacks[0].id: the entry covers 2 stacks (network:dev, network:prod), and an id names one. Give the entry a name.",
    );
  });

  test("an entry that covers no stack cannot give one an id", async () => {
    await expect(ids("stacks:\n  - path: nowhere\n    id: net\n")).rejects.toThrow(
      "stacks[0].id: the entry covers no stack, so there is nothing to name net.",
    );
  });

  test("an id that another stack has already is refused", async () => {
    await expect(ids("stacks:\n  - path: site\n    id: network:prod\n")).rejects.toThrow(
      'stacks[0].id: "network:prod" is the id of another stack already. Every stack id is unique.',
    );
    await expect(
      ids("stacks:\n  - path: site\n    id: one\n  - path: app\n    name: prod\n    id: one\n"),
    ).rejects.toThrow("stacks[1].id");
  });

  test("an id is plain: no space, no markup", () => {
    expect(() => parseConfig('stacks:\n  - path: site\n    id: "web prod"\n')).toThrow(ConfigError);
    expect(() => parseConfig('stacks:\n  - path: site\n    id: "<b>"\n')).toThrow(ConfigError);
  });
});
