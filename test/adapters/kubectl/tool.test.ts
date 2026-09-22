import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ToolVersionError } from "../../../src/adapters/adapter.ts";
import { kubectl } from "../../../src/adapters/kubectl/index.ts";
import { answering, FIXTURES, ROOT, replay, VERSIONS } from "./replay.ts";
import { CACHE, WEB } from "./stacks.ts";

// Everything of the Kubernetes manifests adapter around the preview (record
// 0060): the version check, the deploy of exactly the rendered set the
// preview diffed, and the tool's own diff.

const context = (run: Parameters<typeof kubectl.checkVersion>[0]["run"]) => ({
  root: ROOT,
  env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_secret" },
  run,
});

const printing = (stdout: string) =>
  answering({ status: "exited", exitCode: 0, stdout, stderr: "" });

const client = (gitVersion: string) => JSON.stringify({ clientVersion: { gitVersion } });

describe("the version check", () => {
  for (const version of VERSIONS) {
    test(`${version} is new enough, and the check reaches no cluster`, async () => {
      const { run, runs } = replay(version, "version");
      await kubectl.checkVersion(context(run), [WEB]);
      expect(runs[0]?.argv).toEqual(["kubectl", "version", "--client", "--output=json"]);
      expect(runs[0]?.env.INPUT_GITHUB_TOKEN).toBeUndefined();
    });
  }

  test("an older kubectl is one clear error that names both versions and the fix", async () => {
    const { run } = printing(client("v1.33.9"));
    await expect(kubectl.checkVersion(context(run), [WEB])).rejects.toThrow(
      new ToolVersionError(
        "Found kubectl v1.33.9. Sluiceway needs kubectl v1.34.0 or newer. Change the workflow step that installs kubectl so it installs a newer version.",
      ),
    );
  });

  test("a build of a provider's distribution counts as its version", async () => {
    const { run } = printing(client("v1.35.2-eks-1234567"));
    await kubectl.checkVersion(context(run), [WEB]);
  });

  test("a kubectl that is not there", async () => {
    const { run } = answering({ status: "not-started" });
    await expect(kubectl.checkVersion(context(run), [WEB])).rejects.toThrow(
      "Could not start kubectl. Sluiceway needs kubectl v1.34.0 or newer on PATH and does not install it. Add a workflow step that installs kubectl before the step that runs Sluiceway.",
    );
  });

  test("output that is not a version keeps the tool's words for the job log", async () => {
    const { run } = printing("Client Version: v1.34.0\n");
    const error = await kubectl.checkVersion(context(run), [WEB]).catch((thrown) => thrown);
    expect(error).toBeInstanceOf(ToolVersionError);
    expect((error as ToolVersionError).message).toBe(
      '"kubectl version --client --output=json" did not print a version Sluiceway can read. Sluiceway needs kubectl v1.34.0 or newer. The job log holds what the tool printed.',
    );
    expect((error as ToolVersionError).toolLog).toBe("Client Version: v1.34.0\n");
  });
});

for (const version of VERSIONS) {
  describe(`kubectl ${version}: the deploy`, () => {
    test("applies the rendered set the preview diffed, server-side, with the namespace", async () => {
      const { run, runs, sets } = replay(version, "deploy");
      const options = { root: ROOT, env: { KUBECONFIG: "/k" }, run, timeoutMinutes: 10 };
      const previewed = await kubectl.preview(WEB, { ...options, savePlan: true });
      if (!previewed.ok) throw new Error("The preview failed.");
      const applied = await kubectl.apply(WEB, options, previewed.plan);
      await previewed.plan?.dispose();
      expect(applied).toEqual({
        ok: true,
        toolLog: readFileSync(join(FIXTURES, version, "deploy", "apply.stdout"), "utf8"),
      });
      expect(runs[1]?.argv.slice(0, 4)).toEqual([
        "kubectl",
        "apply",
        "--server-side",
        "--namespace=sluiceway-example",
      ]);
      // No time limit: a deploy stopped half way leaves a stack half deployed.
      expect(runs[1]?.timeoutMs).toBeUndefined();
      expect(runs[1]?.env.KUBECTL_EXTERNAL_DIFF).toBeUndefined();
      expect(sets[1]).toEqual(sets[0]);
    });

    test("a deploy that fails is a tool error with the tool's words", async () => {
      const { run } = replay(version, "deploy-failed");
      const options = { root: ROOT, env: {}, run, timeoutMinutes: 10 };
      const previewed = await kubectl.preview(WEB, { ...options, savePlan: true });
      if (!previewed.ok) throw new Error("The preview failed.");
      const applied = await kubectl.apply(WEB, options, previewed.plan);
      await previewed.plan?.dispose();
      expect(applied.ok).toBe(false);
      if (!applied.ok) expect(applied.reason).toEqual({ kind: "tool-error", exitCode: 1 });
      expect(applied.toolLog).toContain("namespaces");
    });

    test("refuses a set that changed after its preview, and runs nothing", async () => {
      const { run, runs } = replay(version, "deploy");
      const options = { root: ROOT, env: {}, run, timeoutMinutes: 10 };
      const previewed = await kubectl.preview(WEB, { ...options, savePlan: true });
      if (!previewed.ok || previewed.plan === undefined) throw new Error("No set was kept.");
      writeFileSync((previewed.plan as unknown as { path: string }).path, "kind: Other\n");
      await expect(kubectl.apply(WEB, options, previewed.plan)).rejects.toThrow(
        "The rendered set of web changed after its preview. Nothing was deployed.",
      );
      await previewed.plan.dispose();
      expect(runs).toHaveLength(1);
    });
  });
}

describe("the deploy never renders again", () => {
  test("without the set its fresh preview kept, it refuses", async () => {
    const { run, runs } = answering({ status: "exited", exitCode: 0, stdout: "", stderr: "" });
    await expect(kubectl.apply(WEB, { root: ROOT, env: {}, run })).rejects.toThrow(
      "A Kubernetes manifests stack deploys only the rendered set its fresh preview kept.",
    );
    expect(runs).toHaveLength(0);
  });

  test("the set of another stack is refused", async () => {
    const { run } = answering(
      { status: "exited", exitCode: 0, stdout: "kind: A\n", stderr: "" },
      { status: "exited", exitCode: 0, stdout: "", stderr: "" },
    );
    const options = { root: ROOT, env: {}, run, timeoutMinutes: 10 };
    const { run: diffRun } = answering({ status: "exited", exitCode: 0, stdout: "", stderr: "" });
    const previewed = await kubectl.preview(CACHE, { ...options, run, savePlan: true });
    if (!previewed.ok) throw new Error("The preview failed.");
    await expect(kubectl.apply(WEB, { ...options, run: diffRun }, previewed.plan)).rejects.toThrow(
      "A Kubernetes manifests stack deploys only the rendered set its fresh preview kept.",
    );
    await previewed.plan?.dispose();
  });
});

for (const version of VERSIONS) {
  describe(`kubectl ${version}: the tool's own diff`, () => {
    test("is kubectl diff as a person reads it, with the job's own diff program", async () => {
      const { run, runs } = replay(version, "log-diff-changed-secret");
      const result = await kubectl.toolDiff(WEB, { root: ROOT, env: {}, run, timeoutMinutes: 10 });
      const stdout = readFileSync(
        join(FIXTURES, version, "log-diff-changed-secret", "tool-diff.stdout"),
        "utf8",
      );
      expect(result).toEqual({ ok: true, text: stdout, toolLog: "" });
      expect(runs[0]?.env.KUBECTL_EXTERNAL_DIFF).toBeUndefined();
      // kubectl masks a Secret itself (the recording).
      expect(stdout).not.toContain("CANARY-SECRET");
      expect(stdout).toContain("CANARY-VALUE");
    });
  });
}

describe("the tool's own diff, where no recording holds it", () => {
  test("no differences is an empty text", async () => {
    const { run } = answering({ status: "exited", exitCode: 0, stdout: "", stderr: "" });
    const result = await kubectl.toolDiff(WEB, { root: ROOT, env: {}, run, timeoutMinutes: 1 });
    expect(result).toEqual({ ok: true, text: "", toolLog: "" });
  });

  test("an error is a tool error, and its words are the tool log", async () => {
    const { run } = answering({ status: "exited", exitCode: 2, stdout: "", stderr: "denied\n" });
    const result = await kubectl.toolDiff(WEB, { root: ROOT, env: {}, run, timeoutMinutes: 1 });
    expect(result).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: 2 },
      toolLog: "denied\n",
    });
  });
});
