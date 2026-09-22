import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { kubectl } from "../../../src/adapters/kubectl/index.ts";
import { inventoryName, stubs } from "../../../src/adapters/kubectl/inventory.ts";
import { RenderedSet } from "../../../src/adapters/kubectl/rendered-set.ts";
import type { Change } from "../../../src/core/diff.ts";
import { exampleFor, PART_2, runFlow, type Step } from "./part2.ts";
import { answering, FIXTURES, ROOT, replay, VERSIONS } from "./replay.ts";
import { PRUNED_WEB, WEB } from "./stacks.ts";

// Kubernetes manifests part 2 (record 0070), against what kubectl printed on
// a kind cluster: pruning through the stack's inventory, the drift check,
// manifests in subdirectories, and forceConflicts with a field manager of the
// stack's own. Every expected diff is worked out by hand from what the
// scenario did, not from the adapter.

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

function previews(steps: Step[]): PreviewResult[] {
  return steps.flatMap((step) => (step.kind === "preview" ? [step.result] : []));
}

function changes(result: PreviewResult | undefined): Change[] {
  if (result === undefined || !result.ok) {
    throw new Error(`The preview failed: ${JSON.stringify(result)}`);
  }
  return result.diff.changes;
}

const fixture = (version: string, scenario: string, file: string) =>
  readFileSync(join(FIXTURES, version, scenario, file), "utf8");

for (const version of VERSIONS) {
  describe(`kubectl ${version}: pruning`, () => {
    test("before the first deploy there is no inventory, and the inventory itself is never a change", async () => {
      const { steps, replay } = await runFlow(version, "prune-first");
      expect(changes(previews(steps)[0])).toEqual(WEB_CREATES);
      expect(replay.runs.map((run) => run.argv.slice(0, 3))).toEqual([
        ["kubectl", "get", "configmap"],
        ["kubectl", "diff", "--server-side"],
      ]);
      // The set is the manifests, then the inventory that lists all four.
      const set = replay.sets[0]?.text ?? "";
      expect(set.startsWith(readFileSync(join(ROOT, "web", "configmap.yaml"), "utf8"))).toBe(true);
      expect(set).toContain(
        `---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${inventoryName("web")}\n`,
      );
      expect(set).toContain(
        [
          "  objects: |",
          '    {"apiVersion":"apps/v1","kind":"Deployment","name":"web"}',
          '    {"apiVersion":"v1","kind":"ConfigMap","name":"web-settings"}',
          '    {"apiVersion":"v1","kind":"Secret","name":"web-credentials"}',
          '    {"apiVersion":"v1","kind":"Service","name":"web"}',
        ].join("\n"),
      );
    });

    test("an object taken out of the manifests is a delete on the row, and the deploy deletes it", async () => {
      const { steps, replay } = await runFlow(version, "prune");
      const [before, after] = previews(steps);
      expect(changes(before)).toEqual([change("ConfigMap", "", "web-settings", "delete")]);
      const applied = steps.find((step) => step.kind === "apply");
      expect(applied?.kind === "apply" && applied.result).toEqual({
        ok: true,
        toolLog:
          fixture(version, "prune", "apply.stdout") + fixture(version, "prune", "delete.stdout"),
      });
      expect(replay.runs.map((run) => run.argv[1])).toEqual([
        "get",
        "get",
        "diff",
        "apply",
        "delete",
        "get",
        "get",
        "diff",
      ]);
      // The deploy deletes exactly the object the row showed, by the name
      // and namespace the cluster gave it.
      const deleted = replay.sets.find(
        (set, index) => set.path.endsWith("/prune.yaml") && index > 1,
      );
      expect(deleted?.text).toBe(
        'apiVersion: "v1"\nkind: "ConfigMap"\nmetadata:\n  name: "web-settings"\n  namespace: "sluiceway-example"\n',
      );
      // Until it is gone the inventory still lists it, so a pruning that
      // failed half way is done next time.
      expect(replay.sets[2]?.text).toContain(
        '{"apiVersion":"v1","kind":"ConfigMap","name":"web-settings"}',
      );
      // After the deploy only the inventory differs, and a stack whose only
      // difference is its inventory is in sync.
      expect(changes(after)).toEqual([]);
      expect(replay.sets.at(-1)?.text).not.toContain('"name":"web-settings"');
      for (const set of replay.sets) expect(existsSync(dirname(set.path))).toBe(false);
    });

    test("a prune file that changed after the preview is refused, and nothing is deployed", async () => {
      const flow = PART_2.prune;
      if (flow === undefined) throw new Error("no flow");
      const { root, done } = exampleFor(flow);
      try {
        const { run, runs } = replay(version, "prune", root);
        const options = { root, env: {}, run, timeoutMinutes: 10 };
        const previewed = await kubectl.preview(PRUNED_WEB, { ...options, savePlan: true });
        if (!previewed.ok || !(previewed.plan instanceof RenderedSet)) {
          throw new Error("expected a kept set");
        }
        const plan = previewed.plan;
        writeFileSync(
          plan.prunePath ?? "",
          stubs([{ apiVersion: "v1", kind: "Namespace", name: NS }]),
        );
        await expect(kubectl.apply(PRUNED_WEB, options, plan)).rejects.toThrow(
          "The rendered set of web changed after its preview. Nothing was deployed.",
        );
        expect(runs.map((one) => one.argv[1])).toEqual(["get", "get", "diff"]);
        await plan.dispose();
      } finally {
        done();
      }
    });
  });

  describe(`kubectl ${version}: the drift check`, () => {
    test("an object the stack deployed and someone deleted is drift, and the row's create puts it back", async () => {
      const { steps } = await runFlow(version, "drift-deleted");
      expect(changes(previews(steps)[0])).toEqual([
        change("ConfigMap", "", "web-settings", "create"),
      ]);
      const drift = steps.find((step) => step.kind === "drift");
      expect(drift?.kind === "drift" && drift.result).toEqual({
        ok: true,
        drift: [change("ConfigMap", "", "web-settings", "delete")],
        toolLog:
          fixture(version, "drift-deleted", "inventory-drift.stderr") +
          fixture(version, "drift-deleted", "drift.stderr"),
      });
    });

    test("fields someone else changed are drift, and forceConflicts takes them back", async () => {
      const { steps, replay } = await runFlow(version, "drift-changed");
      const [before, after] = previews(steps);
      const scaled = change("Deployment", "apps", "web", "update", ["spec.replicas"]);
      const patched = change("ConfigMap", "", "web-settings", "update", ['data["log-level"]']);
      expect(changes(before)).toEqual([patched, scaled]);
      const drift = steps.find((step) => step.kind === "drift");
      expect(drift?.kind === "drift" && drift.result).toEqual({
        ok: true,
        drift: [patched, scaled],
        toolLog: fixture(version, "drift-changed", "drift.stderr"),
      });
      expect(steps.find((step) => step.kind === "apply")).toMatchObject({
        result: { ok: true },
      });
      expect(changes(after)).toEqual([]);
      for (const run of replay.runs.filter((one) => one.argv[1] !== "get")) {
        expect(run.argv).toContain("--force-conflicts");
        expect(run.argv).toContain("--field-manager=sluiceway-web");
      }
    });

    test("without forceConflicts a field someone else took fails the preview, as the deploy would fail", async () => {
      const [result] = previews((await runFlow(version, "drift-conflict")).steps);
      expect(result).toMatchObject({ ok: false, reason: { kind: "tool-error", exitCode: 2 } });
    });

    test("a stack with neither pruning nor forceConflicts has no drift check", async () => {
      const { run, runs } = answering({ status: "exited", exitCode: 0, stdout: "", stderr: "" });
      const found = await kubectl.detectDrift?.(WEB, {
        root: ROOT,
        env: {},
        run,
        timeoutMinutes: 10,
      });
      expect(found).toBeUndefined();
      expect(runs).toEqual([]);
    });
  });

  describe(`kubectl ${version}: recursive`, () => {
    test("a manifest in a subdirectory is part of the set", async () => {
      const { steps, replay } = await runFlow(version, "recursive");
      expect(changes(previews(steps)[0])).toEqual([
        change("ConfigMap", "", "web-more", "create"),
        ...WEB_CREATES,
      ]);
      expect(replay.sets[0]?.text).toContain("name: web-more");
    });
  });
}

describe("what pruning cannot read", () => {
  const options = (run: Parameters<typeof kubectl.preview>[1]["run"]) => ({
    root: ROOT,
    env: {},
    run,
    timeoutMinutes: 10,
  });

  test("an inventory that is not one fails the preview, and says where, never what", async () => {
    const { run, runs } = answering({
      status: "exited",
      exitCode: 0,
      stdout: '{"kind":"ConfigMap","data":{"objects":"CANARY-VALUE\\n"}}',
      stderr: "",
    });
    expect(await kubectl.preview(PRUNED_WEB, options(run))).toEqual({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: ["The stack's inventory, at line 1: expected an object Sluiceway listed."],
      toolLog: "",
    });
    expect(runs).toHaveLength(1);
  });

  test("a failed read of the inventory is the tool's error", async () => {
    const { run } = answering({
      status: "exited",
      exitCode: 1,
      stdout: "",
      stderr: "error: You must be logged in to the server\n",
    });
    expect(await kubectl.preview(PRUNED_WEB, options(run))).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: 1 },
      detail: [],
      toolLog: "error: You must be logged in to the server\n",
    });
  });

  test("a delete that fails fails the deploy, after the set went out", async () => {
    const flow = PART_2.prune;
    if (flow === undefined) throw new Error("no flow");
    const { root, done } = exampleFor(flow);
    try {
      const version = VERSIONS[0] ?? "";
      const recorded = replay(version, "prune", root);
      const previewed = await kubectl.preview(PRUNED_WEB, {
        ...options(recorded.run),
        root,
        savePlan: true,
      });
      if (!previewed.ok || previewed.plan === undefined) throw new Error("expected a kept set");
      const { run, runs } = answering(
        { status: "exited", exitCode: 0, stdout: "configmap/x serverside-applied\n", stderr: "" },
        { status: "exited", exitCode: 1, stdout: "", stderr: "forbidden\n" },
      );
      expect(await kubectl.apply(PRUNED_WEB, { root, env: {}, run }, previewed.plan)).toEqual({
        ok: false,
        reason: { kind: "tool-error", exitCode: 1 },
        toolLog: "configmap/x serverside-applied\nforbidden\n",
      });
      expect(runs.map((one) => one.argv[1])).toEqual(["apply", "delete"]);
      expect(runs[1]?.timeoutMs).toBeUndefined();
      await previewed.plan.dispose();
    } finally {
      done();
    }
  });
});
