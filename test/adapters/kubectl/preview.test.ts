import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { kubectl } from "../../../src/adapters/kubectl/index.ts";
import type { Change } from "../../../src/core/diff.ts";
import { answering, FIXTURES, ROOT, replay, VERSIONS } from "./replay.ts";
import { CACHE, WEB } from "./stacks.ts";

// The Kubernetes manifests preview (record 0060): the rendered set in a
// directory of its own, `kubectl diff --server-side` of it with a diff program
// that prints every object whole, and the diff from comparing both sides.
// Every expected diff here is worked out by hand from what the scenario
// changes, not from the adapter.

async function previewOf(
  version: string,
  scenario: string,
  stack = WEB,
  extra: { showValues?: string[]; savePlan?: boolean } = {},
): Promise<PreviewResult & { sets: { path: string; text: string }[] }> {
  const { run, sets } = replay(version, scenario);
  const result = await kubectl.preview(stack, {
    root: ROOT,
    env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_secret", KUBECONFIG: "/kube/config" },
    run,
    timeoutMinutes: 10,
    ...extra,
  });
  return { ...result, sets };
}

function changes(result: PreviewResult): Change[] {
  if (!result.ok) throw new Error(`The preview failed: ${JSON.stringify(result.reason)}`);
  return result.diff.changes;
}

const NS = "sluiceway-example";

const change = (
  type: string,
  group: string,
  name: string,
  op: Change["op"],
  changedKeys: string[] = [],
): Change => ({
  address: `${group === "" ? type : `${type}.${group}`}/${NS}/${name}`,
  type,
  name: `${NS}/${name}`,
  op,
  changedKeys,
  replaceKeys: [],
});

const WEB_CREATES = [
  change("ConfigMap", "", "web-settings", "create"),
  change("Deployment", "apps", "web", "create"),
  change("Secret", "", "web-credentials", "create"),
  change("Service", "", "web", "create"),
];

for (const version of VERSIONS) {
  describe(`kubectl ${version}: every op as the diff gives it`, () => {
    test("a new stack is all creates, and creates list no keys", async () => {
      const result = await previewOf(version, "new-stack");
      expect(changes(result)).toEqual(WEB_CREATES);
      if (result.ok) expect(result.diff.stackId).toBe("web");
    });

    test("a kustomization is rendered by kustomize and diffed the same way", async () => {
      const result = await previewOf(version, "new-stack", CACHE);
      expect(changes(result)).toEqual([
        change("Deployment", "apps", "cache", "create"),
        change("Service", "", "cache", "create"),
      ]);
    });

    test("nothing changed: exit code 0 and no change", async () => {
      expect(changes(await previewOf(version, "no-changes"))).toEqual([]);
    });

    test("an update names the changed paths, and what the server sets itself is left out", async () => {
      expect(changes(await previewOf(version, "update"))).toEqual([
        change("ConfigMap", "", "web-settings", "update", ["data.greeting"]),
        change("Deployment", "apps", "web", "update", [
          "spec.replicas",
          "spec.template.spec.containers[0].image",
        ]),
        change("Service", "", "web", "update", ["spec.ports[0].targetPort"]),
      ]);
    });

    test("an update of a kustomization", async () => {
      expect(changes(await previewOf(version, "kustomize-update", CACHE))).toEqual([
        change("Deployment", "apps", "cache", "update", ["spec.replicas"]),
      ]);
    });

    test("a changed Secret is a change of its data, and no key inside it", async () => {
      expect(changes(await previewOf(version, "changed-secret"))).toEqual([
        change("Secret", "", "web-credentials", "update", ["data"]),
      ]);
    });

    test("a create next to an update", async () => {
      expect(changes(await previewOf(version, "mixed"))).toEqual([
        change("ConfigMap", "", "web-extra", "create"),
        change("Deployment", "apps", "web", "update", ["spec.replicas"]),
      ]);
    });

    test("an object taken out of the manifests is no change: kubectl does not prune", async () => {
      expect(changes(await previewOf(version, "removed-object"))).toEqual([]);
    });

    test("the same preview twice gives the same diff", async () => {
      const { run } = replay(version, "same-diff-twice");
      const options = { root: ROOT, env: {}, run, timeoutMinutes: 10 };
      const first = await kubectl.preview(WEB, options);
      const second = await kubectl.preview(WEB, options);
      expect(changes(second)).toEqual(changes(first));
      expect(changes(first)).toHaveLength(2);
    });
  });

  describe(`kubectl ${version}: what fails a preview`, () => {
    for (const scenario of [
      "immutable-field",
      "conflict",
      "invalid-manifest",
      "missing-namespace",
    ]) {
      test(`${scenario}: the tool exited with an error, and its words go to the job log`, async () => {
        const result = await previewOf(version, scenario);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toEqual({ kind: "tool-error", exitCode: 2 });
        const stderr = readFileSync(join(FIXTURES, version, scenario, "diff.stderr"), "utf8");
        expect(result.toolLog).toBe(stderr);
      });
    }

    test("a kustomization that does not build fails before any diff", async () => {
      const { run, runs } = replay(version, "kustomize-error");
      const result = await kubectl.preview(CACHE, { root: ROOT, env: {}, run, timeoutMinutes: 10 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toEqual({ kind: "tool-error", exitCode: 1 });
      expect(runs.map((asked) => asked.argv[1])).toEqual(["kustomize"]);
    });
  });

  describe(`kubectl ${version}: the command lines`, () => {
    test("the diff runs in the stack's directory with the namespace, over the rendered set", async () => {
      const { run, runs, sets } = replay(version, "update");
      await kubectl.preview(WEB, { root: ROOT, env: { KUBECONFIG: "/k" }, run, timeoutMinutes: 7 });
      const [diff] = runs;
      expect(diff?.argv.slice(0, 4)).toEqual([
        "kubectl",
        "diff",
        "--server-side",
        "--namespace=sluiceway-example",
      ]);
      expect(diff?.cwd).toBe(join(ROOT, "web"));
      expect(diff?.timeoutMs).toBe(7 * 60_000);
      // The job's environment, with the diff program the adapter reads.
      expect(diff?.env.KUBECONFIG).toBe("/k");
      expect(diff?.env.KUBECTL_EXTERNAL_DIFF).toBe("diff -N -U1000000");
      // The manifests of the directory, in name order.
      const read = (file: string) => readFileSync(join(ROOT, "web", file), "utf8");
      expect(sets[0]?.text).toBe(
        [read("configmap.yaml"), read("deployment.yaml"), read("secret.yaml"), read("service.json")]
          .map((text) => (text.endsWith("\n") ? text : `${text}\n`))
          .join("---\n"),
      );
    });

    test("the INPUT_* variables never reach the tool", async () => {
      const { run, runs } = replay(version, "no-changes");
      await kubectl.preview(WEB, {
        root: ROOT,
        env: { INPUT_GITHUB_TOKEN: "ghs_secret", PATH: "/usr/bin" },
        run,
        timeoutMinutes: 10,
      });
      expect(runs[0]?.env.INPUT_GITHUB_TOKEN).toBeUndefined();
      expect(runs[0]?.env.PATH).toBe("/usr/bin");
    });

    test("a context is passed to kustomize's neighbours, not to kustomize", async () => {
      const { run, runs } = answering(
        { status: "exited", exitCode: 0, stdout: "kind: A\n", stderr: "" },
        { status: "exited", exitCode: 0, stdout: "", stderr: "" },
      );
      const stack = { path: "cache", options: { tool: "kubectl", context: "prod" } };
      await kubectl.preview(stack, { root: ROOT, env: {}, run, timeoutMinutes: 10 });
      expect(runs.map((asked) => asked.argv.slice(0, 4))).toEqual([
        ["kubectl", "kustomize", "."],
        ["kubectl", "diff", "--server-side", "--context=prod"],
      ]);
    });
  });

  describe(`kubectl ${version}: the rendered set`, () => {
    test("goes when the preview ends", async () => {
      const result = await previewOf(version, "update");
      expect(result.sets).toHaveLength(1);
      expect(existsSync(dirname(result.sets[0]?.path ?? "/"))).toBe(false);
    });

    test("is kept when apply asks, and goes when apply lets it go", async () => {
      const result = await previewOf(version, "update", WEB, { savePlan: true });
      expect(result.ok && result.plan !== undefined).toBe(true);
      const path = result.sets[0]?.path ?? "/";
      expect(existsSync(path)).toBe(true);
      if (result.ok) await result.plan?.dispose();
      expect(existsSync(dirname(path))).toBe(false);
    });

    test("is not kept for a preview that failed", async () => {
      const result = await previewOf(version, "conflict", WEB, { savePlan: true });
      expect(result.ok).toBe(false);
      expect(existsSync(dirname(result.sets[0]?.path ?? "/"))).toBe(false);
    });
  });
}

describe("what no recording holds", () => {
  test("a diff that ran out of time", async () => {
    const { run } = answering({ status: "timed-out", stdout: "", stderr: "slow\n" });
    const result = await kubectl.preview(WEB, { root: ROOT, env: {}, run, timeoutMinutes: 3 });
    expect(result).toMatchObject({ ok: false, reason: { kind: "timed-out", minutes: 3 } });
    expect(result.toolLog).toBe("slow\n");
  });

  test("a kubectl that is not there", async () => {
    const { run } = answering({ status: "not-started" });
    const result = await kubectl.preview(WEB, { root: ROOT, env: {}, run, timeoutMinutes: 3 });
    expect(result).toMatchObject({ ok: false, reason: { kind: "tool-error", exitCode: null } });
  });

  test("exit code 1 with nothing to read is output Sluiceway cannot read, never in sync", async () => {
    const { run } = answering({ status: "exited", exitCode: 1, stdout: "", stderr: "" });
    const result = await kubectl.preview(WEB, { root: ROOT, env: {}, run, timeoutMinutes: 3 });
    expect(result).toMatchObject({ ok: false, reason: { kind: "unreadable-output" } });
  });

  test("a hunk that does not hold the whole object is refused, and the detail quotes nothing", async () => {
    const stdout = [
      "--- /tmp/LIVE-1/v1.ConfigMap.ns.a\t2026-09-22 10:00:00",
      "+++ /tmp/MERGED-1/v1.ConfigMap.ns.a\t2026-09-22 10:00:00",
      "@@ -3,2 +3,2 @@",
      "-  greeting: CANARY-VALUE, hello",
      "+  greeting: CANARY-VALUE, bye",
      "",
    ].join("\n");
    const { run } = answering({ status: "exited", exitCode: 1, stdout, stderr: "" });
    const result = await kubectl.preview(WEB, { root: ROOT, env: {}, run, timeoutMinutes: 3 });
    expect(result).toMatchObject({ ok: false, reason: { kind: "unreadable-output" } });
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });
});
