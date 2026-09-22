import { describe, expect, test } from "bun:test";
import { type SavedPlan, ToolVersionError } from "../../../src/adapters/adapter.ts";
import { helm } from "../../../src/adapters/helm/index.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, ROOT, recorded, replay, VERSIONS } from "./replay.ts";
import { WEB, WEB_NEW_NAMESPACE, WORKER, WORKER_NESTED } from "./stacks.ts";

// Everything of the Helm adapter around the preview (records 0058 and 0069):
// the version check of helm and its diff plugin, the dependency builds that
// run before the pool, the deploy held to the manifests the fresh preview
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

  test("a subchart's dependencies are built before the chart that holds it, once for every stack that needs them", () => {
    const deeper: Stack = {
      ...WEB,
      path: "shop",
      options: {
        ...WEB.options,
        chartDir: "charts/shop",
        builds: [
          { chart: "charts/web", level: 1 },
          { chart: "charts/shop", level: 3 },
          { chart: "charts/zz-base", level: 0 },
        ],
      },
    };
    const preparations = helm.prepare?.([deeper, WORKER_NESTED]) ?? [];
    expect(preparations.map((one) => [one.title, one.stacks.map((stack) => stack.path)])).toEqual([
      ["charts/zz-base", ["shop"]],
      ["charts/web", ["shop", "worker"]],
      ["charts/worker", ["worker"]],
      ["charts/shop", ["shop"]],
    ]);
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

    test(`${version}: a subchart of a subchart is built first, and the diff holds its objects`, async () => {
      const { run, runs } = replay(version, "dependencies-nested");
      for (const build of helm.prepare?.([WORKER_NESTED]) ?? []) {
        expect((await build.run({ ...context(run), timeoutMinutes: 4 })).ok).toBe(true);
      }
      expect(runs.map((one) => one.cwd)).toEqual([`${ROOT}/charts/web`, `${ROOT}/charts/worker`]);
      const result = await helm.preview(WORKER_NESTED, { ...context(run), timeoutMinutes: 4 });
      expect(result.ok && result.diff.changes.map((change) => change.name)).toContain(
        "worker-base",
      );
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
        "helm version --template={{.Version}}",
        "helm upgrade web",
      ]);
      // Helm 4 renamed --atomic, and Helm 3 knows only the old name.
      expect(runs.at(-1)?.argv).toEqual([
        "helm",
        "upgrade",
        "web",
        "../charts/web",
        "--namespace=sluiceway-web",
        "--install",
        "--reset-values",
        version.startsWith("v4.") ? "--rollback-on-failure" : "--atomic",
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

    test(`${version}: a deploy that repairs drift puts it back, forcing conflicts only where Helm 4 applies server-side`, async () => {
      const { run, runs, plan } = await freshPreview(version, "drift-repaired");
      // apply checks the drift again after its fresh preview.
      const drift = await helm.detectDrift?.(WEB, { ...context(run), timeoutMinutes: 10 });
      expect(drift?.ok && drift.drift.length).toBe(2);
      const result = await helm.apply(WEB, context(run), plan, { repairDrift: true });
      expect(result.ok).toBe(true);
      const helm4 = version.startsWith("v4.");
      expect(runs.slice(4).map((one) => one.argv.slice(0, 3).join(" "))).toEqual([
        "helm template web",
        "helm version --template={{.Version}}",
        ...(helm4 ? ["helm get metadata"] : []),
        "helm upgrade web",
      ]);
      const deploy = runs.at(-1)?.argv ?? [];
      expect(deploy.includes("--force-conflicts")).toBe(helm4);
      if (helm4) {
        expect(runs.at(-2)?.argv).toEqual([
          "helm",
          "get",
          "metadata",
          "web",
          "--namespace=sluiceway-web",
          "--output=json",
        ]);
      }
      // The check after the deploy finds nothing.
      const after = await helm.detectDrift?.(WEB, { ...context(run), timeoutMinutes: 10 });
      expect(after).toMatchObject({ ok: true, drift: [] });
    });

    test(`${version}: createNamespace makes the namespace in the deploy, and the diff and the render work without it`, async () => {
      const replayed = replay(version, "create-namespace");
      const previewed = await helm.preview(WEB_NEW_NAMESPACE, {
        ...context(replayed.run),
        timeoutMinutes: 10,
        savePlan: true,
      });
      if (!previewed.ok || previewed.plan === undefined) throw new Error("expected a render");
      const result = await helm.apply(WEB_NEW_NAMESPACE, context(replayed.run), previewed.plan);
      expect(result.ok).toBe(true);
      const commands = replayed.runs.map((one) => one.argv);
      expect(commands.at(-1)).toContain("--create-namespace");
      expect(commands.slice(0, -1).some((argv) => argv.includes("--create-namespace"))).toBe(false);
    });
  }

  test("a release Helm 4 applies client-side gets no --force-conflicts, which it would refuse", async () => {
    const [, version = ""] = VERSIONS;
    const { plan } = await freshPreview(version, "deploy");
    const rendered = recorded(version, "deploy", "render");
    const { run, runs } = answering(
      exited(rendered),
      exited("v4.3.0"),
      exited('{"name":"web","applyMethod":"csa"}'),
      exited("STATUS: deployed"),
    );
    const result = await helm.apply(WEB, context(run), plan, { repairDrift: true });
    expect(result.ok).toBe(true);
    expect(runs.at(-1)?.argv).not.toContain("--force-conflicts");
    expect(runs.at(-1)?.argv).toContain("--rollback-on-failure");
  });

  test("Helm 3 applies client-side with a three-way merge that puts drift back by itself", async () => {
    const [version = ""] = VERSIONS;
    const { plan } = await freshPreview(version, "deploy");
    const rendered = recorded(version, "deploy", "render");
    const { run, runs } = answering(exited(rendered), exited("v3.18.0"), exited("deployed"));
    const result = await helm.apply(WEB, context(run), plan, { repairDrift: true });
    expect(result.ok).toBe(true);
    expect(runs.map((one) => one.argv[1])).toEqual(["template", "version", "upgrade"]);
    expect(runs.at(-1)?.argv).toContain("--atomic");
  });

  test("a version the deploy cannot read deploys nothing", async () => {
    const [version = ""] = VERSIONS;
    const { plan } = await freshPreview(version, "deploy");
    const rendered = recorded(version, "deploy", "render");
    const { run, runs } = answering(exited(rendered), exited("", 1, "Error: boom"));
    const result = await helm.apply(WEB, context(run), plan);
    expect(result).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: 1 },
      toolLog: "Error: boom",
    });
    expect(runs).toHaveLength(2);
  });

  test("metadata that fails deploys nothing", async () => {
    const [, version = ""] = VERSIONS;
    const { plan } = await freshPreview(version, "deploy");
    const rendered = recorded(version, "deploy", "render");
    const { run, runs } = answering(
      exited(rendered),
      exited("v4.3.0"),
      exited("", 1, "Error: release: not found"),
    );
    const result = await helm.apply(WEB, context(run), plan, { repairDrift: true });
    expect(result).toMatchObject({ ok: false, reason: { kind: "tool-error", exitCode: 1 } });
    expect(runs.some((one) => one.argv[1] === "upgrade")).toBe(false);
  });

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
