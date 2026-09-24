import { describe, expect, test } from "bun:test";
import { CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import type { Change } from "../../../src/core/diff.ts";
import { diffHash } from "../../../src/core/diff-hash.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { type Replay, ROOT, replay, VERSIONS } from "./replay.ts";

// The value fingerprint of a Pulumi change (record 0102). Each expected
// fingerprint was written by hand from the values the recording holds at the
// changed paths, in the shapes of the record, and hashed outside this code
// base with shasum, so the test knows what is hashed and not only that
// something is.

const K8S: Stack = { path: "generated/nested", name: "dev", options: {} };
const SITE: Stack = { path: "site", name: "prod", options: {} };
const NETWORK_DEV: Stack = { path: "network", name: "dev", options: {} };

const IMAGE = "spec.template.spec.containers[0].image";

function previewWith(
  stack: Stack,
  { run }: Replay,
  options: { showValues?: string[]; valueFingerprint?: boolean } = {},
): Promise<PreviewResult> {
  return pulumi.preview(stack, { root: ROOT, env: {}, run, timeoutMinutes: 10, ...options });
}

function changes(result: PreviewResult): Change[] {
  if (!result.ok) throw new Error("expected a diff");
  return result.diff.changes;
}

function byName(result: PreviewResult, name: string): Change | undefined {
  return changes(result).find((change) => change.name === name);
}

for (const version of VERSIONS) {
  describe(`the value fingerprint, replaying pulumi ${version}`, () => {
    test("an update hashes the old and new value at every changed path, in the shapes of record 0102", async () => {
      const result = await previewWith(K8S, replay(version, "nested-paths"), {
        valueFingerprint: true,
      });
      // [{"new":"2","old":"1","path":"metadata.annotations[\"example.com/revision\"]"},
      //  {"new":"CANARY-VALUE-2","old":"CANARY-VALUE","path":"spec.template.spec.containers[0].env[0].value"},
      //  {"new":"nginx:1.28","old":"nginx:1.27","path":"spec.template.spec.containers[0].image"}]
      expect(byName(result, "web")?.fingerprint).toBe("292640d30007b2e7");
      // A replace, one changed path:
      // [{"new":"CANARY-VALUE-3","old":"CANARY-VALUE","path":"data[\"app.properties\"]"}]
      expect(byName(result, "settings")?.fingerprint).toBe("8150ee7aeae1c868");
      expect(JSON.stringify(result)).not.toContain(CANARY_VALUE);
    });

    test("a listed path is left out: the diff hash covers it already", async () => {
      const result = await previewWith(K8S, replay(version, "nested-paths"), {
        showValues: [IMAGE],
        valueFingerprint: true,
      });
      // The two entries of the update without the image.
      expect(byName(result, "web")?.fingerprint).toBe("cf17bed8785bdcf8");
      expect(byName(result, "web")?.values).toEqual([
        { path: IMAGE, old: "nginx:1.27", new: "nginx:1.28" },
      ]);
    });

    test("a value the tool marks secret enters as its mark and never in the clear", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "changed-secret"), {
        valueFingerprint: true,
      });
      // [{"path":"environment.TOKEN","secret":true}]
      expect(byName(result, "banner")?.fingerprint).toBe("628c417383a27c34");
    });

    test("a create hashes every leaf of the new object", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "new-stack"), {
        valueFingerprint: true,
      });
      // [{"new":2,"path":"length"},{"new":"net","path":"prefix"}]
      expect(byName(result, "name")?.fingerprint).toBe("0f30abbbe3ef3394");
      expect(
        changes(result)
          .filter((change) => change.op === "create")
          .every((change) => change.fingerprint !== undefined),
      ).toBe(true);
    });

    test("without the option no change carries one, and the diff hash never changes with it", async () => {
      const without = await previewWith(K8S, replay(version, "nested-paths"));
      const off = await previewWith(K8S, replay(version, "nested-paths"), {
        valueFingerprint: false,
      });
      const on = await previewWith(K8S, replay(version, "nested-paths"), {
        valueFingerprint: true,
      });
      expect(without).toEqual(off);
      expect(changes(without).every((change) => change.fingerprint === undefined)).toBe(true);
      if (!on.ok || !without.ok) throw new Error("expected diffs");
      expect(diffHash(on.diff)).toBe(diffHash(without.diff));
    });

    test("the same recording twice gives the same fingerprints", async () => {
      const first = await previewWith(K8S, replay(version, "nested-paths"), {
        valueFingerprint: true,
      });
      const second = await previewWith(K8S, replay(version, "nested-paths"), {
        valueFingerprint: true,
      });
      expect(changes(first).map((change) => change.fingerprint)).toEqual(
        changes(second).map((change) => change.fingerprint),
      );
    });

    test("drift of a Pulumi stack carries the fingerprint of what the check read", async () => {
      const runner = replay(version, "drift-changed");
      const options = { root: ROOT, env: {}, run: runner.run, timeoutMinutes: 10 };
      await pulumi.preview(SITE, options);
      const drifted = await pulumi.detectDrift?.(SITE, { ...options, valueFingerprint: true });
      if (!drifted?.ok) throw new Error("expected drift");
      // [{"new":"CANARY-VALUE, edited by hand","old":"CANARY-VALUE","path":"text"}]
      expect(drifted.drift.map((change) => change.fingerprint)).toEqual(["64ea9c29a62ffb7f"]);
      expect(JSON.stringify(drifted.drift)).not.toContain(CANARY_VALUE);

      const again = replay(version, "drift-changed");
      await pulumi.preview(SITE, { ...options, run: again.run });
      const plain = await pulumi.detectDrift?.(SITE, { ...options, run: again.run });
      expect(plain?.ok && plain.drift.every((change) => change.fingerprint === undefined)).toBe(
        true,
      );
    });
  });
}
