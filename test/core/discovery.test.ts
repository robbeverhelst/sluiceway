import { describe, expect, test } from "bun:test";
import { DiscoveryError, knownStacks } from "../../src/core/discovery.ts";
import { type Stack, stackId } from "../../src/core/stack.ts";

function stack(path: string, name?: string): Stack {
  return name === undefined ? { path, options: {} } : { path, name, options: {} };
}

function kept(found: Stack[], ignore: string[]): string[] {
  return knownStacks(found, ignore).map(stackId);
}

const FOUND = [
  stack("apps/grafana", "dev"),
  stack("apps/grafana", "prod"),
  stack("apps/loki", "prod"),
  stack("examples/demo", "dev"),
  stack("playground", "dev"),
  stack("playground/nested", "dev"),
];

describe("ignore", () => {
  test("with no globs every stack is known", () => {
    expect(knownStacks(FOUND, [])).toEqual(FOUND);
  });

  test("a glob is matched against the stack id, and * crosses the colon", () => {
    expect(kept(FOUND, ["playground:*"])).toEqual([
      "apps/grafana:dev",
      "apps/grafana:prod",
      "apps/loki:prod",
      "examples/demo:dev",
      "playground/nested:dev",
    ]);
  });

  test("* does not cross a slash, ** does", () => {
    expect(kept(FOUND, ["apps/*"])).toEqual([
      "examples/demo:dev",
      "playground:dev",
      "playground/nested:dev",
    ]);
    expect(kept(FOUND, ["playground/**"])).toEqual([
      "apps/grafana:dev",
      "apps/grafana:prod",
      "apps/loki:prod",
      "examples/demo:dev",
      "playground:dev",
    ]);
  });

  test("a path pattern from before the stack id keeps working", () => {
    expect(kept(FOUND, ["**/examples/**"])).not.toContain("examples/demo:dev");
  });

  test("**/*:dev drops the dev stack of every directory, which a path cannot say", () => {
    expect(kept(FOUND, ["**/*:dev"])).toEqual(["apps/grafana:prod", "apps/loki:prod"]);
  });

  test("a stack is dropped when any one glob matches", () => {
    expect(kept(FOUND, ["nothing/**", "apps/loki:prod", "**/*:dev"])).toEqual([
      "apps/grafana:prod",
    ]);
  });

  test("a stack without a name is matched by its path", () => {
    expect(kept([stack("envs/prod"), stack("envs/dev")], ["envs/dev"])).toEqual(["envs/prod"]);
  });

  test("a leading dot is nothing special: the repo root and dot directories match", () => {
    const found = [stack(".", "dev"), stack(".", "prod"), stack(".infra/dns", "dev")];
    expect(kept(found, ["**/*:dev"])).toEqual([".:prod"]);
    expect(kept(found, [".:*"])).toEqual([".infra/dns:dev"]);
    expect(kept(found, ["*:prod"])).toEqual([".:dev", ".infra/dns:dev"]);
  });

  test("a glob that matches nothing is not an error", () => {
    expect(kept(FOUND, ["staging/**"])).toHaveLength(FOUND.length);
  });
});

describe("two stacks with one id", () => {
  test("is an error that names both", () => {
    // Record 0006: a colon in a path or a name is harmless until two ids meet.
    const found = [stack("apps", "web:prod"), stack("apps:web", "prod"), stack("apps", "api")];
    const error = (() => {
      try {
        return knownStacks(found, []);
      } catch (thrown) {
        return thrown;
      }
    })();
    expect(error).toBeInstanceOf(DiscoveryError);
    expect((error as DiscoveryError).problems).toEqual([
      'two stacks have the id "apps:web:prod": the Pulumi stack "web:prod" in "apps", and the Pulumi stack "prod" in "apps:web". A stack id has to name one stack. Rename or move one of them.',
    ]);
  });

  test("a stack without a name can meet one with a name", () => {
    expect(() => knownStacks([stack("envs:prod"), stack("envs", "prod")], [])).toThrow(
      'two stacks have the id "envs:prod": the Pulumi stack in "envs:prod", and the Pulumi stack "prod" in "envs".',
    );
  });

  test("names the tool of each side, so the reader knows which entry to change", () => {
    // Issue 168: a Pulumi stack and a declared stack
    // with the same path and name read the same without their tools.
    const declared: Stack = { path: "app", name: "dev", options: { tool: "opentofu" } };
    expect(() => knownStacks([stack("app", "dev"), declared], [])).toThrow(
      'two stacks have the id "app:dev": the Pulumi stack "dev" in "app", and the stack "dev" in "app" that a stacks entry declares with tool: opentofu.',
    );
  });

  test("a declared stack without a name names its tool too", () => {
    const chart: Stack = { path: "charts/web", options: { tool: "helm" } };
    const manifests: Stack = { path: "charts/web", options: { tool: "kubectl" } };
    expect(() => knownStacks([chart, manifests], [])).toThrow(
      'two stacks have the id "charts/web": the stack in "charts/web" that a stacks entry declares with tool: helm, and the stack in "charts/web" that a stacks entry declares with tool: kubectl.',
    );
  });

  test("ignored stacks do not exist, so they cannot clash", () => {
    const found = [stack("apps", "web:prod"), stack("apps:web", "prod"), stack("apps", "api")];
    expect(kept(found, ["apps:web:*"])).toEqual(["apps:api"]);
  });
});
