import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { ROOT } from "../docs/docs.ts";

// Slice 5.30 (record 0094): the npm package `sluiceway` is the command line,
// released with the action and from the same tag.

const SRC = resolve(ROOT, "src");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

// Every file under src/ the command line can reach, and every package.
function reach(entry: string): { files: string[]; packages: string[]; dynamic: string[] } {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const files = new Set<string>();
  const packages = new Set<string>();
  const dynamic = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    // The entry starts with the line that runs it with node, which the
    // transpiler does not read.
    const code = readFileSync(file, "utf8").replace(/^#!.*\n/, "");
    for (const { path, kind } of transpiler.scanImports(code)) {
      if (path.endsWith(".sh")) continue;
      if (kind === "dynamic-import") dynamic.add(path);
      else if (path.startsWith(".")) visit(resolve(dirname(file), path));
      else packages.add(path);
    }
  };
  visit(join(SRC, entry));
  return {
    files: [...files].map((file) => relative(SRC, file)).sort(),
    packages: [...packages].sort(),
    dynamic: [...dynamic].sort(),
  };
}

describe("the command line cannot reach a runner's powers", () => {
  const { files, packages, dynamic } = reach("cli.ts");

  test("no process runner, no GitHub port, no Actions glue, no sender", () => {
    expect(files).not.toContain("adapters/process.ts");
    expect(files.filter((file) => /^(github|notify)\//.test(file))).toEqual([]);
    expect(files).not.toContain("main.ts");
    expect(files).not.toContain("mode.ts");
    expect(files.filter((file) => file.startsWith("modes/"))).toEqual([
      "modes/check.ts",
      "modes/init.ts",
    ]);
    expect(dynamic).toEqual([]);
  });

  // Slice 5.53 (record 0116): node:child_process starts the keychain's own
  // command, and node:os finds the person's home for the token file.
  test("the packages it imports", () => {
    expect(packages).toEqual([
      "node:child_process",
      "node:fs",
      "node:fs/promises",
      "node:os",
      "node:path",
      "node:url",
      "picomatch",
      "yaml",
      "zod",
    ]);
  });

  // The app's commands reach the app through one client, and init and the
  // check reach neither it nor the keychain.
  test("one file calls fetch, and init and the check reach none of the app's code", () => {
    const callers = files.filter((file) =>
      /\bfetch\(/.test(readFileSync(join(SRC, file), "utf8").replace(/\/\/.*$/gm, "")),
    );
    expect(callers).toEqual(["cli/app-client.ts"]);
    for (const entry of ["modes/init.ts", "modes/check.ts"]) {
      const reached = reach(entry).files;
      expect(reached.filter((file) => file.startsWith("cli/"))).toEqual([]);
    }
  });
});

describe("the package", () => {
  test("is the command sluiceway, from the bundle of the command line", () => {
    expect(pkg.name).toBe("sluiceway");
    expect(pkg.private).toBeUndefined();
    expect(pkg.bin).toEqual({ sluiceway: "dist/cli.js" });
  });

  test("publishes the bundle alone, next to the package file, the readme and the licence", () => {
    expect(pkg.files).toEqual(["dist/cli.js"]);
    expect(pkg.license).toBe("Apache-2.0");
  });

  test("needs Node 22 or newer", () => {
    expect(pkg.engines).toEqual({ node: ">=22" });
  });

  // npm accepts a trusted publish only from the repository the package names.
  test("names this repository", () => {
    expect(pkg.repository.url).toBe("git+https://github.com/sluiceway/sluiceway.git");
  });

  test("the build writes both bundles, and the action's entry is where it was", () => {
    expect(pkg.scripts.build).toContain("src/main.ts");
    expect(pkg.scripts.build).toContain("--outfile=dist/index.js");
    expect(pkg.scripts.build).toContain("src/cli.ts");
    expect(pkg.scripts.build).toContain("--outfile=dist/cli.js");
    const action = parse(readFileSync(join(ROOT, "action.yml"), "utf8"));
    expect(action.runs.main).toBe("dist/index.js");
  });

  test("the version is the one release-please keeps, for the action and the package alike", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, ".release-please-manifest.json"), "utf8"));
    expect(pkg.version).toBe(manifest["."]);
  });
});

describe("the committed bundle", () => {
  const bundle = readFileSync(join(ROOT, "dist/cli.js"), "utf8");

  // Record 0116: the app's commands add a client and a token store, not a
  // package. npx downloads this file on every first run.
  test("stays small: under 1.5 MB", () => {
    expect(Buffer.byteLength(bundle)).toBeLessThan(1_500_000);
  });

  test("starts with the line that runs it with node", () => {
    expect(bundle.split("\n")[0]).toBe("#!/usr/bin/env node");
  });

  test("prints the version of the package.json one directory up", () => {
    const run = Bun.spawnSync(["bun", join(ROOT, "dist/cli.js"), "--version"]);
    expect(run.stdout.toString()).toBe(`${pkg.version}\n`);
    expect(run.exitCode).toBe(0);
  });

  test("refuses scan with its sentence and exit code 2", () => {
    const run = Bun.spawnSync(["bun", join(ROOT, "dist/cli.js"), "scan"]);
    expect(run.exitCode).toBe(2);
    expect(run.stderr.toString()).toContain("needs the run's identity and the workflow token");
  });
});

// The publish step of the release workflow (record 0094): npm's trusted
// publishing, with no secret, and a warning while npm does not trust it.
describe("the npm job of the release workflow", () => {
  type Step = { id?: string; name?: string; uses?: string; if?: string; run?: string };
  const workflow = parse(readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8")) as {
    jobs: Record<
      string,
      {
        needs?: string;
        if?: string;
        permissions?: Record<string, string>;
        outputs?: Record<string, string>;
        "runs-on"?: string;
        steps: Step[];
      }
    >;
  };
  const job = workflow.jobs.npm;
  const text = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");

  test("runs after a release, on a runner GitHub hosts, with an OIDC token and no write", () => {
    expect(job).toBeDefined();
    expect(job?.needs).toBe("release-please");
    expect(job?.if).toBe("needs.release-please.outputs.release_created == 'true'");
    expect(job?.["runs-on"]).toBe("ubuntu-latest");
    expect(job?.permissions).toEqual({ contents: "read", "id-token": "write" });
  });

  test("uses no secret at all", () => {
    expect(text).not.toContain("secrets.");
    expect(text).not.toContain("NODE_AUTH_TOKEN");
    expect(text).not.toContain("NPM_TOKEN");
  });

  test("checks out the release tag", () => {
    const checkout = job?.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout).toBeDefined();
    expect(JSON.stringify(checkout)).toContain("needs.release-please.outputs.tag_name");
    expect(workflow.jobs["release-please"]?.outputs).toMatchObject({
      release_created: "${{ steps.release.outputs.release_created }}",
      tag_name: "${{ steps.release.outputs.tag_name }}",
    });
  });

  // Slice 5.32: npm's exchange endpoint said yes in run 35884043091 and the
  // publish was still refused, so no probe decides. The script reads npm's
  // own answer to the publish (test/scripts/publish-npm.test.ts).
  test("publishes through the script that tells a refusal from a failure, and nothing skips it", () => {
    const steps = job?.steps ?? [];
    expect(steps.some((step) => step.id === "trusted")).toBe(false);
    expect(text).not.toContain("oidc/token/exchange");
    expect(text).not.toContain("continue-on-error");
    for (const step of steps) expect(step.if).toBeUndefined();
    const publish = steps.findIndex((step) => step.run === "scripts/ci/publish-npm.sh");
    expect(publish).toBe(steps.length - 1);
    expect(steps.filter((step) => step.run?.includes("npm publish"))).toEqual([]);
    const before = steps.slice(0, publish);
    expect(before.some((step) => step.uses?.startsWith("actions/checkout@"))).toBe(true);
    expect(before.some((step) => step.uses?.startsWith("actions/setup-node@"))).toBe(true);
    // npm 11.5.1 is the first that publishes with OIDC.
    expect(before.some((step) => /npm@11\.\d+\.\d+/.test(step.run ?? ""))).toBe(true);
  });

  test("pins every action it uses by commit", () => {
    for (const step of job?.steps ?? []) {
      if (step.uses !== undefined) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});
