import { describe, expect, test } from "bun:test";
import { ToolVersionError } from "../../../src/adapters/adapter.ts";
import { opentofu } from "../../../src/adapters/opentofu/index.ts";
import { answering, ROOT, replay, VERSIONS } from "./replay.ts";
import { DEV, DNS, PROD } from "./stacks.ts";

// Everything of the OpenTofu adapter around the preview (record 0053): the
// version check, the init that runs before the pool, the deploy of exactly
// the saved plan, and the tool's own diff.

const context = (run: Parameters<typeof opentofu.checkVersion>[0]["run"]) => ({
  root: ROOT,
  env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_secret" },
  run,
});

const printing = (stdout: string) =>
  answering({ status: "exited", exitCode: 0, stdout, stderr: "" });

describe("the version check", () => {
  for (const version of VERSIONS) {
    test(`${version} is new enough`, async () => {
      const { run, runs } = replay(version, "version");
      await opentofu.checkVersion(context(run), [DEV]);
      expect(runs[0]?.argv).toEqual(["tofu", "version", "-json"]);
      expect(runs[0]?.env.INPUT_GITHUB_TOKEN).toBeUndefined();
    });
  }

  test("an older tofu is one clear error that names both versions and the fix", async () => {
    const { run } = printing('{"terraform_version":"1.10.9"}');
    await expect(opentofu.checkVersion(context(run), [DEV])).rejects.toThrow(
      new ToolVersionError(
        "Found tofu v1.10.9. Sluiceway needs tofu v1.11.0 or newer. Change the workflow step that installs tofu so it installs a newer version.",
      ),
    );
  });

  test("a pre-release of a newer version counts", async () => {
    const { run } = printing('{"terraform_version":"1.13.0-rc1"}');
    await opentofu.checkVersion(context(run), [DEV]);
  });

  test("a tofu that is not there", async () => {
    const { run } = answering({ status: "not-started" });
    await expect(opentofu.checkVersion(context(run), [DEV])).rejects.toThrow(
      "Could not start tofu. Sluiceway needs tofu v1.11.0 or newer on PATH and does not install it. Add a workflow step that installs tofu before the step that runs Sluiceway.",
    );
  });

  test("output that is not a version keeps the tool's words for the job log", async () => {
    const { run } = printing("Terraform v1.5.7\n");
    const error = await opentofu.checkVersion(context(run), [DEV]).catch((thrown) => thrown);
    expect(error).toBeInstanceOf(ToolVersionError);
    expect((error as ToolVersionError).message).toBe(
      '"tofu version -json" did not print a version Sluiceway can read. Sluiceway needs tofu v1.11.0 or newer. The job log holds what the tool printed.',
    );
    expect((error as ToolVersionError).toolLog).toBe("Terraform v1.5.7\n");
  });
});

describe("init before the pool", () => {
  test("one init per directory, in path order, for every stack in it", () => {
    const preparations = opentofu.prepare?.([PROD, DNS, DEV]) ?? [];
    expect(
      preparations.map((one) => [one.title, one.stacks.map((stack) => stack.name ?? "")]),
    ).toEqual([
      ["dns", [""]],
      ["network", ["prod", "dev"]],
    ]);
  });

  for (const version of VERSIONS) {
    test(`${version}: init runs in the directory, in no workspace of its stacks`, async () => {
      const { run, runs } = replay(version, "new-stack");
      const [network] = opentofu.prepare?.([DEV]) ?? [];
      const result = await network?.run({ ...context(run), timeoutMinutes: 4 });
      expect(result?.ok).toBe(true);
      expect(runs[0]?.argv).toEqual(["tofu", "init", "-input=false", "-no-color"]);
      expect(runs[0]?.cwd).toBe(`${ROOT}/network`);
      expect(runs[0]?.env.TF_WORKSPACE).toBeUndefined();
      expect(runs[0]?.timeoutMs).toBe(4 * 60_000);
      expect(result?.toolLog).toContain("OpenTofu has been successfully initialized!");
    });

    test(`${version}: a failed init is a tool error with the tool's words`, async () => {
      const { run } = replay(version, "init-failed");
      const [network] = opentofu.prepare?.([DEV]) ?? [];
      const result = await network?.run({ ...context(run), timeoutMinutes: 4 });
      expect(result?.ok).toBe(false);
      if (result?.ok !== false) return;
      expect(result.reason).toEqual({ kind: "tool-error", exitCode: 1 });
      expect(result.toolLog).toContain("99.0.0");
    });
  }

  test("an init that runs out of time", async () => {
    const { run } = answering({ status: "timed-out", stdout: "", stderr: "" });
    const [network] = opentofu.prepare?.([DEV]) ?? [];
    const result = await network?.run({ ...context(run), timeoutMinutes: 4 });
    expect(result?.ok ? undefined : result?.reason).toEqual({ kind: "timed-out", minutes: 4 });
  });
});

for (const version of VERSIONS) {
  describe(`tofu ${version}: the deploy of a saved plan`, () => {
    async function planned(scenario: string) {
      const replayed = replay(version, scenario);
      const result = await opentofu.preview(DEV, {
        ...context(replayed.run),
        timeoutMinutes: 10,
        savePlan: true,
      });
      if (!result.ok || result.plan === undefined) throw new Error("Expected a saved plan.");
      return { ...replayed, plan: result.plan };
    }

    test("deploys exactly the plan file the preview wrote, with no time limit", async () => {
      const { run, runs, plans, plan } = await planned("deploy");
      const result = await opentofu.apply(DEV, context(run), plan);
      await plan.dispose();
      expect(result).toMatchObject({ ok: true });
      const deploy = runs.at(-1);
      expect(deploy?.argv.slice(0, -1)).toEqual([
        "tofu",
        "apply",
        "-input=false",
        "-no-color",
        "-json",
      ]);
      expect(plans.at(-1)).toBe(plans[0] as string);
      expect(deploy?.env.TF_WORKSPACE).toBe("dev");
      expect(deploy?.timeoutMs).toBeUndefined();
      // Progress for the job log, never the outputs (record 0021).
      expect(result.toolLog).toContain("Apply complete!");
      expect(result.toolLog).not.toContain("Outputs:");
    });

    test("a deploy that fails is a tool error", async () => {
      const { run, plan } = await planned("deploy-failed");
      const result = await opentofu.apply(DEV, context(run), plan);
      await plan.dispose();
      expect(result.ok ? undefined : result.reason).toEqual({ kind: "tool-error", exitCode: 1 });
    });

    test("a plan the state moved away from is refused by the tool, and nothing is deployed", async () => {
      const { run, plan } = await planned("stale-plan");
      const result = await opentofu.apply(DEV, context(run), plan);
      await plan.dispose();
      expect(result.ok ? undefined : result.reason).toEqual({ kind: "tool-error", exitCode: 1 });
      expect(result.toolLog).toContain("Saved plan is stale");
    });

    test("the tool's own diff shows what the tool holds as sensitive as such", async () => {
      const { run, runs } = replay(version, "log-diff-changed-secret");
      const result = await opentofu.toolDiff(DEV, { ...context(run), timeoutMinutes: 5 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(runs[0]?.argv).toEqual([
        "tofu",
        "plan",
        "-input=false",
        "-no-color",
        "-refresh=false",
        "-var-file=dev.tfvars",
      ]);
      expect(runs[0]?.timeoutMs).toBe(5 * 60_000);
      expect(result.text).toContain('"secret" = (sensitive value)');
    });
  });
}

describe("a deploy without a saved plan", () => {
  test("is refused: an OpenTofu stack deploys only the plan that was hashed", async () => {
    const { run, runs } = answering({ status: "exited", exitCode: 0, stdout: "", stderr: "" });
    await expect(opentofu.apply(DEV, context(run))).rejects.toThrow(
      "An OpenTofu stack deploys only the plan its fresh preview saved.",
    );
    expect(runs).toEqual([]);
  });
});
