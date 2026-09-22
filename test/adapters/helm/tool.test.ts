import { describe, expect, test } from "bun:test";
import { type SavedPlan, ToolVersionError } from "../../../src/adapters/adapter.ts";
import { helm } from "../../../src/adapters/helm/index.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, ROOT, replay, VERSIONS } from "./replay.ts";
import { WEB, WORKER } from "./stacks.ts";

// Everything of the Helm adapter around the preview (record 0058): the
// version check of helm and its diff plugin, the dependency build that runs
// before the pool, the deploy held to the manifests the fresh preview
// rendered, and the tool's own diff.

const context = (run: Parameters<typeof helm.checkVersion>[0]["run"]) => ({
  root: ROOT,
  env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_secret" },
  run,
});

const exited = (stdout: string, exitCode = 0, stderr = "") =>
  ({ status: "exited", exitCode, stdout, stderr }) as const;

describe("the version check", () => {
  for (const version of VERSIONS) {
    test(`${version} and its diff plugin are new enough`, async () => {
      const { run, runs } = replay(version, "version");
      await helm.checkVersion(context(run), [WEB]);
      expect(runs.map((one) => one.argv)).toEqual([
        ["helm", "version", "--template={{.Version}}"],
        ["helm", "diff", "version"],
      ]);
      expect(runs.every((one) => one.cwd === ROOT)).toBe(true);
      expect(runs[0]?.env.INPUT_GITHUB_TOKEN).toBeUndefined();
    });
  }

  test("an older helm is one clear error that names both versions and the fix", async () => {
    const { run } = answering(exited("v3.17.4"));
    await expect(helm.checkVersion(context(run), [WEB])).rejects.toThrow(
      new ToolVersionError(
        "Found helm v3.17.4. Sluiceway needs helm v3.18.0 or newer. Change the workflow step that installs helm so it installs a newer version.",
      ),
    );
  });

  test("a helm that is not there", async () => {
    const { run } = answering({ status: "not-started" });
    await expect(helm.checkVersion(context(run), [WEB])).rejects.toThrow(
      "Could not start helm. Sluiceway needs helm v3.18.0 or newer on PATH and does not install it. Add a workflow step that installs helm before the step that runs Sluiceway.",
    );
  });

  test("output that is not a version keeps the tool's words for the job log", async () => {
    const { run } = answering(exited("version.BuildInfo{}\n"));
    const error = await helm.checkVersion(context(run), [WEB]).catch((thrown) => thrown);
    expect(error).toBeInstanceOf(ToolVersionError);
    expect((error as ToolVersionError).message).toBe(
      '"helm version --template={{.Version}}" did not print a version Sluiceway can read. Sluiceway needs helm v3.18.0 or newer. The job log holds what the tool printed.',
    );
    expect((error as ToolVersionError).toolLog).toBe("version.BuildInfo{}\n");
  });

  test("a helm without the diff plugin", async () => {
    const { run } = answering(
      exited("v4.3.0"),
      exited("", 1, 'Error: unknown command "diff" for "helm"\n'),
    );
    const error = await helm.checkVersion(context(run), [WEB]).catch((thrown) => thrown);
    expect(error).toBeInstanceOf(ToolVersionError);
    expect((error as ToolVersionError).message).toBe(
      "The helm diff plugin did not say which version it is. Sluiceway needs helm-diff v3.15.11 or newer and does not install it. Add a workflow step that runs helm plugin install https://github.com/databus23/helm-diff before the step that runs Sluiceway.",
    );
    expect((error as ToolVersionError).toolLog).toContain("unknown command");
  });

  test("an older diff plugin", async () => {
    const { run } = answering(exited("v4.3.0"), exited("3.15.10\n"));
    await expect(helm.checkVersion(context(run), [WEB])).rejects.toThrow(
      "Found helm-diff v3.15.10. Sluiceway needs helm-diff v3.15.11 or newer. Change the workflow step that installs the plugin so it installs a newer version.",
    );
  });

  test("pre-releases of newer versions count", async () => {
    const { run } = answering(exited("v4.4.0-rc.1"), exited("3.16.0-rc.1"));
    await helm.checkVersion(context(run), [WEB]);
  });
});

describe("dependencies before the pool", () => {
  const other: Stack = { ...WORKER, name: "blue", path: "blue" };

  test("one build per local chart that has dependencies, in path order, for every stack of it", () => {
    const preparations = helm.prepare?.([other, WEB, WORKER]) ?? [];
    expect(preparations.map((one) => [one.title, one.stacks.map((stack) => stack.path)])).toEqual([
      ["charts/worker", ["blue", "worker"]],
    ]);
  });

  test("a chart without dependencies, or a chart reference, needs none", () => {
    expect(helm.prepare?.([WEB]) ?? []).toEqual([]);
  });

  for (const version of VERSIONS) {
    test(`${version}: the build runs in the chart's directory`, async () => {
      const { run, runs } = replay(version, "dependencies");
      const [build] = helm.prepare?.([WORKER]) ?? [];
      const result = await build?.run({ ...context(run), timeoutMinutes: 4 });
      expect(result?.ok).toBe(true);
      expect(runs[0]?.argv).toEqual(["helm", "dependency", "build", "."]);
      expect(runs[0]?.cwd).toBe(`${ROOT}/charts/worker`);
      expect(runs[0]?.timeoutMs).toBe(240_000);
    });

    test(`${version}: a failed build keeps the tool's words`, async () => {
      const { run } = replay(version, "dependencies-failed");
      const [build] = helm.prepare?.([WORKER]) ?? [];
      const result = await build?.run({ ...context(run), timeoutMinutes: 4 });
      expect(result).toMatchObject({ ok: false, reason: { kind: "tool-error", exitCode: 1 } });
      expect(result?.toolLog).toContain("../gone");
    });
  }
});

async function freshPreview(version: string, scenario: string) {
  const replayed = replay(version, scenario);
  const result = await helm.preview(WEB, {
    ...context(replayed.run),
    timeoutMinutes: 10,
    savePlan: true,
  });
  if (!result.ok || result.plan === undefined) throw new Error("expected a saved render");
  return { ...replayed, plan: result.plan };
}

describe("the deploy of what the fresh preview rendered", () => {
  for (const version of VERSIONS) {
    test(`${version}: the render is kept, rendered again right before the deploy, and the deploy goes out`, async () => {
      const { run, runs, plan } = await freshPreview(version, "deploy");
      const result = await helm.apply(WEB, context(run), plan);
      expect(result.ok).toBe(true);
      expect(runs.map((one) => one.argv.slice(0, 3).join(" "))).toEqual([
        "helm diff upgrade",
        "helm template web",
        "helm template web",
        "helm upgrade web",
      ]);
      expect(runs.at(-1)?.argv).toEqual([
        "helm",
        "upgrade",
        "web",
        "../charts/web",
        "--namespace=sluiceway-web",
        "--install",
        "--reset-values",
        "--atomic",
        "--hide-notes",
        "--values=values.yaml",
      ]);
      expect(runs.at(-1)?.cwd).toBe(`${ROOT}/web`);
      // A deploy has no time limit of its own. A render of the preview does.
      expect(runs.at(-1)?.timeoutMs).toBeUndefined();
      expect(runs[1]?.timeoutMs).toBe(600_000);
      expect(result.toolLog).toContain("STATUS: deployed");
      await plan.dispose();
    });

    test(`${version}: a render that moved since the fresh preview is refused, and nothing is deployed`, async () => {
      const { run, runs, plan } = await freshPreview(version, "unstable-render");
      const result = await helm.apply(WEB, context(run), plan);
      expect(result).toMatchObject({ ok: false, reason: { kind: "moved" } });
      expect(result.toolLog).toBe("");
      expect(runs.some((one) => one.argv[1] === "upgrade")).toBe(false);
    });

    test(`${version}: a deploy the cluster refuses is rolled back and fails with the exit code`, async () => {
      const { run, plan } = await freshPreview(version, "deploy-failed");
      const result = await helm.apply(WEB, context(run), plan);
      expect(result).toMatchObject({ ok: false, reason: { kind: "tool-error", exitCode: 1 } });
      expect(result.toolLog).toContain("rolled back");
    });
  }

  test("there is no deploy without the render of the fresh preview", async () => {
    const { run } = answering(exited(""));
    await expect(helm.apply(WEB, context(run))).rejects.toThrow(
      "A Helm stack deploys only what its fresh preview rendered.",
    );
    const other: SavedPlan = { dispose: async () => {} };
    await expect(helm.apply(WEB, context(run), other)).rejects.toThrow(
      "A Helm stack deploys only what its fresh preview rendered.",
    );
  });

  test("the render of another stack is refused", async () => {
    const [version = ""] = VERSIONS;
    const { run, plan } = await freshPreview(version, "deploy");
    await expect(helm.apply(WORKER, context(run), plan)).rejects.toThrow(
      "A Helm stack deploys only what its fresh preview rendered.",
    );
  });

  test("a render that fails right before the deploy deploys nothing", async () => {
    const [version = ""] = VERSIONS;
    const { plan } = await freshPreview(version, "deploy");
    const { run, runs } = answering(exited("", 1, "Error: cluster unreachable"));
    const result = await helm.apply(WEB, context(run), plan);
    expect(result).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: 1 },
      toolLog: "Error: cluster unreachable",
    });
    expect(runs).toHaveLength(1);
  });

  test("a preview that was not asked to keep its render keeps none, and renders nothing", async () => {
    const [version = ""] = VERSIONS;
    const { run, runs } = replay(version, "new-stack");
    const result = await helm.preview(WEB, { ...context(run), timeoutMinutes: 10 });
    expect(result.ok && result.plan).toBeFalsy();
    expect(runs).toHaveLength(1);
  });
});

describe("the tool's own diff", () => {
  for (const version of VERSIONS) {
    test(`${version}: the plugin's diff, secrets redacted by the plugin`, async () => {
      const { run, runs } = replay(version, "log-diff");
      const result = await helm.toolDiff(WEB, { ...context(run), timeoutMinutes: 10 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.text).toContain("color=green");
      expect(result.text).not.toContain("CANARY-SECRET");
      expect(runs[0]?.argv).toContain("--output=diff");
      expect(runs[0]?.cwd).toBe(`${ROOT}/web`);
    });
  }

  test("a diff that fails", async () => {
    const { run } = answering(exited("", 1, "Error: boom"));
    expect(await helm.toolDiff(WEB, { ...context(run), timeoutMinutes: 10 })).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: 1 },
      toolLog: "Error: boom",
    });
  });
});

test("Helm stacks have no drift check", () => {
  expect(helm.detectDrift).toBeUndefined();
});
