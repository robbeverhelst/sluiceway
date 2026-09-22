import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { CANARY_SECRET, CANARY_VALUE, EXAMPLE_PROGRAMS } from "../scripts/fixtures/example.ts";
import { pulumi } from "../src/adapters/pulumi/index.ts";
import { applyConfig } from "../src/core/config.ts";
import { loadConfig } from "../src/core/config-file.ts";

// examples/pulumi-basic is what the fixtures are recorded from and what the
// e2e workflow scans (build plan, section 6). These tests pin what the later
// slices rely on, so nobody tidies it away.

const ROOT = resolve(import.meta.dir, "../examples/pulumi-basic");

function text(...path: string[]): string {
  return readFileSync(join(ROOT, ...path), "utf8");
}

describe("the example project", () => {
  test("network/ is a YAML program spelled Pulumi.yaml with the stacks dev and prod", () => {
    expect(parse(text("network/Pulumi.yaml")).runtime).toBe("yaml");
    expect(readdirSync(join(ROOT, "network")).sort()).toEqual([
      "Pulumi.dev.yaml",
      "Pulumi.prod.yaml",
      "Pulumi.yaml",
    ]);
  });

  test("app/ is a YAML program spelled Pulumi.yml with the stack prod", () => {
    expect(parse(text("app/Pulumi.yml")).runtime).toBe("yaml");
    expect(existsSync(join(ROOT, "app/Pulumi.prod.yml"))).toBe(true);
    expect(existsSync(join(ROOT, "app/Pulumi.yaml"))).toBe(false);
  });

  test("app/ holds a stray Pulumi.dev.yaml, which the tool passes over", () => {
    expect(existsSync(join(ROOT, "app/Pulumi.dev.yaml"))).toBe(true);
    expect(existsSync(join(ROOT, "app/Pulumi.dev.yml"))).toBe(false);
  });

  test("site/ is a TypeScript program with one stack and an install step", () => {
    expect(parse(text("site/Pulumi.yaml")).runtime.name).toBe("nodejs");
    expect(existsSync(join(ROOT, "site/index.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "site/package-lock.json"))).toBe(true);
    const stackFiles = readdirSync(join(ROOT, "site")).filter((name) =>
      /^Pulumi\..+\.yaml$/.test(name),
    );
    expect(stackFiles).toEqual(["Pulumi.prod.yaml"]);
  });

  test("the list of programs names every directory with a project file", () => {
    const found = readdirSync(ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((dir) => readdirSync(join(ROOT, dir)).some((name) => /^Pulumi\.ya?ml$/.test(name)))
      .sort();
    expect(EXAMPLE_PROGRAMS.map((program) => program.dir).sort()).toEqual(found);
  });

  for (const program of EXAMPLE_PROGRAMS) {
    test(`${program.dir}/ holds a property with the canary value`, () => {
      expect(text(program.dir, program.source)).toContain(CANARY_VALUE);
    });

    for (const stackFile of program.stackFiles) {
      test(`${program.dir}/${stackFile} holds a secret config value, encrypted`, () => {
        const config = parse(text(program.dir, stackFile)).config as Record<string, unknown>;
        const secrets = Object.values(config).filter(
          (value) => typeof value === "object" && value !== null && "secure" in value,
        );
        expect(secrets.length).toBeGreaterThan(0);
        expect(text(program.dir, stackFile)).not.toContain(CANARY_SECRET);
      });
    }
  }
});

describe("the example sluiceway.yaml", () => {
  const config = loadConfig(ROOT);

  test("loads", () => {
    expect(config.dashboard.label).toBe("sluiceway");
  });

  test("uses inputs on a stack", () => {
    expect(config.stacks.some((entry) => (entry.inputs ?? []).length > 0)).toBe(true);
  });

  test("uses a tick rule on one stack", () => {
    expect(config.stacks.some((entry) => entry.tickers !== undefined)).toBe(true);
  });

  test("uses ignore", () => {
    expect(config.ignore.length).toBeGreaterThan(0);
  });

  test("every input points at something that exists", () => {
    for (const entry of config.stacks) {
      for (const input of entry.inputs ?? []) {
        const fixedPart = input.slice(0, input.search(/[*?[{]|$/));
        expect(existsSync(join(ROOT, fixedPart))).toBe(true);
      }
    }
  });

  test("every entry names a directory of the example", () => {
    const dirs = EXAMPLE_PROGRAMS.map((program) => program.dir);
    for (const entry of config.stacks) expect(dirs).toContain(entry.path);
  });

  test("laid over the stacks that discovery finds, it leaves playground out and sets the rest", async () => {
    expect(applyConfig(config, await pulumi.discover(ROOT, config))).toEqual([
      {
        stack: { path: "app", name: "prod", options: {} },
        environment: "sluiceway",
        tickers: "write",
        inputs: ["shared/**"],
      },
      {
        stack: { path: "network", name: "dev", options: {} },
        environment: "network",
        tickers: "write",
        inputs: [],
      },
      {
        stack: { path: "network", name: "prod", options: {} },
        environment: "network",
        tickers: ["alice", "bob"],
        inputs: [],
      },
      {
        stack: { path: "site", name: "prod", options: {} },
        environment: "sluiceway",
        tickers: "write",
        inputs: [],
      },
    ]);
  });
});
