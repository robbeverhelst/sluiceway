import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAll } from "../../src/adapters/discover-all.ts";
import { type Config, ConfigError } from "../../src/core/config.ts";
import { DiscoveryError } from "../../src/core/discovery.ts";
import { type Discovery, openRepo } from "../../src/core/repo.ts";
import { type Stack, stackId } from "../../src/core/stack.ts";

// A real repo root on disk: the config file and the Pulumi files are read
// the way a job reads them, and discovery is the one every mode is handed.
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sluiceway-repo-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, text: string): void {
  const file = join(root, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
}

// A Pulumi project in `path` with one stack file per name.
function project(path: string, ...names: string[]): void {
  write(`${path}/Pulumi.yaml`, `name: ${path.replaceAll("/", "-")}\nruntime: nodejs\n`);
  for (const name of names) write(`${path}/Pulumi.${name}.yaml`, "config: {}\n");
}

// The discovery of a job, counting how often it is asked.
function counted(): Discovery & { calls: number } {
  const discovery = {
    calls: 0,
    discover(root: string, config: Config): Promise<Stack[]> {
      discovery.calls++;
      return discoverAll(root, config);
    },
  };
  return discovery;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("the stacks of a repo", () => {
  test("every stack discovery finds, with what config gives it, in stack id order", async () => {
    // By path, infra comes before infra-shared. By stack id, "infra-shared:prod"
    // comes before "infra:dev", because "-" sorts before ":". The rows are in
    // stack id order, so every mode is.
    project("infra", "dev");
    project("infra-shared", "prod");
    write("sluiceway.yaml", "stacks:\n  - path: infra\n    environment: infra-env\n");

    const { stacks, ignored } = await openRepo(root, counted()).stacks();

    expect(stacks.map(({ stack }) => stackId(stack))).toEqual(["infra-shared:prod", "infra:dev"]);
    expect(stacks.map(({ environment }) => environment)).toEqual(["sluiceway", "infra-env"]);
    expect(ignored).toEqual([]);
  });

  test("an ignored stack is left out, and one ignored with a reason is listed with it", async () => {
    project("apps/api", "dev", "prod");
    project("apps/legacy", "prod");
    project("scratch", "dev");
    write(
      "sluiceway.yaml",
      `ignore:
  - scratch:*
  - glob: "apps/legacy:*"
    reason: Deployed by the platform team
`,
    );

    const { stacks, ignored } = await openRepo(root, counted()).stacks();

    expect(stacks.map(({ stack }) => stackId(stack))).toEqual(["apps/api:dev", "apps/api:prod"]);
    expect(ignored).toEqual([
      { stackId: "apps/legacy:prod", reason: "Deployed by the platform team" },
    ]);
  });

  test("the id a stacks entry gives a stack is the id it is ordered by", async () => {
    project("infra", "dev", "prod");
    write("sluiceway.yaml", "stacks:\n  - path: infra\n    name: prod\n    id: a-prod\n");

    const { stacks } = await openRepo(root, counted()).stacks();

    expect(stacks.map(({ stack }) => stackId(stack))).toEqual(["a-prod", "infra:dev"]);
  });
});

describe("read once per run", () => {
  test("the config file is read once and discovery runs once, however often they are asked", async () => {
    project("infra", "dev");
    write("sluiceway.yaml", "tickers: admin\n");
    const discovery = counted();
    const repo = openRepo(root, discovery);

    const config = repo.config();
    const first = await repo.stacks();
    // A file that changes under a run does not change what the run sees.
    write("sluiceway.yaml", "tickers: write\n");
    project("more", "dev");

    expect(repo.config()).toBe(config);
    expect(repo.config().tickers).toBe("admin");
    expect(await repo.stacks()).toBe(first);
    expect(discovery.calls).toBe(1);
  });

  test("nothing is read until it is asked, so a run that needs neither never fails on them", () => {
    write("sluiceway.yaml", "tickerz: admin\n");
    const discovery = counted();

    openRepo(root, discovery);

    expect(discovery.calls).toBe(0);
  });

  test("asking for the config runs no discovery", () => {
    project("infra", "dev");
    const discovery = counted();

    openRepo(root, discovery).config();

    expect(discovery.calls).toBe(0);
  });
});

describe("errors, in the order a scan meets them (record 0012)", () => {
  test("a config file that cannot be read throws the same error on every ask, and discovery never runs", async () => {
    project("infra", "dev");
    write("sluiceway.yaml", "tickerz: admin\n");
    const discovery = counted();
    const repo = openRepo(root, discovery);

    let first: unknown;
    try {
      repo.config();
    } catch (error) {
      first = error;
    }
    expect(first).toBeInstanceOf(ConfigError);
    expect(() => repo.config()).toThrow(first as Error);
    expect(await rejection(repo.stacks())).toBe(first);
    expect(discovery.calls).toBe(0);
  });

  test("a discovery error fails the stacks and leaves the config readable", async () => {
    write("infra/Pulumi.yaml", "name: [unclosed\n");
    write("sluiceway.yaml", "tickers: admin\n");
    const repo = openRepo(root, counted());

    expect(await rejection(repo.stacks())).toBeInstanceOf(DiscoveryError);
    expect(repo.config().tickers).toBe("admin");
  });

  test("a stacks entry that covers no stack found is a config error of the stacks", async () => {
    project("infra", "dev");
    write("sluiceway.yaml", "stacks:\n  - path: gone\n    environment: prod\n");
    const discovery = counted();
    const repo = openRepo(root, discovery);

    expect(repo.config().stacks).toHaveLength(1);
    const error = await rejection(repo.stacks());
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).issues).toEqual([
      { kind: "entry-no-stack", stackPath: "gone", path: ["stacks", 0] },
    ]);
    expect(discovery.calls).toBe(1);
  });
});
