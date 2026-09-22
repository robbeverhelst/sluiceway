import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, replay, VERSIONS } from "./replay.ts";

// `dependsOn: auto` (slice 4.7, record 0059): the stacks a stack depends on,
// read from the stack references of its program at each preview. The
// recorded scenario adds a reference from app/ to network:prod to the example
// project. The adapter turns the name of a reference into a stack id of the
// repo and hands on nothing else of it: no name, no value (record 0021).

const EXAMPLE = resolve(import.meta.dir, "../../../examples/pulumi-basic");
const APP_PROD: Stack = { path: "app", name: "prod", options: {} };
const stack = (path: string, name: string): Stack => ({ path, name, options: {} });
const REPO = [
  stack("app", "dev"),
  APP_PROD,
  stack("network", "dev"),
  stack("network", "prod"),
  stack("site", "prod"),
];

function dependenciesOf(result: PreviewResult) {
  if (!result.ok) throw new Error(`expected a diff, got the failure ${result.reason.kind}`);
  return result.dependencies;
}

describe.each(VERSIONS)("the recorded stack reference, %s", (version) => {
  const previewOf = (dependencies: Stack[] | undefined) =>
    pulumi.preview(APP_PROD, {
      root: EXAMPLE,
      env: {},
      run: replay(version, "stack-reference", EXAMPLE).run,
      timeoutMinutes: 10,
      dependencies,
    });

  test("names network:prod, before app:prod was ever deployed", async () => {
    const result = await previewOf(REPO);
    expect(dependenciesOf(result)).toEqual({ stackIds: ["network:prod"], elsewhere: 0 });
    // The reference is a read. It changes nothing, so it is no change.
    expect(
      result.ok && result.diff.changes.some((change) => change.type.includes("StackReference")),
    ).toBe(false);
  });

  test("names it again when nothing changed, so an in sync stack keeps it", async () => {
    const { run } = replay(version, "stack-reference", EXAMPLE);
    // The first recorded preview is the one before the deploy.
    const options = { root: EXAMPLE, env: {}, run, timeoutMinutes: 10, dependencies: REPO };
    await pulumi.preview(APP_PROD, options);
    const after = await pulumi.preview(APP_PROD, options);
    expect(after.ok && after.diff.changes).toEqual([]);
    expect(dependenciesOf(after)).toEqual({ stackIds: ["network:prod"], elsewhere: 0 });
  });

  test("a stack that did not ask gets nothing read", async () => {
    expect(dependenciesOf(await previewOf(undefined))).toBeUndefined();
  });

  test("a reference to a stack the repo does not hold counts as elsewhere", async () => {
    const withoutNetwork = REPO.filter((one) => one.path !== "network");
    expect(dependenciesOf(await previewOf(withoutNetwork))).toEqual({
      stackIds: [],
      elsewhere: 1,
    });
  });
});

// The other forms a name takes, against a repo made here. The output is
// synthetic, in the shape the recordings show: the forms cannot all be
// recorded from one file backend, whose organization is always the same.
describe("the forms of a stack reference name", () => {
  function repo(projects: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "sluiceway-refs-"));
    for (const [path, name] of Object.entries(projects)) {
      const file = join(root, path, "Pulumi.yaml");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `name: ${name}\nruntime: yaml\n`);
    }
    return root;
  }

  function document(...names: string[]): string {
    return JSON.stringify({
      steps: [
        { op: "same", urn: "urn:pulumi:prod::app::pulumi:pulumi:Stack::app-prod" },
        ...names.map((name, index) => ({
          op: "read",
          urn: `urn:pulumi:prod::app::pulumi:pulumi:StackReference::ref${index}`,
          newState: { inputs: { name } },
        })),
      ],
    });
  }

  async function read(root: string, stacks: Stack[], ...names: string[]) {
    const { run } = answering({
      status: "exited",
      exitCode: 0,
      stdout: document(...names),
      stderr: "",
    });
    return dependenciesOf(
      await pulumi.preview(APP_PROD, {
        root,
        env: {},
        run,
        timeoutMinutes: 10,
        dependencies: stacks,
      }),
    );
  }

  const PROJECTS = { app: "app", "infra/net": "network", other: "network-copy" };
  const STACKS = [
    APP_PROD,
    stack("app", "dev"),
    stack("infra/net", "prod"),
    stack("other", "prod"),
  ];

  test("organization/project/stack is matched by the project's name, not its directory", async () => {
    expect(await read(repo(PROJECTS), STACKS, "acme/network/prod")).toEqual({
      stackIds: ["infra/net:prod"],
      elsewhere: 0,
    });
  });

  test("a stack name alone is a stack of the same project", async () => {
    expect(await read(repo(PROJECTS), STACKS, "dev")).toEqual({
      stackIds: ["app:dev"],
      elsewhere: 0,
    });
  });

  test("two parts are project/stack, or else organization/stack of the same project", async () => {
    expect(await read(repo(PROJECTS), STACKS, "network/prod", "acme/dev")).toEqual({
      stackIds: ["app:dev", "infra/net:prod"],
      elsewhere: 0,
    });
  });

  test("the stack itself, a name that fits two stacks and a stack elsewhere", async () => {
    const twins = { ...PROJECTS, other: "network" };
    expect(
      await read(repo(twins), STACKS, "acme/app/prod", "acme/network/prod", "acme/billing/prod"),
    ).toEqual({ stackIds: [], elsewhere: 2 });
  });

  test("each stack once, in stack id order", async () => {
    expect(
      await read(repo(PROJECTS), STACKS, "acme/network/prod", "dev", "acme/network/prod"),
    ).toEqual({ stackIds: ["app:dev", "infra/net:prod"], elsewhere: 0 });
  });

  test("a name on any other resource is never read", async () => {
    const { run } = answering({
      status: "exited",
      exitCode: 0,
      stdout: JSON.stringify({
        steps: [
          {
            op: "create",
            urn: "urn:pulumi:prod::app::random:index/randomPet:RandomPet::pet",
            newState: { inputs: { name: "acme/network/prod" } },
          },
        ],
      }),
      stderr: "",
    });
    const result = await pulumi.preview(APP_PROD, {
      root: repo(PROJECTS),
      env: {},
      run,
      timeoutMinutes: 10,
      dependencies: STACKS,
    });
    expect(dependenciesOf(result)).toEqual({ stackIds: [], elsewhere: 0 });
  });
});
