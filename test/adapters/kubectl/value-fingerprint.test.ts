import { describe, expect, test } from "bun:test";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { kubectl } from "../../../src/adapters/kubectl/index.ts";
import type { Change } from "../../../src/core/diff.ts";
import { diffHash } from "../../../src/core/diff-hash.ts";
import { ROOT, replay, VERSIONS } from "./replay.ts";
import { WEB } from "./stacks.ts";

// The value fingerprint of a Kubernetes manifests change (record 0102). Each
// expected fingerprint was written by hand from the live and merged objects
// the recorded diff prints, without the server's own fields, in the shapes of
// the record, and hashed outside this code base with shasum.

const NS = "sluiceway-example";

async function previewOf(
  version: string,
  scenario: string,
  extra: { showValues?: string[]; valueFingerprint?: boolean } = {},
): Promise<PreviewResult> {
  return kubectl.preview(WEB, {
    root: ROOT,
    env: { PATH: "/usr/bin", KUBECONFIG: "/kube/config" },
    run: replay(version, scenario).run,
    timeoutMinutes: 10,
    ...extra,
  });
}

function changes(result: PreviewResult): Change[] {
  if (!result.ok) throw new Error(`The preview failed: ${JSON.stringify(result.reason)}`);
  return result.diff.changes;
}

function at(result: PreviewResult, address: string): Change | undefined {
  return changes(result).find((change) => change.address === address);
}

for (const version of VERSIONS) {
  describe(`kubectl ${version}: the value fingerprint`, () => {
    test("an update hashes the leaves that differ, without the server's fields", async () => {
      const result = await previewOf(version, "update", { valueFingerprint: true });
      // [{"new":2,"old":1,"path":"spec.replicas"},
      //  {"new":"registry.k8s.io/pause:3.9","old":"registry.k8s.io/pause:3.10","path":"spec.template.spec.containers[0].image"}]
      expect(at(result, `Deployment.apps/${NS}/web`)?.fingerprint).toBe("566be2d1e5f8fc29");
    });

    test("a Secret's data enters as one mark", async () => {
      const result = await previewOf(version, "changed-secret", { valueFingerprint: true });
      // [{"path":"data","secret":true}]
      expect(at(result, `Secret/${NS}/web-credentials`)?.fingerprint).toBe("c0d4fa7be1d533cb");
      expect(JSON.stringify(result)).not.toContain("(after)");
    });

    test("a create hashes every leaf of the merged object", async () => {
      const result = await previewOf(version, "new-stack", { valueFingerprint: true });
      // apiVersion, data.greeting, data["log-level"], kind, the label, the name
      // and the namespace: creationTimestamp and uid are the server's.
      expect(at(result, `ConfigMap/${NS}/web-settings`)?.fingerprint).toBe("dbe8605786dd74a7");
      expect(changes(result).every((change) => change.fingerprint !== undefined)).toBe(true);
    });

    test("a listed path is left out, and without the option nothing carries one", async () => {
      const listed = await previewOf(version, "update", {
        showValues: ["spec.replicas"],
        valueFingerprint: true,
      });
      expect(at(listed, `Deployment.apps/${NS}/web`)?.values).toEqual([
        { path: "spec.replicas", old: "1", new: "2" },
      ]);
      expect(at(listed, `Deployment.apps/${NS}/web`)?.fingerprint).not.toBe("566be2d1e5f8fc29");

      const plain = await previewOf(version, "update");
      const off = await previewOf(version, "update", { valueFingerprint: false });
      expect(plain).toEqual(off);
      expect(changes(plain).every((change) => change.fingerprint === undefined)).toBe(true);
      const on = await previewOf(version, "update", { valueFingerprint: true });
      if (!on.ok || !plain.ok) throw new Error("expected diffs");
      expect(diffHash(on.diff)).toBe(diffHash(plain.diff));
    });
  });
}
