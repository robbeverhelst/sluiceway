import { describe, expect, test } from "bun:test";
import type { Change } from "../../src/core/diff.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { type FailureLine, type PendingRow, renderRow } from "../../src/render/row.ts";

const RUN_URL = "https://github.com/example-org/infra/actions/runs/17034455121";

function change(op: Change["op"], type: string, name: string, rest: Partial<Change> = {}): Change {
  return { address: `${type}::${name}`, type, name, op, changedKeys: [], replaceKeys: [], ...rest };
}

// The worked example of record 0027, with the changes handed over out of order.
const BUCKETS: PendingRow = {
  state: "pending",
  diff: {
    stackId: "storage/buckets:prod",
    changes: [
      change("create", "aws:s3/bucketVersioning:BucketVersioning", "uploads"),
      change("replace", "aws:s3/bucket:Bucket", "uploads", {
        changedKeys: ["tags", "bucket"],
        replaceKeys: ["bucket"],
      }),
      change("none", "aws:s3/bucket:Bucket", "archive", {
        tracking: "move",
        previousAddress: "aws:s3/bucket:Bucket::old-archive",
      }),
      change("delete", "aws:s3/bucketPolicy:BucketPolicy", "uploads-public-read"),
      change("update", "aws:s3/bucketLifecycleConfiguration:BucketLifecycleConfiguration", "logs", {
        changedKeys: ["rules"],
      }),
    ],
  },
  hash: "2b44350653e84a11",
  runUrl: "run-url",
  attribution: {
    full: "from #433 by alice, #429 by alice, [3fa9c1e](commit-url) by bob, and 1 change outside this stack · [compare](compare-url)",
    counted: "from 3 pull requests, and 1 change outside this stack · [compare](compare-url)",
  },
};

describe("a pending row", () => {
  test("the worked example of record 0027", () => {
    expect(renderRow(BUCKETS)).toBe(
      [
        '- [ ] **storage/buckets:prod** · 1 create, 1 update, **1 replace**, **1 delete**, 1 tracking only · [preview](run-url) <!-- sluiceway:row stack="storage/buckets:prod" state="pending" hash="2b44350653e84a11" destroys="2" -->',
        "  from #433 by alice, #429 by alice, [3fa9c1e](commit-url) by bob, and 1 change outside this stack · [compare](compare-url)",
        "  :warning: <kbd>DELETE</kbd> <code>aws:s3/bucketPolicy:BucketPolicy</code> <b>uploads-public-read</b>",
        "  :warning: <kbd>REPLACE</kbd> <code>aws:s3/bucket:Bucket</code> <b>uploads</b> · forced by <code>bucket</code> · also changes <code>tags</code>",
        "  <details><summary>3 other changes</summary>",
        "  <kbd>move</kbd> <code>aws:s3/bucket:Bucket</code> <b>archive</b><br>",
        "  <kbd>update</kbd> <code>aws:s3/bucketLifecycleConfiguration:BucketLifecycleConfiguration</code> <b>logs</b> · <code>rules</code><br>",
        "  <kbd>create</kbd> <code>aws:s3/bucketVersioning:BucketVersioning</code> <b>uploads</b><br>",
        "  </details>",
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  function pending(stackId: string, changes: Change[], rest: Partial<PendingRow> = {}): PendingRow {
    return {
      state: "pending",
      diff: { stackId, changes },
      hash: "00000000000000aa",
      runUrl: RUN_URL,
      ...rest,
    };
  }

  function firstLine(block: string): string {
    return block.split("\n")[0] ?? "";
  }

  test("counts are words in a fixed order, zeros left out, singular when one", () => {
    const row = pending("a:prod", [
      change("none", "t", "i1", { tracking: "import" }),
      change("none", "t", "i2", { tracking: "forget" }),
      change("delete", "t", "d1"),
      change("delete", "t", "d2"),
      change("update", "t", "u1", { changedKeys: ["k"] }),
      change("update", "t", "u2", { changedKeys: ["k"], tracking: "import" }),
      change("create", "t", "c1"),
      change("create", "t", "c2"),
      change("create", "t", "c3"),
    ]);
    expect(firstLine(renderRow(row))).toBe(
      `- [ ] **a:prod** · 3 creates, 2 updates, **2 deletes**, 2 tracking only · [preview](${RUN_URL}) <!-- sluiceway:row stack="a:prod" state="pending" hash="00000000000000aa" destroys="2" -->`,
    );
    const replaces = pending("a:prod", [
      change("replace", "t", "r1"),
      change("replace", "t", "r2"),
    ]);
    expect(firstLine(renderRow(replaces))).toContain("· **2 replaces** ·");
  });

  test("a row with no delete or replace folds everything and caches no destroys", () => {
    const row = pending("apps/api:prod", [
      change("update", "kubernetes:apps/v1:Deployment", "api", { changedKeys: ["spec"] }),
    ]);
    expect(renderRow(row)).toBe(
      [
        `- [ ] **apps/api:prod** · 1 update · [preview](${RUN_URL}) <!-- sluiceway:row stack="apps/api:prod" state="pending" hash="00000000000000aa" -->`,
        "  <details><summary>1 change</summary>",
        "  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>api</b> · <code>spec</code><br>",
        "  </details>",
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("a row with nothing but deletes and replaces has no fold", () => {
    const row = pending("apps/legacy:prod", [
      change("delete", "aws:sqs/queue:Queue", "legacy-jobs"),
      change("delete", "aws:iam/role:Role", "legacy"),
    ]);
    expect(renderRow(row).split("\n").slice(1)).toEqual([
      "  :warning: <kbd>DELETE</kbd> <code>aws:iam/role:Role</code> <b>legacy</b>",
      "  :warning: <kbd>DELETE</kbd> <code>aws:sqs/queue:Queue</code> <b>legacy-jobs</b>",
      "  <!-- /sluiceway:row -->",
    ]);
  });

  test("deletes come before replaces, each group sorted by address", () => {
    const row = pending("a:prod", [
      change("replace", "t", "a"),
      change("delete", "t", "z"),
      change("replace", "t", "B"),
      change("delete", "t", "y"),
    ]);
    const names = renderRow(row)
      .split("\n")
      .slice(1, -1)
      .map((line) => /<b>(.*?)<\/b>/.exec(line)?.[1]);
    expect(names).toEqual(["y", "z", "B", "a"]);
  });

  test("a replace with no replace keys lists its changed keys alone", () => {
    const row = pending("a:prod", [change("replace", "t", "n", { changedKeys: ["size", "name"] })]);
    expect(renderRow(row).split("\n")[1]).toBe(
      "  :warning: <kbd>REPLACE</kbd> <code>t</code> <b>n</b> · <code>name</code>, <code>size</code>",
    );
  });

  test("a replace forced by all of its changed keys says nothing more", () => {
    const row = pending("a:prod", [
      change("replace", "t", "n", { changedKeys: ["b", "a"], replaceKeys: ["b", "a", "a"] }),
    ]);
    expect(renderRow(row).split("\n")[1]).toBe(
      "  :warning: <kbd>REPLACE</kbd> <code>t</code> <b>n</b> · forced by <code>a</code>, <code>b</code>",
    );
  });

  // Record 0007: a warning reads the op alone.
  test("a tracking change never gets a warning, and rides along on the key cap of an op", () => {
    const row = pending("a:prod", [
      change("none", "t", "1", { tracking: "forget" }),
      change("update", "t", "2", { tracking: "import", changedKeys: ["k"] }),
      change("create", "t", "3", { tracking: "forget" }),
    ]);
    const block = renderRow(row);
    expect(block).not.toContain(":warning:");
    expect(block.split("\n").slice(2, 5)).toEqual([
      "  <kbd>forget</kbd> <code>t</code> <b>1</b><br>",
      "  <kbd>update + import</kbd> <code>t</code> <b>2</b> · <code>k</code><br>",
      "  <kbd>create + forget</kbd> <code>t</code> <b>3</b><br>",
    ]);
  });

  test("the same diff in another order gives the same bytes", () => {
    const shuffled: PendingRow = {
      ...BUCKETS,
      diff: { ...BUCKETS.diff, changes: [...BUCKETS.diff.changes].reverse() },
    };
    expect(renderRow(shuffled)).toBe(renderRow(BUCKETS));
  });

  test("a row whose attribution could not be worked out has no such line", () => {
    const { attribution: _, ...row } = BUCKETS;
    const lines = renderRow(row).split("\n");
    expect(lines[1]).toStartWith("  :warning: <kbd>DELETE</kbd>");
    expect(lines).toHaveLength(9);
  });
});

const FAILURE: FailureLine = {
  reason: "the change moved since the tick",
  ticker: "alice",
  at: new Date("2026-09-21T08:52:41.999Z"),
  runUrl: "https://github.com/example-org/infra/actions/runs/17034120077",
};

// The fixed order of record 0027: first line, attribution line, failure line,
// orphan tick note, deletes, replaces, the fold, closing marker.
describe("the lines a deploy leaves on a row", () => {
  test("the failure line and the orphan tick note sit between attribution and the changes", () => {
    const lines = renderRow({ ...BUCKETS, failure: FAILURE, orphanTick: true }).split("\n");
    expect(lines.slice(1, 5)).toEqual([
      `  ${BUCKETS.attribution?.full}`,
      "  :x: last deploy failed: the change moved since the tick · ticked by alice · 2026-09-21 08:52 UTC · [run](https://github.com/example-org/infra/actions/runs/17034120077)",
      "  :information_source: a tick on this row was not picked up. Tick again to deploy.",
      "  :warning: <kbd>DELETE</kbd> <code>aws:s3/bucketPolicy:BucketPolicy</code> <b>uploads-public-read</b>",
    ]);
  });

  // Onboarding log, hurdle 21 (slice 2.22).
  test("the pending-again line sits after the failure line and before the orphan tick note", () => {
    const lines = renderRow({
      ...BUCKETS,
      failure: FAILURE,
      orphanTick: true,
      pendingAgain: {},
    }).split("\n");
    expect(lines.slice(3, 5)).toEqual([
      "  :information_source: pending again right after a deploy of this same change, a value in the program may differ on every run.",
      "  :information_source: a tick on this row was not picked up. Tick again to deploy.",
    ]);
  });

  test("the pending-again line points at the job log that holds the tool's own diff", () => {
    const lines = renderRow({ ...BUCKETS, pendingAgain: { logUrl: "log-url" } }).split("\n");
    expect(lines[2]).toBe(
      "  :information_source: pending again right after a deploy of this same change, a value in the program may differ on every run. Compare the tool's own diff in the [job log](log-url).",
    );
  });

  test("the pending-again line stays on a redacted, a read-only and a fully shortened row, and changes neither marker nor hash", () => {
    const plain = renderRow(BUCKETS).split("\n")[0];
    for (const options of [{ redact: true }, { readOnly: true }, { level: 3 as const }]) {
      const block = renderRow({ ...BUCKETS, pendingAgain: {} }, options);
      expect(block).toContain("pending again right after a deploy");
      expect(block.split("\n")[0]).toBe(renderRow(BUCKETS, options).split("\n")[0]);
    }
    expect(renderRow({ ...BUCKETS, pendingAgain: {} }).split("\n")[0]).toBe(plain);
  });

  test("a row with a failure line says so on its marker", () => {
    const first = renderRow({ ...BUCKETS, failure: FAILURE }).split("\n")[0];
    expect(first).toEndWith('hash="2b44350653e84a11" destroys="2" failed="true" -->');
  });
});

// Expected lines are the shapes record 0027 gives for each kind of row.
describe("rows without a box", () => {
  const CERT_RUN = "https://github.com/example-org/infra/actions/runs/17034501999";

  test("a deploying row names the ticker and the run, and keeps its attribution line", () => {
    const block = renderRow({
      state: "deploying",
      stackId: "platform/cert-manager:prod",
      ticker: "carol",
      runUrl: CERT_RUN,
      attribution: {
        full: "from #437 by renovate[bot] · [compare](compare-url)",
        counted: "unused",
      },
    });
    expect(block).toBe(
      [
        `- **platform/cert-manager:prod** · deploying · ticked by carol · [run](${CERT_RUN}) <!-- sluiceway:row stack="platform/cert-manager:prod" state="deploying" -->`,
        "  from #437 by renovate[bot] · [compare](compare-url)",
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("while the record is still queued the word is waiting to start", () => {
    const block = renderRow({
      state: "deploying",
      stackId: "apps/web:staging",
      ticker: "alice",
      runUrl: CERT_RUN,
      waiting: true,
    });
    expect(block).toBe(
      [
        `- **apps/web:staging** · waiting to start · ticked by alice · [run](${CERT_RUN}) <!-- sluiceway:row stack="apps/web:staging" state="deploying" -->`,
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("a deploying row carries the destroys of the row it replaced on its marker", () => {
    const block = renderRow({
      state: "deploying",
      stackId: "a:prod",
      ticker: "alice",
      runUrl: CERT_RUN,
      destroys: 2,
    });
    expect(block.split("\n")[0]).toEndWith(
      '<!-- sluiceway:row stack="a:prod" state="deploying" destroys="2" -->',
    );
  });

  test("a preview failure row gives the failure reason and the run, and no box", () => {
    const block = renderRow({
      state: "preview-failed",
      stackId: "monitoring/loki:prod",
      reason: "the preview timed out after 10 minutes",
      runUrl: RUN_URL,
    });
    expect(block).toBe(
      [
        `- **monitoring/loki:prod** · preview failed: the preview timed out after 10 minutes · [run](${RUN_URL}) <!-- sluiceway:row stack="monitoring/loki:prod" state="preview-failed" -->`,
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("an in sync row is the bare stack id", () => {
    expect(renderRow({ state: "in-sync", stackId: "infra/kms:prod" })).toBe(
      [
        '- infra/kms:prod <!-- sluiceway:row stack="infra/kms:prod" state="in-sync" -->',
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("the failure line rides on an in sync row and on a preview failure row", () => {
    const failure: FailureLine = {
      reason: "the run ended without reporting a result",
      ticker: "bob",
      at: new Date("2026-09-19T16:03:00Z"),
      runUrl: "https://github.com/example-org/infra/actions/runs/17019884120",
    };
    const line =
      "  :x: last deploy failed: the run ended without reporting a result · ticked by bob · 2026-09-19 16:03 UTC · [run](https://github.com/example-org/infra/actions/runs/17019884120)";
    expect(renderRow({ state: "in-sync", stackId: "data/warehouse:prod", failure })).toBe(
      [
        '- data/warehouse:prod <!-- sluiceway:row stack="data/warehouse:prod" state="in-sync" failed="true" -->',
        line,
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
    const failed = renderRow({
      state: "preview-failed",
      stackId: "a:prod",
      reason: "the tool exited with an error (exit code 255)",
      runUrl: RUN_URL,
      failure,
    }).split("\n");
    expect(failed[0]).toEndWith('state="preview-failed" failed="true" -->');
    expect(failed[1]).toBe(line);
  });
});

// Record 0023: names leave the issue. Counts, the warning, the failure line
// and the links stay.
describe("a redacted row", () => {
  test("a row with a delete or replace keeps its first line, its attribution and the warning", () => {
    const full = renderRow(BUCKETS).split("\n");
    expect(renderRow(BUCKETS, { redact: true }).split("\n")).toEqual([
      full[0] ?? "",
      full[1] ?? "",
      "  :warning: **deletes 1, replaces 1.** Read the [summary](run-url) before you tick.",
      "  <!-- /sluiceway:row -->",
    ]);
  });

  test("a row without one points at the summary", () => {
    const row: PendingRow = {
      state: "pending",
      diff: {
        stackId: "apps/api:prod",
        changes: [change("update", "secret:Type", "secret-name", { changedKeys: ["secretKey"] })],
      },
      hash: "00000000000000aa",
      runUrl: RUN_URL,
    };
    expect(renderRow(row, { redact: true })).toBe(
      [
        `- [ ] **apps/api:prod** · 1 update · [preview](${RUN_URL}) <!-- sluiceway:row stack="apps/api:prod" state="pending" hash="00000000000000aa" -->`,
        `  Changes are listed in the [summary](${RUN_URL})`,
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });

  test("no resource type, resource name or property name is left in the block", () => {
    const block = renderRow({ ...BUCKETS, failure: FAILURE, orphanTick: true }, { redact: true });
    for (const change of BUCKETS.diff.changes) {
      expect(block).not.toContain(change.type);
      expect(block).not.toContain(`<b>${change.name}</b>`);
      for (const key of change.changedKeys) expect(block).not.toContain(`<code>${key}</code>`);
    }
    expect(block).toContain(":x: last deploy failed:");
    expect(block).toContain(":information_source:");
  });

  test("only deletes, or only replaces, are named in the warning", () => {
    const deletes: PendingRow = {
      ...BUCKETS,
      diff: { stackId: "a", changes: [change("delete", "t", "1"), change("delete", "t", "2")] },
    };
    expect(renderRow(deletes, { redact: true })).toContain(":warning: **deletes 2.** Read the");
    const replaces: PendingRow = {
      ...BUCKETS,
      diff: { stackId: "a", changes: [change("replace", "t", "1")] },
    };
    expect(renderRow(replaces, { redact: true })).toContain(":warning: **replaces 1.** Read the");
  });

  test("the marker is the same with and without redact", () => {
    const marker = (block: string) => /<!-- sluiceway:row .*-->/.exec(block)?.[0];
    expect(marker(renderRow(BUCKETS, { redact: true }))).toBe(marker(renderRow(BUCKETS)) ?? "");
  });

  test("rows without a diff read the same under redact", () => {
    const row = { state: "in-sync", stackId: "infra/kms:prod" } as const;
    expect(renderRow(row, { redact: true })).toBe(renderRow(row));
  });
});

// Slice 2.17 (onboarding log, hurdle 16): `dashboard.readOnly` is for a
// workflow with no `resolve` job, where a box would look live and do nothing.
describe("a row on a read-only dashboard", () => {
  test("a pending row has no box, and every other line is the same", () => {
    const [first, ...rest] = renderRow(BUCKETS).split("\n");
    expect(renderRow(BUCKETS, { readOnly: true }).split("\n")).toEqual([
      (first ?? "").replace("- [ ] ", "- "),
      ...rest,
    ]);
  });

  test("reads back as a pending row with its hash and no tick", () => {
    const [block] = parseDashboard(renderRow(BUCKETS, { readOnly: true })).rows;
    expect(block).toMatchObject({
      known: true,
      stackId: "storage/buckets:prod",
      state: "pending",
      hash: "2b44350653e84a11",
      destroys: 2,
      ticked: false,
    });
  });

  test("carries no tick and no note that asks for one", () => {
    const block = renderRow({ ...BUCKETS, ticked: true, orphanTick: true }, { readOnly: true });
    expect(block).toStartWith("- **storage/buckets:prod** · ");
    expect(block).not.toContain(":information_source:");
    expect(block).not.toContain("tick");
  });

  test("a warning that sends a person to the summary does not ask for a tick", () => {
    for (const options of [{ redact: true }, { level: 3 as const }]) {
      const block = renderRow(BUCKETS, { ...options, readOnly: true });
      expect(block).toContain("Read the [summary](run-url).");
      expect(block).not.toContain("tick");
    }
  });

  test("rows without a box read the same", () => {
    const row = { state: "in-sync", stackId: "infra/kms:prod", failure: FAILURE } as const;
    expect(renderRow(row, { readOnly: true })).toBe(renderRow(row));
  });
});

// Records 0024 and 0028: what a pending row shows at each level of the size
// budget. Choosing the levels is the budget's job, not the row's.
describe("a shortened row", () => {
  const level = (n: 0 | 1 | 2 | 3) => renderRow(BUCKETS, { level: n }).split("\n");
  const full = level(0);
  // The first line is never shortened (record 0028). Only its marker says
  // which level the row is at, for the writers that cannot read the rest.
  const first = (n: 1 | 2 | 3) => (full[0] ?? "").replace(" -->", ` shortened="${n}" -->`);

  test("the marker of a shortened row holds its level, after every other key", () => {
    expect(level(2)[0]).toBe(
      '- [ ] **storage/buckets:prod** · 1 create, 1 update, **1 replace**, **1 delete**, 1 tracking only · [preview](run-url) <!-- sluiceway:row stack="storage/buckets:prod" state="pending" hash="2b44350653e84a11" destroys="2" shortened="2" -->',
    );
    expect(full[0]).not.toContain("shortened");
  });

  test("level 0 is the row in full", () => {
    expect(full.join("\n")).toBe(renderRow(BUCKETS));
  });

  test("level 1 replaces the named pull requests with a count and nothing else", () => {
    expect(level(1)).toEqual([
      first(1),
      "  from 3 pull requests, and 1 change outside this stack · [compare](compare-url)",
      ...full.slice(2),
    ]);
  });

  test("level 2 replaces the fold with one line and keeps every delete and replace line", () => {
    expect(level(2)).toEqual([
      first(2),
      "  from 3 pull requests, and 1 change outside this stack · [compare](compare-url)",
      full[2] ?? "",
      full[3] ?? "",
      "  3 other changes not listed here, see the [summary](run-url)",
      "  <!-- /sluiceway:row -->",
    ]);
  });

  test("level 3 lists no change, and the warning carries the full count", () => {
    expect(level(3)).toEqual([
      first(3),
      "  from 3 pull requests, and 1 change outside this stack · [compare](compare-url)",
      "  :warning: **deletes 1, replaces 1, too many to list here.** Read the [summary](run-url) before you tick.",
      "  <!-- /sluiceway:row -->",
    ]);
  });

  test("a row with no delete or replace", () => {
    const row: PendingRow = {
      state: "pending",
      diff: { stackId: "a", changes: [change("create", "t", "1"), change("create", "t", "2")] },
      hash: "00000000000000aa",
      runUrl: "run-url",
    };
    expect(renderRow(row, { level: 2 }).split("\n").slice(1)).toEqual([
      "  2 changes not listed here, see the [summary](run-url)",
      "  <!-- /sluiceway:row -->",
    ]);
    expect(renderRow(row, { level: 3 }).split("\n").slice(1)).toEqual([
      "  Changes not listed here, see the [summary](run-url)",
      "  <!-- /sluiceway:row -->",
    ]);
  });

  test("a row with nothing but deletes and replaces is the same at level 2", () => {
    const row: PendingRow = {
      ...BUCKETS,
      diff: { stackId: "a", changes: [change("delete", "t", "1")] },
    };
    const rest = (n: 1 | 2) => renderRow(row, { level: n }).split("\n").slice(1);
    expect(rest(2)).toEqual(rest(1));
  });

  test("the first line, the failure line and the orphan tick note survive every level", () => {
    const row = { ...BUCKETS, failure: FAILURE, orphanTick: true };
    const lines = renderRow(row).split("\n");
    for (const n of [1, 2, 3] as const) {
      const short = renderRow(row, { level: n }).split("\n");
      expect(short[0]).toBe((lines[0] ?? "").replace(" -->", ` shortened="${n}" -->`));
      expect(short.slice(2, 4)).toEqual(lines.slice(2, 4));
    }
  });

  test("a row that is not pending has nothing to shorten", () => {
    const row = { state: "in-sync", stackId: "infra/kms:prod" } as const;
    expect(renderRow(row, { level: 3 })).toBe(renderRow(row));
  });
});

// Record 0046: a key is a property path, shown as the tool wrote it. A row
// shortens a long path in the middle and lists at most ten paths of one
// change. The summary and the job log show every path in full.
describe("property paths on a row", () => {
  const LONG =
    "spec.template.spec.containers[0].env[3].valueFrom.secretKeyRef.optional.nested.deeper.leaf";

  function lineOf(update: Change): string {
    const row: PendingRow = {
      state: "pending",
      diff: { stackId: "apps/web:prod", changes: [update] },
      hash: "00000000000000aa",
      runUrl: "run-url",
    };
    return renderRow(row).split("\n")[2] ?? "";
  }

  test("a path is shown whole, with its list indexes and quoted map keys", () => {
    const line = lineOf(
      change("update", "kubernetes:apps/v1:Deployment", "web", {
        changedKeys: [
          "spec.template.spec.containers[0].image",
          'metadata.annotations["example.com/revision"]',
        ],
      }),
    );
    expect(line).toBe(
      "  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>web</b> · <code>metadata.annotations&#91;&quot;example.com/revision&quot;&#93;</code>, <code>spec.template.spec.containers&#91;0&#93;.image</code><br>",
    );
  });

  test("a path longer than 80 characters keeps its first segment and its end", () => {
    expect(LONG.length).toBeGreaterThan(80);
    const line = lineOf(change("update", "t", "n", { changedKeys: [LONG] }));
    expect(line).toContain(
      "<code>spec…containers&#91;0&#93;.env&#91;3&#93;.valueFrom.secretKeyRef.optional.nested.deeper.leaf</code>",
    );
  });

  test("a path of exactly 80 characters is shown whole", () => {
    const path = `a.${"b".repeat(78)}`;
    expect(lineOf(change("update", "t", "n", { changedKeys: [path] }))).toContain(
      `<code>${path}</code>`,
    );
  });

  test("a long path with no segment to start its end at is cut by characters", () => {
    const path = `values.${"x".repeat(100)}`;
    expect(lineOf(change("update", "t", "n", { changedKeys: [path] }))).toContain(
      `<code>values…${"x".repeat(73)}</code>`,
    );
  });

  test("a long first segment is cut too", () => {
    const path = `${"k".repeat(60)}.${"v".repeat(60)}`;
    expect(lineOf(change("update", "t", "n", { changedKeys: [path] }))).toContain(
      `<code>${"k".repeat(24)}…${"v".repeat(55)}</code>`,
    );
  });

  test("a change lists at most ten paths, and says how many more there are", () => {
    const paths = Array.from(
      { length: 13 },
      (_, index) => `values.key${String(index).padStart(2, "0")}`,
    );
    const line = lineOf(change("update", "t", "n", { changedKeys: paths }));
    const shown = paths.slice(0, 10).map((path) => `<code>${path}</code>`);
    expect(line).toEndWith(` · ${shown.join(", ")}, and 3 more<br>`);
  });

  test("ten paths are all listed", () => {
    const paths = Array.from({ length: 10 }, (_, index) => `values.key${index}`);
    expect(lineOf(change("update", "t", "n", { changedKeys: paths }))).not.toContain("more");
  });

  // Record 0024: a replace or delete line is shown whole or cut whole, and
  // never loses a key to save space. Only the lines in the fold are capped.
  test("a replace line lists every path, forcing or not, however many", () => {
    const forcing = Array.from(
      { length: 12 },
      (_, index) => `data.f${String(index).padStart(2, "0")}`,
    );
    const others = Array.from(
      { length: 11 },
      (_, index) => `spec.o${String(index).padStart(2, "0")}`,
    );
    const block = renderRow({
      state: "pending",
      diff: {
        stackId: "apps/web:prod",
        changes: [
          change("replace", "t", "n", {
            changedKeys: [...forcing, ...others, `spec.${"x".repeat(100)}`],
            replaceKeys: forcing,
          }),
        ],
      },
      hash: "00000000000000aa",
      runUrl: "run-url",
    });
    const codes = (keys: string[]) => keys.map((key) => `<code>${key}</code>`).join(", ");
    expect(block.split("\n")[1]).toEndWith(
      ` · forced by ${codes(forcing)} · also changes ${codes([...others, `spec…${"x".repeat(75)}`])}`,
    );
  });
});

// Types, names and property names come from the user's code and the provider's
// schema. Stack ids come from directory and file names.
describe("text from outside is never markup", () => {
  const HOSTILE =
    '</details>\n  <!-- /sluiceway:row -->\n- [x] **x** <!-- sluiceway:row stack="victim:prod" state="pending" hash="00" -->';
  const row: PendingRow = {
    state: "pending",
    diff: {
      stackId: 'apps/<b>*x*</b> "q":prod',
      changes: [
        change("delete", `<script>${HOSTILE}`, "[click](https://example.com)", { address: "1" }),
        change("replace", "t", HOSTILE, {
          address: "2",
          changedKeys: ["<i>k</i>", "`b`"],
          replaceKeys: ["<i>k</i>"],
        }),
        change("update", "t&t", "__init__", { address: "3", changedKeys: [HOSTILE] }),
      ],
    },
    hash: "00000000000000aa",
    runUrl: "run-url",
  };

  test("a hostile stack id, type, name and key are escaped on every line", () => {
    const lines = renderRow(row).split("\n");
    expect(lines[0]).toBe(
      '- [ ] **apps/&lt;b&gt;&#42;x&#42;&lt;/b&gt; &quot;q&quot;:prod** · 1 update, **1 replace**, **1 delete** · [preview](run-url) <!-- sluiceway:row stack="apps/%3Cb%3E*x*%3C/b%3E%20%22q%22:prod" state="pending" hash="00000000000000aa" destroys="2" -->',
    );
    expect(lines[1]).toStartWith(
      "  :warning: <kbd>DELETE</kbd> <code>&lt;script&gt;&lt;/details&gt;   &lt;!-- /sluiceway:row --&gt; - &#91;x&#93;",
    );
    expect(lines[1]).toEndWith("<b>&#91;click&#93;(https://example.com)</b>");
    expect(lines[2]).toContain(
      "forced by <code>&lt;i&gt;k&lt;/i&gt;</code> · also changes <code>&#96;b&#96;</code>",
    );
    expect(lines[4]).toStartWith(
      "  <kbd>update</kbd> <code>t&amp;t</code> <b>&#95;&#95;init&#95;&#95;</b> · <code>&lt;/details&gt;",
    );
  });

  test("a name can never add a line, a marker or a row to the block", () => {
    for (const level of [0, 1, 2, 3] as const) {
      const block = renderRow(row, { level });
      expect(block.match(/<!--/g)).toHaveLength(2);
      const rows = parseDashboard(block).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ stackId: row.diff.stackId, ticked: false, text: block });
    }
    expect(renderRow(row).split("\n")).toHaveLength(7);
  });

  test("a failure reason and a ticker are escaped too", () => {
    const block = renderRow({
      state: "in-sync",
      stackId: "a",
      failure: { reason: "<b>x</b>", ticker: "al*ice", at: new Date(0), runUrl: "u" },
    });
    expect(block.split("\n")[1]).toBe(
      "  :x: last deploy failed: &lt;b&gt;x&lt;/b&gt; · ticked by al&#42;ice · 1970-01-01 00:00 UTC · [run](u)",
    );
  });
});
