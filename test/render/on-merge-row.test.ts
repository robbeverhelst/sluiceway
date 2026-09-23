import { describe, expect, test } from "bun:test";
import type { Change } from "../../src/core/diff.ts";
import { renderApplySummary } from "../../src/render/apply-summary.ts";
import { type BodyInput, type RecentDeploy, renderBody, rowBlock } from "../../src/render/body.ts";
import { movedComment } from "../../src/render/moved-comment.ts";
import { type DeployingRow, type PendingRow, renderRow } from "../../src/render/row.ts";

// Record 0095: a stack set to on-merge must never look like a stack nobody
// ticked. While it goes out its row says on merge and who merged, a pending
// row that waits for a tick after all says why, and the trail says merged by
// where a ticked deploy names the ticker alone. Written out by hand from the
// record.

const REPO_URL = "https://github.com/example-org/infra";
const RUN_URL = `${REPO_URL}/actions/runs/17034455121`;

const deploying = (over: Partial<DeployingRow> = {}): DeployingRow => ({
  state: "deploying",
  stackId: "app:prod",
  ticker: "alice",
  runUrl: RUN_URL,
  onMerge: true,
  ...over,
});

const update: Change = {
  address: "urn:motd",
  type: "local:File",
  name: "motd",
  op: "update",
  changedKeys: ["content"],
  replaceKeys: [],
};

const pending = (over: Partial<PendingRow> = {}): PendingRow => ({
  state: "pending",
  diff: { stackId: "app:prod", changes: [update] },
  hash: "2b44350653e84a11",
  runUrl: RUN_URL,
  ...over,
});

const first = (row: DeployingRow | PendingRow) => renderRow(row).split("\n")[0];
const lines = (row: PendingRow) => renderRow(row).split("\n");

describe("the row of a stack that goes out on merge", () => {
  test("says deploying on merge and who merged, never ticked by", () => {
    expect(first(deploying())).toBe(
      `- **app:prod** · deploying on merge · merged by alice · [run](${RUN_URL}) <!-- sluiceway:row stack="app:prod" state="deploying" -->`,
    );
  });

  test("while its record waits to start, says so", () => {
    expect(first(deploying({ waiting: true }))).toContain(
      "· waiting to start on merge · merged by alice ·",
    );
  });

  test("queued behind a stack before it in its chain, says who merged", () => {
    expect(first(deploying({ waiting: true, behind: ["network:prod"] }))).toContain(
      "· queued behind **network:prod** · merged by alice ·",
    );
  });

  test("a ticked deploy is byte for byte what it was", () => {
    expect(first(deploying({ onMerge: undefined }))).toBe(
      `- **app:prod** · deploying · ticked by alice · [run](${RUN_URL}) <!-- sluiceway:row stack="app:prod" state="deploying" -->`,
    );
  });

  test("its failure line says merged by", () => {
    const row = pending({
      failure: {
        reason: "the tool exited with an error",
        ticker: "alice",
        at: new Date("2026-09-21T09:41:00Z"),
        runUrl: RUN_URL,
        onMerge: true,
      },
    });
    expect(lines(row)[1]).toBe(
      `  :x: last deploy failed: the tool exited with an error · merged by alice · 2026-09-21 09:41 UTC · [run](${RUN_URL})`,
    );
  });
});

describe("a pending row of a stack set to on-merge that waits for a tick", () => {
  const note = (waits: PendingRow["waitsOnMerge"]) => lines(pending({ waitsOnMerge: waits }))[1];

  test("a destroy", () => {
    expect(note({ kind: "destroy" })).toBe(
      "  :information_source: this stack deploys on merge, and this change waits for a tick: it deletes or replaces a resource.",
    );
  });

  test("drift", () => {
    expect(note({ kind: "drift" })).toBe(
      "  :information_source: this stack deploys on merge, and this change waits for a tick: the stack drifted, and a deploy would also put back what changed outside the code.",
    );
  });

  test("a scan that no merge started", () => {
    expect(note({ kind: "not-merged" })).toBe(
      "  :information_source: this stack deploys on merge, and this change waits for a tick: the scan that found it did not follow a merge.",
    );
  });

  test("deploys turned off", () => {
    expect(note({ kind: "deploys-off" })).toBe(
      "  :information_source: this stack deploys on merge, and deploys are turned off in `sluiceway.yaml`.",
    );
  });

  test("a stack it depends on that waits, named as a refused tick names it", () => {
    expect(note({ kind: "depends-on", named: ["network:prod"], phases: [] })).toBe(
      "  :information_source: this stack deploys on merge, and this change waits for a tick: it depends on **network:prod**, which has a change waiting. Tick both to deploy them in order, or deploy **network:prod** first.",
    );
  });

  test("a phase before it that waits", () => {
    expect(
      note({ kind: "depends-on", named: [], phases: [{ phase: "infra", stackIds: ["vpc:prod"] }] }),
    ).toBe(
      "  :information_source: this stack deploys on merge, and this change waits for a tick: it waits on the **infra** phase: **vpc:prod** has a change waiting. Tick both to deploy them in order, or deploy the **infra** phase first.",
    );
  });

  test("the note comes right after the failure line, before the changes", () => {
    const row = renderRow(
      pending({
        waitsOnMerge: { kind: "destroy" },
        diff: { stackId: "app:prod", changes: [{ ...update, op: "delete", changedKeys: [] }] },
      }),
    ).split("\n");
    expect(row[1]).toContain("this stack deploys on merge");
    expect(row[2]).toContain(":warning: <kbd>DELETE</kbd>");
  });

  test("a row with no such note is byte for byte what it was", () => {
    expect(renderRow(pending({ waitsOnMerge: undefined }))).toBe(renderRow(pending()));
  });
});

describe("the trail line of a deploy on merge", () => {
  const input = (recentlyDeployed: RecentDeploy[]): BodyInput => ({
    root: {
      scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
      scanRun: "17034455121",
      scanAt: "2026-09-21T10:02:41Z",
    },
    rows: [rowBlock({ state: "in-sync", stackId: "app:prod" })],
    recentlyDeployed,
    repoUrl: REPO_URL,
    actionRef: "v0.1.0",
    personality: false,
  });
  const trail = (body: string) => {
    const all = body.split("\n\n");
    return all[all.indexOf("## Recently deployed") + 2]?.split("\n") ?? [];
  };
  const deploy = (over: Partial<RecentDeploy> = {}): RecentDeploy => ({
    stackId: "app:prod",
    ticker: "alice",
    at: new Date("2026-09-21T09:41:00Z"),
    runUrl: RUN_URL,
    ...over,
  });

  test("says merged by where a ticked deploy names the ticker alone", () => {
    expect(
      trail(
        renderBody(
          input([deploy({ onMerge: true }), deploy({ at: new Date("2026-09-20T09:41:00Z") })]),
        ),
      ),
    ).toEqual([
      `- app:prod · merged by alice · 09-21 09:41 · [run](${RUN_URL})`,
      `- app:prod · alice · 09-20 09:41 · [run](${RUN_URL})`,
    ]);
  });

  test("a failed deploy on merge says both", () => {
    expect(trail(renderBody(input([deploy({ onMerge: true, result: "failed" })])))).toEqual([
      `- app:prod · failed · merged by alice · 09-21 09:41 · [run](${RUN_URL})`,
    ]);
  });
});

describe("what apply writes about a deploy on merge", () => {
  test("its summary says merged by", () => {
    const summary = renderApplySummary({
      stackId: "app:prod",
      ticker: "alice",
      runUrl: RUN_URL,
      onMerge: true,
      outcome: { kind: "in-sync" },
    });
    expect(summary.split("\n\n")[1]).toBe(
      `**app:prod** · nothing to deploy, already in sync · merged by alice · [run](${RUN_URL})`,
    );
  });

  test("a change that moved before the deploy tells whoever merged, and asks for a tick", () => {
    expect(movedComment({ login: "alice", stackId: "app:prod", onMerge: true })).toBe(
      "@alice merged a change that **app:prod** deploys on merge, and the change moved before the deploy, so nothing was deployed. The row on the dashboard shows the change as it is now. Tick it to deploy that.",
    );
  });

  test("a ticked deploy's comment is what it was", () => {
    expect(movedComment({ login: "alice", stackId: "app:prod" })).toBe(
      "@alice ticked **app:prod**, and the change moved since the tick, so nothing was deployed. The row on the dashboard shows the change as it is now. Tick it again to deploy that.",
    );
  });
});
