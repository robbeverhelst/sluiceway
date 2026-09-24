import { describe, expect, test } from "bun:test";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { helm } from "../../../src/adapters/helm/index.ts";
import type { Change } from "../../../src/core/diff.ts";
import { diffHash } from "../../../src/core/diff-hash.ts";
import { ROOT, replay, VERSIONS } from "./replay.ts";
import { WEB } from "./stacks.ts";

// The value fingerprint of a Helm change (record 0102). Each expected
// fingerprint was written by hand from `oldValue` and `newValue` of the
// changes the diff plugin recorded, in the shapes of the record, and hashed
// outside this code base with shasum. The plugin prints no manifest for an
// object it adds, so a Helm create carries none.

async function previewOf(
  version: string,
  scenario: string,
  extra: { showValues?: string[]; valueFingerprint?: boolean } = {},
): Promise<PreviewResult> {
  return helm.preview(WEB, {
    root: ROOT,
    env: { PATH: "/usr/bin" },
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
  describe(`helm ${version}: the value fingerprint`, () => {
    test("an update hashes the old and new value of every changed field", async () => {
      const result = await previewOf(version, "update", { valueFingerprint: true });
      // [{"new":"color=green","old":"color=blue","path":"data[\"app.properties\"]"},
      //  {"new":"1.0.1","old":"1.0.0","path":"metadata.labels[\"app.kubernetes.io/version\"]"}]
      expect(at(result, "ConfigMap/sluiceway-web/web-settings")?.fingerprint).toBe(
        "1511dbe55b90152a",
      );
      // [{"new":8080,"old":80,"path":"spec.ports[0].port"}]
      expect(at(result, "Service/sluiceway-web/web")?.fingerprint).toBe("86dd6b07d83b0dd8");
    });

    test("every field of a Secret enters as its mark: the plugin's stand-in tells its length", async () => {
      const result = await previewOf(version, "changed-secret", { valueFingerprint: true });
      // [{"path":"data.token","secret":true}]
      expect(at(result, "Secret/sluiceway-web/web-token")?.fingerprint).toBe("6369fc4275bd10d1");
      expect(JSON.stringify(result)).not.toContain("bytes");
    });

    test("an object the plugin adds carries none", async () => {
      const result = await previewOf(version, "new-stack", { valueFingerprint: true });
      expect(changes(result).length).toBeGreaterThan(0);
      expect(changes(result).every((change) => change.fingerprint === undefined)).toBe(true);
    });

    test("a listed path is left out, and without the option nothing carries one", async () => {
      const listed = await previewOf(version, "update", {
        showValues: ["spec.ports[0].port"],
        valueFingerprint: true,
      });
      expect(at(listed, "Service/sluiceway-web/web")?.values).toEqual([
        { path: "spec.ports[0].port", old: "80", new: "8080" },
      ]);
      expect(at(listed, "Service/sluiceway-web/web")?.fingerprint).toBeUndefined();

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
