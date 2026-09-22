import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import { renderBulkLine } from "../../src/render/bulk-box.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import type { FakeGitHub } from "../fake-github/fake-github.ts";
import {
  change,
  dashboardBody,
  drifted,
  harness,
  inSync,
  pending,
  RUN_ID,
  tableAdapter,
} from "./harness.ts";

// Slice 5.18, record 0083: the scan draws a bulk box under a section of two
// rows or more, keeps a confirm box through one scan and not two, and sweeps
// a tick on either as an orphan when no `resolve` run is on its way.

const WORKFLOW = "sluiceway.yml";
const ALICE = { login: "alice", type: "User" };

const TABLE = {
  "a:prod": pending("a:prod", change("logs")),
  "b:prod": pending("b:prod", change("disk")),
  "c:prod": inSync("c:prod"),
};

const bulkOf = (github: FakeGitHub) => parseDashboard(dashboardBody(github)).bulk;

function tickBulk(github: FakeGitHub): void {
  const body = dashboardBody(github);
  const box = "- [ ] Deploy all";
  if (!body.includes(box)) throw new Error("The dashboard has no bulk box to tick.");
  github.editBody(1, body.replace(box, "- [x] Deploy all"), ALICE);
}

// What `resolve` draws after an allowed tick on the bulk box: the confirm box
// of the pending rows, after the scan whose body it was drawn into.
function drawConfirm(github: FakeGitHub, ticked = false): void {
  const body = dashboardBody(github);
  const [line] = parseDashboard(body).bulk;
  const rows = parseDashboard(body).rows.flatMap((row) =>
    row.known && row.state === "pending" && row.hash
      ? [{ stackId: row.stackId, hash: row.hash }]
      : [],
  );
  if (!line) throw new Error("The dashboard has no bulk box.");
  const confirm = renderBulkLine({
    kind: "confirm",
    section: "pending",
    by: "alice",
    stacks: rows,
    scanRun: parseDashboard(body).root?.scanRun ?? "",
    ticked,
  });
  github.editBody(1, body.replace(line.text, confirm), ALICE);
}

describe("the scan and the bulk box", () => {
  test("draws a bulk box under two pending rows, and none under one", async () => {
    const { context, github } = harness(tableAdapter(TABLE));
    await scan(context);
    expect(bulkOf(github)).toMatchObject([{ kind: "box", section: "pending", ticked: false }]);
    const body = dashboardBody(github);
    expect(body).toContain("- [ ] Deploy all 2 pending stacks");
    expect(body.indexOf("Deploy all 2")).toBeGreaterThan(body.indexOf("**b:prod**"));

    await scan({ ...context, adapter: tableAdapter({ ...TABLE, "b:prod": inSync("b:prod") }) });
    expect(bulkOf(github)).toEqual([]);
  });

  test("draws a repair box under two drifted rows", async () => {
    const adapter = tableAdapter(
      { "a:prod": inSync("a:prod"), "b:prod": inSync("b:prod") },
      {},
      {},
      {
        "a:prod": drifted("a:prod", change("notes", "delete")),
        "b:prod": drifted("b:prod", change("assets")),
      },
    );
    const { context, github } = harness(adapter, {
      config: "drift:\n  enabled: true\n",
      event: "schedule",
    });
    await scan(context);
    expect(bulkOf(github)).toMatchObject([{ kind: "box", section: "drift" }]);
    expect(dashboardBody(github)).toContain("- [ ] Repair all 2 drifted stacks");
  });

  test("none while deploys are off or the dashboard is read only", async () => {
    for (const config of ["deploys: false\n", "dashboard:\n  readOnly: true\n"]) {
      const { context, github } = harness(tableAdapter(TABLE), { config });
      await scan(context);
      expect(bulkOf(github)).toEqual([]);
    }
  });

  test("a tick on the bulk box that nothing picked up is swept with a note", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE));
    await scan(context);
    tickBulk(github);

    await scan(context);

    expect(bulkOf(github)).toMatchObject([
      { kind: "box", ticked: false, note: { kind: "orphan" } },
    ]);
    expect(github.requests).not.toContain("createDeployment");
    expect(log.lines).toContain(
      "Cleared an orphan tick on the box that deploys all pending stacks: no run that an issue edit started is queued or in progress. Tick it again to ask once more.",
    );
  });

  test("a tick on the bulk box is left alone while a resolve run is on its way", async () => {
    const { context, github } = harness(tableAdapter(TABLE));
    await scan(context);
    tickBulk(github);
    github.seedIssuesRun(WORKFLOW, { id: "70", completed: false });

    await scan(context);

    expect(bulkOf(github)).toMatchObject([{ kind: "box", ticked: true }]);
  });

  test("a confirm box lives through one scan and is taken back by the next", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE));
    await scan(context);
    drawConfirm(github);

    await scan({ ...context, runId: "4243" });
    expect(bulkOf(github)).toMatchObject([{ kind: "confirm", scanRun: RUN_ID }]);

    await scan({ ...context, runId: "4244" });
    expect(bulkOf(github)).toMatchObject([{ kind: "box", note: { kind: "expired" } }]);
    expect(log.lines).toContain(
      "Took back the confirm box of the pending stacks: nobody ticked it before this scan.",
    );
  });

  test("a confirm box goes stale when the scan finds a new pending stack, and the note names it", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE));
    await scan(context);
    drawConfirm(github);

    await scan({
      ...context,
      runId: "4243",
      adapter: tableAdapter({ ...TABLE, "c:prod": pending("c:prod", change("dns")) }),
    });

    const [line] = bulkOf(github);
    expect(line).toMatchObject({
      kind: "box",
      ticked: false,
      note: { kind: "changed", added: ["c:prod"], gone: [], moved: [] },
    });
    expect(line?.text).toStartWith("- [ ] Deploy all 3 pending stacks");
    expect(line?.text).toContain("**c:prod** is new");
    expect(log.lines).toContain(
      "Took back the confirm box of the pending stacks: its rows changed (c:prod is new).",
    );
  });

  test("a ticked confirm box that nothing picked up is swept, and nothing deploys", async () => {
    const { context, github } = harness(tableAdapter(TABLE));
    await scan(context);
    drawConfirm(github, true);

    await scan(context);

    expect(bulkOf(github)).toMatchObject([{ kind: "box", note: { kind: "orphan" } }]);
    expect(github.requests).not.toContain("createDeployment");
  });
});
