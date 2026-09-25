import { describe, expect, test } from "bun:test";
import type { Change } from "../../src/core/diff.ts";
import type { PolicyOutcome } from "../../src/core/policy.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { type PendingRow, renderRow } from "../../src/render/row.ts";

// Slice 5.51 (record 0114): `dashboard.pendingDetail`. How much a pending row
// shows under its first line. The marker is the same at every setting, and no
// setting hides a delete or replace line or a failure line (records 0024 and
// 0027).

function change(op: Change["op"], type: string, name: string, rest: Partial<Change> = {}): Change {
  return { address: `${type}::${name}`, type, name, op, changedKeys: [], replaceKeys: [], ...rest };
}

const FIRST =
  '- [ ] **storage/buckets:prod** · 1 create, **1 replace**, **1 delete** · 1 changed outside the code · [preview](preview-url) <!-- sluiceway:row stack="storage/buckets:prod" state="pending" hash="2b44350653e84a11" destroys="2" deletes="1" failed="true" drift="true" creates="1" replaces="1" -->';
const MARKER = FIRST.slice(FIRST.indexOf(" <!--"));
const FAILURE =
  "  :x: last deploy failed: the tool exited with an error · ticked by carol · 2026-09-21 08:52 UTC · [run](failed-run)";
const DELETE =
  "  :warning: <kbd>DELETE</kbd> <code>aws:s3/bucketPolicy:BucketPolicy</code> <b>uploads-public-read</b>";
const REPLACE =
  "  :warning: <kbd>REPLACE</kbd> <code>aws:s3/bucket:Bucket</code> <b>uploads</b> · forced by <code>bucket</code>";
const ORPHAN = "  :information_source: a tick on this row was not picked up. Tick again to deploy.";

const ROW: PendingRow = {
  state: "pending",
  diff: {
    stackId: "storage/buckets:prod",
    changes: [
      change("create", "aws:s3/bucketVersioning:BucketVersioning", "uploads"),
      change("replace", "aws:s3/bucket:Bucket", "uploads", {
        changedKeys: ["bucket"],
        replaceKeys: ["bucket"],
      }),
      change("delete", "aws:s3/bucketPolicy:BucketPolicy", "uploads-public-read"),
    ],
    drift: [change("update", "aws:s3/bucket:Bucket", "logs", { changedKeys: ["acl"] })],
  },
  hash: "2b44350653e84a11",
  runUrl: "run-url",
  previewUrl: "preview-url",
  attribution: {
    full: "from #433 by alice · [compare](compare-url)",
    counted: "from 1 pull request · [compare](compare-url)",
    outside: [
      "<details><summary>1 change outside this stack</summary>",
      "#430 by bob<br>",
      "</details>",
    ],
  },
  failure: {
    reason: "the tool exited with an error",
    ticker: "carol",
    at: new Date("2026-09-21T08:52:00Z"),
    runUrl: "failed-run",
  },
  cost: { monthly: 31.2, currency: "USD" },
  pendingAgain: {},
  orphanTick: true,
};

describe("the default", () => {
  test("full, named or not, writes the row of today byte for byte", () => {
    expect(renderRow(ROW, { detail: "full" })).toBe(renderRow(ROW));
    expect(renderRow(ROW).split("\n")).toContain("  about **31.20 USD** more a month");
  });
});

describe("compact", () => {
  test("the first line, the failure line, the notes about the tick and every destroy", () => {
    expect(renderRow(ROW, { detail: "compact" })).toBe(
      [FIRST, FAILURE, ORPHAN, DELETE, REPLACE, "  <!-- /sluiceway:row -->"].join("\n"),
    );
  });

  test("a row with nothing but creates is its first line", () => {
    const row: PendingRow = {
      state: "pending",
      diff: { stackId: "a", changes: [change("create", "t", "n")] },
      hash: "00000000000000aa",
      runUrl: "run-url",
      attribution: { full: "from #1 by alice", counted: "from 1 pull request" },
    };
    expect(renderRow(row, { detail: "compact" })).toBe(
      [
        '- [ ] **a** · 1 create · [preview](run-url) <!-- sluiceway:row stack="a" state="pending" hash="00000000000000aa" creates="1" -->',
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });
});

describe("names", () => {
  test("the stack id and its counts, the failure line and every destroy", () => {
    expect(renderRow(ROW, { detail: "names" })).toBe(
      [
        `- [ ] **storage/buckets:prod** · 1 create, **1 replace**, **1 delete** · 1 changed outside the code${MARKER}`,
        FAILURE,
        DELETE,
        REPLACE,
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  // A row a policy stopped has no box, and says why at every setting.
  test("a row a policy stopped keeps the line that says why it has no box", () => {
    const failed: PolicyOutcome = {
      kind: "failed",
      report: {
        failures: [{ namespace: "main", message: "no public buckets" }],
        warnings: [],
        passed: 0,
        namespaces: ["main"],
      },
    };
    const lines = renderRow({ ...ROW, policies: failed }, { detail: "names" }).split("\n");
    expect(lines[0]?.startsWith("- **storage/buckets:prod**")).toBe(true);
    expect(lines).toContain(
      "  :no_entry: **1 policy failed**, so this change has no box until it passes. They are named on the [preview](preview-url).",
    );
  });
});

describe("at every setting", () => {
  test("the marker is the same, and reads back the same", () => {
    for (const detail of ["compact", "names"] as const) {
      for (const redact of [false, true]) {
        const block = renderRow(ROW, { detail, redact });
        expect(block.split("\n")[0]?.endsWith(MARKER)).toBe(true);
        const [read] = parseDashboard(block).rows;
        const [full] = parseDashboard(renderRow(ROW, { redact })).rows;
        expect({ ...read, text: "" }).toEqual({ ...full, text: "" } as NonNullable<typeof read>);
      }
    }
  });

  test("redacted, the destroys are the warning with their counts, as today", () => {
    for (const detail of ["compact", "names"] as const) {
      expect(renderRow(ROW, { detail, redact: true }).split("\n")).toContain(
        "  :warning: **deletes 1, replaces 1.** Read the [summary](run-url) before you tick.",
      );
    }
  });

  test("the size budget's last level still gives the warning with the count", () => {
    for (const detail of ["compact", "names"] as const) {
      const lines = renderRow(ROW, { detail, level: 3 }).split("\n");
      expect(lines).toContain(
        "  :warning: **deletes 1, replaces 1, too many to list here.** Read the [summary](run-url) before you tick.",
      );
      expect(lines).toContain(FAILURE);
      expect(lines).not.toContain(DELETE);
    }
  });
});
