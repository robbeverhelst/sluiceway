import { describe, expect, test } from "bun:test";
import type { Change, Diff } from "../../src/core/diff.ts";
import { diffHash } from "../../src/core/diff-hash.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { type DriftRow, type PendingRow, renderRow } from "../../src/render/row.ts";

// Record 0055: drift is shown on the stack's own row, never on a second row.
// A row with drift only has the state `drift` and a box. A pending row that
// also has drift stays pending and shows the drift under its changes. Both
// markers say that the hash covers drift.

const RUN = "https://github.com/acme/infra/actions/runs/7/attempts/1";

const gone: Change = {
  address: "urn:pulumi:prod::site::local:index/file:File::notes",
  type: "local:index/file:File",
  name: "notes",
  op: "delete",
  changedKeys: [],
  replaceKeys: [],
};
const changed: Change = {
  address: "urn:pulumi:prod::site::aws:s3/bucket:Bucket::assets",
  type: "aws:s3/bucket:Bucket",
  name: "assets",
  op: "update",
  changedKeys: ["tags.owner", "versioning.enabled"],
  replaceKeys: [],
};
const pet: Change = {
  address: "urn:pulumi:prod::site::random:index/randomPet:RandomPet::pet",
  type: "random:index/randomPet:RandomPet",
  name: "pet",
  op: "update",
  changedKeys: ["length"],
  replaceKeys: [],
};

function driftRow(extra: Partial<DriftRow> = {}): DriftRow {
  const diff: Diff = { stackId: "site:prod", changes: [], drift: [gone, changed] };
  return { state: "drift", diff, hash: diffHash(diff), runUrl: RUN, ...extra };
}

describe("a drift row", () => {
  test("has a box, the drift counts, a preview link that lands on the summary without a page, and every drift line in a fold", () => {
    expect(renderRow(driftRow())).toBe(
      [
        `- [ ] **site:prod** · 1 changed, 1 gone outside the code · [preview](${RUN}) <!-- sluiceway:row stack="site:prod" state="drift" hash="3503645c1819ce4f" drift="true" -->`,
        "  <details><summary>2 changes outside the code</summary>",
        "  <kbd>changed</kbd> <code>aws:s3/bucket:Bucket</code> <b>assets</b> · <code>tags.owner</code>, <code>versioning.enabled</code><br>",
        "  <kbd>gone</kbd> <code>local:index/file:File</code> <b>notes</b><br>",
        "  </details>",
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("keeps its tick, and carries the failure line and the orphan note like a pending row", () => {
    const text = renderRow(
      driftRow({
        ticked: true,
        orphanTick: false,
        failure: {
          reason: "the tool exited with an error",
          ticker: "alice",
          at: new Date("2026-09-22T08:00:00Z"),
          runUrl: "https://github.com/acme/infra/actions/runs/6",
        },
      }),
    );
    const [first = "", second] = text.split("\n");
    expect(first).toStartWith("- [x] **site:prod**");
    expect(first).toEndWith('drift="true" -->');
    expect(first).toContain('failed="true"');
    expect(second).toBe(
      "  :x: last deploy failed: the tool exited with an error · ticked by alice · 2026-09-22 08:00 UTC · [run](https://github.com/acme/infra/actions/runs/6)",
    );
  });

  test("redacted, it names no type, name or path, and keeps the counts", () => {
    expect(renderRow(driftRow(), { redact: true })).toBe(
      [
        `- [ ] **site:prod** · 1 changed, 1 gone outside the code · [preview](${RUN}) <!-- sluiceway:row stack="site:prod" state="drift" hash="3503645c1819ce4f" drift="true" -->`,
        `  Changes outside the code are listed in the [summary](${RUN})`,
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("shortened by the size budget, the fold becomes one line", () => {
    expect(renderRow(driftRow(), { level: 2 }).split("\n").slice(1)).toEqual([
      `  2 changes outside the code not listed here, see the [summary](${RUN})`,
      "  <!-- /sluiceway:row -->",
    ]);
    expect(renderRow(driftRow(), { level: 2 })).toContain('shortened="2" drift="true"');
  });

  test("read-only, it has no box", () => {
    expect(renderRow(driftRow(), { readOnly: true })).toStartWith("- **site:prod** · 1 changed");
  });

  test("reads back as a known drift row with its hash", () => {
    const row = driftRow({ ticked: true });
    expect(parseDashboard(renderRow(row)).rows[0]).toMatchObject({
      known: true,
      stackId: "site:prod",
      state: "drift",
      hash: row.hash,
      destroys: 0,
      drift: true,
      ticked: true,
    });
  });
});

describe("a pending row that also shows drift", () => {
  const diff: Diff = { stackId: "site:prod", changes: [pet], drift: [gone] };
  const row: PendingRow = { state: "pending", diff, hash: diffHash(diff), runUrl: RUN };

  test("stays pending, counts the drift on its first line, and lists it under its changes", () => {
    expect(renderRow(row)).toBe(
      [
        `- [ ] **site:prod** · 1 update · 1 gone outside the code · [preview](${RUN}) <!-- sluiceway:row stack="site:prod" state="pending" hash="e03c45e1b434d22b" drift="true" -->`,
        "  <details><summary>1 change</summary>",
        "  <kbd>update</kbd> <code>random:index/randomPet:RandomPet</code> <b>pet</b> · <code>length</code><br>",
        "  </details>",
        "  <details><summary>1 change outside the code</summary>",
        "  <kbd>gone</kbd> <code>local:index/file:File</code> <b>notes</b><br>",
        "  </details>",
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("a gone resource is not a destroy: a deploy creates it again", () => {
    expect(parseDashboard(renderRow(row)).rows[0]).toMatchObject({ destroys: 0, drift: true });
  });

  test("at level 3 both folds become lines, and the drift has its own", () => {
    expect(renderRow(row, { level: 3 }).split("\n").slice(1)).toEqual([
      `  Changes not listed here, see the [summary](${RUN})`,
      `  1 change outside the code not listed here, see the [summary](${RUN})`,
      "  <!-- /sluiceway:row -->",
    ]);
  });

  test("a pending row without drift has no drift key and no drift fold", () => {
    const plain: Diff = { stackId: "site:prod", changes: [pet] };
    const text = renderRow({ ...row, diff: plain, hash: diffHash(plain) });
    expect(text).not.toContain("outside the code");
    expect(text).not.toContain("drift=");
  });
});
