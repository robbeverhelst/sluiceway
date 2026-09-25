import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { ROOT } from "../docs/docs.ts";

// Slice 5.53 (record 0116): every release also carries the command line as
// standalone binaries, for a machine with no Node, with their checksums.

type Step = {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};
type Job = {
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  "runs-on"?: string;
  steps: Step[];
};
const workflow = parse(readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8")) as {
  jobs: Record<string, Job>;
};
const script = readFileSync(join(ROOT, "scripts/ci/build-binaries.sh"), "utf8");

const TARGETS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "windows-x64"];

describe("the script that builds the binaries", () => {
  test("builds the command line's entry for the five targets", () => {
    expect(script).toContain("src/cli.ts");
    expect(script).toContain("--compile");
    for (const target of TARGETS) expect(script).toContain(target);
    expect(script).toContain('--target="bun-$target"');
  });

  test("compiles the release's version in, since a binary has no package.json beside it", () => {
    expect(script).toContain("SLUICEWAY_VERSION");
  });

  test("runs the binary of the machine it built on, and stops when it prints another version", () => {
    expect(script).toContain("--version");
  });

  test("writes the checksums of every binary", () => {
    expect(script).toContain("SHA256SUMS");
  });

  test("runs and makes a binary that prints its version", () => {
    const out = mkdtempSync(join(tmpdir(), "sluiceway-binaries-"));
    const run = Bun.spawnSync(["bash", "scripts/ci/build-binaries.sh", out, "host"], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${join(process.execPath, "..")}:${process.env.PATH}` },
    });
    try {
      expect(run.stderr.toString()).not.toContain("error");
      expect(run.exitCode).toBe(0);
      const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
      const sums = readFileSync(join(out, "SHA256SUMS"), "utf8").trim().split("\n");
      expect(sums).toHaveLength(1);
      const [, name] = sums[0]?.split(/\s+/) ?? [];
      const version = Bun.spawnSync([join(out, name ?? ""), "--version"], { env: {} });
      expect(version.stdout.toString()).toBe(`${pkg.version}\n`);
    } finally {
      Bun.spawnSync(["rm", "-rf", out]);
    }
  }, 120_000);
});

describe("the jobs of the release workflow", () => {
  const build = workflow.jobs.binaries;
  const upload = workflow.jobs["binaries-upload"];

  test("build after a release from its tag, and can write nothing", () => {
    expect(build?.needs).toBe("release-please");
    expect(build?.if).toBe("needs.release-please.outputs.release_created == 'true'");
    expect(build?.permissions).toEqual({ contents: "read" });
    const checkout = build?.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(JSON.stringify(checkout)).toContain("needs.release-please.outputs.tag_name");
    expect(build?.steps.some((step) => step.run?.includes("scripts/ci/build-binaries.sh"))).toBe(
      true,
    );
    expect(build?.steps.some((step) => step.uses?.startsWith("actions/upload-artifact@"))).toBe(
      true,
    );
  });

  // The job that can write to the release installs and runs nothing of the
  // repo's: it takes the files the build made and uploads them.
  test("upload in a job of their own, which runs no package", () => {
    expect(upload?.needs).toEqual(["release-please", "binaries"]);
    expect(upload?.permissions).toEqual({ contents: "write" });
    const text = JSON.stringify(upload?.steps);
    expect(text).not.toContain("actions/checkout@");
    expect(text).not.toContain("bun ");
    expect(text).toContain("actions/download-artifact@");
    expect(text).toContain("gh release upload");
    expect(text).toContain("needs.release-please.outputs.tag_name");
  });

  test("pin every action by commit", () => {
    for (const job of [build, upload]) {
      for (const step of job?.steps ?? []) {
        if (step.uses !== undefined) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });
});
