import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { change, dashboardBody, harness, inSync, pending, tableAdapter } from "./harness.ts";
import { ALICE, rowsOf, scanned, tick, wake } from "./resolve-harness.ts";

// Slice 5.51 (record 0114): the layout keys reach the body through every
// writer, and the markers are the same whatever the look.

const MINIMAL = [
  "dashboard:",
  "  sections: [pending, previewFailed]",
  "  inSyncSection: off",
  "  zeroCounts: false",
  "  pendingDetail: compact",
  "  deployAll: false",
  "  rescanBox: false",
  "  footer: false",
  "",
].join("\n");

const TABLE = {
  "a:prod": pending("a:prod", change("logs")),
  "b:prod": pending("b:prod", change("queue")),
  "c:prod": inSync("c:prod"),
};

const headings = (body: string) => body.split("\n").filter((line) => line.startsWith("## "));
const markers = (body: string) =>
  parseDashboard(body).rows.map(({ text, ...facts }) => ({
    ...facts,
    marker: text.split("\n")[0]?.replace(/^.*<!--/, "<!--"),
  }));

describe("a scan with the layout keys", () => {
  test("writes the layout it names, with the markers of the default layout", async () => {
    const plain = harness(tableAdapter(TABLE));
    await scan(plain.context);
    const { context, github } = harness(tableAdapter(TABLE), { config: MINIMAL });
    await scan(context);

    const body = dashboardBody(github);
    expect(headings(body)).toEqual(["## Pending"]);
    expect(body).toContain("🟡&nbsp;**2 pending** · 🟢&nbsp;1 in sync\n");
    expect(body).toContain(
      "<details><summary>1 stack in sections this dashboard does not show</summary>",
    );
    expect(body).not.toContain("Deploy all");
    expect(body).not.toContain("sluiceway:rescan");
    expect(body).not.toContain("<sub>[Sluiceway]");
    expect(markers(body)).toEqual(markers(dashboardBody(plain.github)));
  });
});

describe("the other writers", () => {
  test("resolve keeps the layout when it swaps a row", async () => {
    const h = await scanned(TABLE);
    writeFileSync(join(h.context.root, "sluiceway.yaml"), MINIMAL);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    const body = dashboardBody(h.github);
    expect(rowsOf(h)["a:prod"]).toContain("waiting to start · ticked by alice");
    // Pending first, as the list says, and Deploying after it.
    expect(headings(body)).toEqual(["## Pending", "## Deploying"]);
    expect(body).not.toContain("sluiceway:rescan");
    expect(body).not.toContain("<sub>[Sluiceway]");
  });
});
