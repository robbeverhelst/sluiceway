import { describe, expect, test } from "bun:test";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { opentofu } from "../../../src/adapters/opentofu/index.ts";
import type { Change } from "../../../src/core/diff.ts";
import { diffHash } from "../../../src/core/diff-hash.ts";
import { ROOT, replay, VERSIONS } from "./replay.ts";
import { DEV } from "./stacks.ts";

// The value fingerprint of an OpenTofu change (record 0102). Each expected
// fingerprint was written by hand from `before`, `after`, `before_sensitive`
// and `after_sensitive` of the recorded plan, in the shapes of the record,
// and hashed outside this code base with shasum. An attribute the plan
// marks unknown after the deploy has no new side, so its old side enters.

async function previewOf(
  version: string,
  scenario: string,
  extra: { showValues?: string[]; valueFingerprint?: boolean } = {},
): Promise<PreviewResult> {
  const { run } = replay(version, scenario);
  return opentofu.preview(DEV, {
    root: ROOT,
    env: { PATH: "/usr/bin" },
    run,
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
  describe(`tofu ${version}: the value fingerprint`, () => {
    test("an update hashes the leaves that differ, a sensitive one as its mark", async () => {
      const result = await previewOf(version, "update", { valueFingerprint: true });
      // [{"new":"hi","old":"hello","path":"input.greeting"},{"path":"input.secret","secret":true},
      //  {"old":"CANARY-VALUE","path":"output.canary"},{"old":"hello","path":"output.greeting"},
      //  {"old":"CANARY-SECRET","path":"output.secret"}]
      expect(at(result, "terraform_data.config")?.fingerprint).toBe("a73084eb49d7e233");
    });

    test("a changed secret enters as its mark and never in the clear", async () => {
      const result = await previewOf(version, "changed-secret", { valueFingerprint: true });
      // [{"path":"input.secret","secret":true},{"old":"CANARY-VALUE","path":"output.canary"},
      //  {"old":"hello","path":"output.greeting"},{"old":"CANARY-SECRET","path":"output.secret"}]
      expect(at(result, "terraform_data.config")?.fingerprint).toBe("9786ceffcd7ea48d");
      expect(JSON.stringify(result)).not.toContain("ROTATED");
    });

    test("a create hashes every leaf of the new object, and a sensitive one as its mark", async () => {
      const result = await previewOf(version, "new-stack", { valueFingerprint: true });
      // [{"new":2,"path":"length"},{"new":"dev","path":"prefix"},{"new":"-","path":"separator"}]
      expect(at(result, "random_pet.name")?.fingerprint).toBe("d5b267221c9c6cd6");
      // [{"path":"triggers.secret","secret":true}]
      expect(at(result, "null_resource.trigger")?.fingerprint).toBe("33af8ca038cf1697");
      expect(changes(result).every((change) => change.fingerprint !== undefined)).toBe(true);
    });

    test("a replace hashes both sides at every changed path", async () => {
      const result = await previewOf(version, "replace", { valueFingerprint: true });
      // content on both sides, the seven attributes unknown after the deploy on
      // their old side, and sensitive_content as its mark.
      expect(at(result, "local_file.notes")?.fingerprint).toBe("9093d33722fc4bab");
    });

    test("a listed path is left out, and without the option nothing carries one", async () => {
      const listed = await previewOf(version, "update", {
        showValues: ["input.greeting"],
        valueFingerprint: true,
      });
      expect(at(listed, "terraform_data.config")?.values).toEqual([
        { path: "input.greeting", old: "hello", new: "hi" },
      ]);
      expect(at(listed, "terraform_data.config")?.fingerprint).not.toBe("a73084eb49d7e233");
      expect(at(listed, "terraform_data.config")?.fingerprint).toMatch(/^[0-9a-f]{16}$/);

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
