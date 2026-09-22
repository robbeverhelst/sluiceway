import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverAll } from "../../../src/adapters/discover-all.ts";
import { applyConfig, parseConfig } from "../../../src/core/config.ts";
import { stackId } from "../../../src/core/stack.ts";

// `phase: { from }` (slice 4.16, record 0067): a repo that already names each
// project's phase in the tool's own file points at that key. Discovery reads
// the text under it and nothing else of the file. Run on a copy of the
// example project, with the key written the three ways Pulumi accepts in a
// project file: under config as text, under config with a default, and at
// the top level.

const EXAMPLE = resolve(import.meta.dir, "../../../examples/pulumi-basic");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function edit(root: string, file: string, change: (text: string) => string): void {
  const path = join(root, file);
  writeFileSync(path, change(readFileSync(path, "utf8")));
}

function example(): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-phases-"));
  roots.push(root);
  cpSync(EXAMPLE, root, { recursive: true });
  edit(root, "network/Pulumi.yaml", (text) =>
    text.replace("config:\n", "config:\n  example:phase: infrastructure\n"),
  );
  edit(
    root,
    "site/Pulumi.yaml",
    (text) => `${text}config:\n  example:phase:\n    default: monitoring\n`,
  );
  edit(root, "app/Pulumi.yml", (text) => `${text}example:phase: applications\n`);
  return root;
}

const FROM = `phases: [infrastructure, monitoring, applications]
ignore: ["playground:*"]
stacks:
  - path: network
    phase: { from: "example:phase" }
  - path: app
    phase: { from: "example:phase" }
  - path: site
    phase: { from: "example:phase" }
`;

describe("phase: from on the example project", () => {
  test("reads each project's phase from its own file", async () => {
    const root = example();
    const config = parseConfig(FROM);
    const stacks = applyConfig(config, await discoverAll(root, config));
    expect(
      stacks.map((one) => [stackId(one.stack), one.phase, one.phaseFrom, one.dependsOn ?? []]),
    ).toEqual([
      ["app:prod", "applications", "example:phase", ["network:dev", "network:prod", "site:prod"]],
      ["network:dev", "infrastructure", "example:phase", []],
      ["network:prod", "infrastructure", "example:phase", []],
      ["site:prod", "monitoring", "example:phase", ["network:dev", "network:prod"]],
    ]);
  });

  test("hands on only the key a phase points at", async () => {
    const root = example();
    const config = parseConfig(FROM);
    const found = await discoverAll(root, config);
    for (const stack of found) {
      expect(Object.keys(stack.phaseKeys ?? {})).toEqual(
        stack.path === "playground" ? [] : ["example:phase"],
      );
    }
    // Without a phase that points at a key, nothing is read.
    const plain = await discoverAll(root, parseConfig(""));
    expect(plain.every((stack) => stack.phaseKeys === undefined)).toBe(true);
  });

  test("a secret config value is never read", async () => {
    const root = example();
    edit(root, "site/Pulumi.yaml", (text) =>
      text.replace("    default: monitoring\n", "    default: monitoring\n    secret: true\n"),
    );
    const config = parseConfig(FROM);
    const found = await discoverAll(root, config);
    expect(found.find((stack) => stack.path === "site")?.phaseKeys).toBeUndefined();
    expect(() => applyConfig(config, found)).toThrow(
      "stacks[2].phase: site:prod has no text under example:phase in its project file, under config or at the top level. Add it there, or name the phase here.",
    );
  });

  test("an entry with a tool cannot read a phase from a file", async () => {
    const config = parseConfig(`phases: [infrastructure]
stacks:
  - path: infra
    tool: opentofu
    phase: { from: "example:phase" }
`);
    await expect(discoverAll(example(), config)).rejects.toThrow(
      "stacks[0].phase: from reads a key of a Pulumi project file, and an opentofu stack has none. Name the phase instead.",
    );
  });
});
