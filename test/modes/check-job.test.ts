import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { backendContext } from "../../src/modes/check-backend.ts";
import { runCheck } from "../../src/modes/check-job.ts";

const SRC = resolve(import.meta.dir, "../../src");

// Every file under src/ the check job can reach, and every package it
// imports. Type-only imports are left out by the transpiler, so this is what
// the job can run. A dynamic import is listed apart and not followed.
function reach(entry: string): { files: string[]; packages: string[]; dynamic: string[] } {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const files = new Set<string>();
  const packages = new Set<string>();
  const dynamics = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const { path, kind } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      const target = path.startsWith(".") ? resolve(dirname(file), path) : path;
      if (kind === "dynamic-import") {
        dynamics.add(path.startsWith(".") ? relative(SRC, target) : path);
        continue;
      }
      if (path.startsWith(".")) visit(target);
      else packages.add(path);
    }
  };
  visit(join(SRC, entry));
  return {
    files: [...files].map((file) => relative(SRC, file)).sort(),
    packages: [...packages].sort(),
    dynamic: [...dynamics].sort(),
  };
}

// Record 0042: the check needs no credential, no tool and no GitHub API. The
// process runner and the port are never constructed, because the check job
// cannot reach the code that builds them.
describe("the check job never constructs the process runner or the GitHub port", () => {
  const { files, packages } = reach("modes/check-job.ts");

  test("it reaches neither the process runner nor anything that talks to GitHub", () => {
    expect(files).not.toContain("adapters/process.ts");
    // inputs.ts reads the backend input, as text, and imports nothing.
    // env-file.ts reads the one file the env-file input names, only with
    // backend: true (record 0100), and talks to nobody.
    expect(files.filter((file) => file.startsWith("github/"))).toEqual([
      "github/env-file.ts",
      "github/inputs.ts",
      "github/job-log.ts",
    ]);
    expect(files.filter((file) => file.startsWith("modes/"))).toEqual([
      "modes/check-job.ts",
      "modes/check.ts",
    ]);
  });

  // @actions/core is the job log and the summary. node:crypto makes the
  // token that stops workflow commands around the tool's own diff (record
  // 0048). Nothing here starts a process or opens a connection.
  test("the packages it imports", () => {
    expect(packages).toEqual([
      "@actions/core",
      "node:crypto",
      "node:fs",
      "node:fs/promises",
      "node:path",
      "picomatch",
      "yaml",
      "zod",
    ]);
  });
});

// Record 0074: with backend: true, and only then, the check asks the backend.
// The dispatcher hands the job what does that, so the job's own imports
// still reach no process runner.
describe("the backend part of the check", () => {
  test("the check job imports nothing on demand", () => {
    expect(reach("modes/check-job.ts").dynamic).toEqual([]);
  });

  test("the part the dispatcher hands in starts the tool and talks to no GitHub API", () => {
    const { files } = reach("modes/check-backend.ts");
    expect(files).toContain("adapters/process.ts");
    expect(files.filter((file) => file.startsWith("github/"))).toEqual([]);
  });
});

describe("runCheck, as a step runs it", () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  afterEach(() => {
    process.env = { ...saved };
    globalThis.fetch = realFetch;
  });

  // @actions/core keeps the first summary file it is handed for the whole
  // process, so this test hands it none: the summary fails, the check says so
  // in the log and goes on. The summary itself is tested in check.test.ts.
  test("makes no network call and runs to the end", async () => {
    const root = mkdtempSync(join(tmpdir(), "sluiceway-check-job-"));
    for (const [file, text] of Object.entries({
      "network/Pulumi.yaml": "name: network\nruntime: yaml\n",
      "network/Pulumi.prod.yaml": "",
      "README.md": "",
    })) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    const calls: unknown[] = [];
    globalThis.fetch = Object.assign(
      async (...args: unknown[]) => {
        calls.push(args);
        throw new Error("The check makes no network call.");
      },
      { preconnect: () => {} },
    ) as typeof fetch;
    // A step of a check job has the workflow token in its inputs too. The
    // check never reads it.
    process.env = {
      ...saved,
      GITHUB_WORKSPACE: root,
      GITHUB_STEP_SUMMARY: "",
      "INPUT_GITHUB-TOKEN": "ghs_not_a_token",
    };

    const written: string[] = [];
    const realWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) =>
      written.push(String(chunk)) > 0) as typeof process.stdout.write;
    try {
      // Without backend: true the part that asks the backend is never used.
      await runCheck(() => {
        throw new Error("The check asks no backend unless the input says so.");
      });
    } finally {
      process.stdout.write = realWrite;
    }

    expect(calls).toEqual([]);
    expect(written.join("")).toContain("Found 1 stack.");
    expect(written.join("")).toContain("The setup is valid.");
  });

  test("with backend: true it asks the tool, and a tool that is not there is a warning", async () => {
    const root = mkdtempSync(join(tmpdir(), "sluiceway-check-job-"));
    mkdirSync(join(root, "network"));
    writeFileSync(join(root, "network/Pulumi.yaml"), "name: network\nruntime: yaml\n");
    writeFileSync(join(root, "network/Pulumi.prod.yaml"), "");
    // A PATH with no tool on it, so no process starts.
    const empty = mkdtempSync(join(tmpdir(), "sluiceway-no-tool-"));
    process.env = {
      ...saved,
      PATH: empty,
      GITHUB_WORKSPACE: root,
      GITHUB_STEP_SUMMARY: "",
      INPUT_BACKEND: "true",
    };
    const written: string[] = [];
    const realWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) =>
      written.push(String(chunk)) > 0) as typeof process.stdout.write;
    try {
      await runCheck(backendContext);
    } finally {
      process.stdout.write = realWrite;
    }
    const out = written.join("");
    expect(out).toContain(
      "network:prod: could not ask the backend, the tool exited with an error.",
    );
    expect(out).toContain("The setup is valid.");
  });

  // Record 0092: the check lists what root module discovery found and left
  // out. The job handed the check no way to ask, so a real run said nothing.
  test("lists the root modules discovery found from their files", async () => {
    const root = mkdtempSync(join(tmpdir(), "sluiceway-check-job-"));
    mkdirSync(join(root, "infra"));
    writeFileSync(join(root, "infra/main.tf"), 'terraform {\n  backend "s3" {}\n}\n');
    writeFileSync(
      join(root, "infra/.terraform.lock.hcl"),
      'provider "registry.opentofu.org/hashicorp/null" {}\n',
    );
    process.env = { ...saved, GITHUB_WORKSPACE: root, GITHUB_STEP_SUMMARY: "" };
    const written: string[] = [];
    const realWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) =>
      written.push(String(chunk)) > 0) as typeof process.stdout.write;
    try {
      await runCheck();
    } finally {
      process.stdout.write = realWrite;
    }
    expect(written.join("")).toContain("Root modules found from their files");
  });

  test("fails with a clear message outside a job", async () => {
    process.env = { ...saved, GITHUB_WORKSPACE: "" };
    await expect(runCheck()).rejects.toThrow(
      "GITHUB_WORKSPACE is not set. Sluiceway runs as a step of a GitHub Actions job.",
    );
  });
});

// Slice 5.35 (record 0100): the check with backend: true runs the tool, so
// it reads the env file for it. Without backend: true the file is never
// opened.
describe("the env file in the check job", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  function checkRoot(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), "sluiceway-check-job-"));
    for (const [file, text] of Object.entries({
      "network/Pulumi.yaml": "name: network\nruntime: yaml\n",
      "network/Pulumi.prod.yaml": "",
      ...files,
    })) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    return root;
  }

  async function quietly(run: () => Promise<void>): Promise<string> {
    const written: string[] = [];
    const realWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) =>
      written.push(String(chunk)) > 0) as typeof process.stdout.write;
    try {
      await run();
    } finally {
      process.stdout.write = realWrite;
    }
    return written.join("");
  }

  test("with backend: true the backend gets the file's values, masked first", async () => {
    const root = checkRoot({ "ci/deploy.env": "PULUMI_ACCESS_TOKEN=pul-0123456789\nREGION=eu\n" });
    process.env = {
      ...saved,
      GITHUB_WORKSPACE: root,
      GITHUB_STEP_SUMMARY: "",
      INPUT_BACKEND: "true",
      "INPUT_ENV-FILE": "ci/deploy.env",
      REGION: "us",
    };
    let handed: Record<string, string | undefined> | undefined;
    const out = await quietly(() =>
      runCheck((env) => {
        handed = env;
        return { adapter: { ...backendContext(env).adapter }, env, run: backendContext(env).run };
      }),
    );
    expect(handed?.PULUMI_ACCESS_TOKEN).toBe("pul-0123456789");
    expect(handed?.REGION).toBe("eu");
    expect(handed?.GITHUB_WORKSPACE).toBe(root);
    expect(out.indexOf("::add-mask::pul-0123456789")).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("::add-mask::pul-0123456789")).toBeLessThan(
      out.indexOf("Loaded the env file ci/deploy.env"),
    );
    expect(out).not.toContain("::add-mask::eu");
  });

  test("with backend: true a file that is not there fails the check before the tool", async () => {
    const root = checkRoot({});
    process.env = {
      ...saved,
      GITHUB_WORKSPACE: root,
      GITHUB_STEP_SUMMARY: "",
      INPUT_BACKEND: "true",
      "INPUT_ENV-FILE": "ci/deploy.env",
    };
    await expect(quietly(() => runCheck(backendContext))).rejects.toThrow(
      'The "env-file" input names ci/deploy.env, and there is no such file in the checkout.',
    );
  });

  test("without backend: true the file is never opened", async () => {
    const root = checkRoot({});
    process.env = {
      ...saved,
      GITHUB_WORKSPACE: root,
      GITHUB_STEP_SUMMARY: "",
      "INPUT_ENV-FILE": "ci/deploy.env",
    };
    const out = await quietly(() => runCheck());
    expect(out).toContain("The setup is valid.");
    expect(out).not.toContain("env file");
  });
});
