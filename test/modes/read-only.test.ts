import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { READ_ONLY_LINE } from "../../src/render/voice.ts";
import type { FakeGitHub } from "../fake-github/fake-github.ts";
import { handedOn, runApply } from "./apply-harness.ts";
import { change, dashboardBody, harness, inSync, pending, tableAdapter } from "./harness.ts";
import { ALICE, rowsOf, scanned, tick, wake } from "./resolve-harness.ts";

// Slice 2.17 (onboarding log, hurdle 16): `dashboard.readOnly` is for a
// workflow that only scans. Nothing there acts on a box, so no writer draws
// one, and a tick left over from before the switch is dropped without a note.

const READ_ONLY = "dashboard:\n  readOnly: true\n";

const TABLE = {
  "a:prod": pending("a:prod", change("logs")),
  "b:prod": inSync("b:prod"),
};

function rowOf(github: FakeGitHub, id: string) {
  const found = parseDashboard(dashboardBody(github)).rows.find((one) => one.stackId === id);
  if (!found?.known) throw new Error(`The dashboard has no row for ${id}.`);
  return found;
}

// Everything a person could tick: a row's box or the rescan box.
function boxes(body: string): string[] {
  return body.split("\n").filter((line) => /^\s*- \[[ xX]\]/.test(line));
}

describe("a scan with dashboard.readOnly: true", () => {
  test("writes pending rows without boxes, the line that says so, and no rescan box", async () => {
    const { context, github } = harness(tableAdapter(TABLE), { config: READ_ONLY });

    await scan(context);

    const body = dashboardBody(github);
    expect(boxes(body)).toEqual([]);
    expect(body).toContain(`## Pending\n\n${READ_ONLY_LINE}\n\n- **a:prod** · 1 update · `);
    expect(body).not.toContain("sluiceway:rescan");
    expect(rowOf(github, "a:prod")).toMatchObject({ state: "pending", ticked: false });
  });

  test("drops a tick left from before the switch, with no note and no look for a resolve run", async () => {
    const before = harness(tableAdapter(TABLE));
    await scan(before.context);
    const body = dashboardBody(before.github);
    before.github.editBody(1, body.replace("- [ ] **a:prod**", "- [x] **a:prod**"), ALICE);
    expect(rowOf(before.github, "a:prod").ticked).toBe(true);

    const { github } = before;
    const after = harness(tableAdapter(TABLE), { config: READ_ONLY, github });
    github.requests.length = 0;
    await scan(after.context);

    const row = rowOf(github, "a:prod");
    expect(row.ticked).toBe(false);
    expect(row.text).not.toContain("was not picked up");
    expect(boxes(dashboardBody(github))).toEqual([]);
    expect(github.requests).not.toContain("listIssuesRuns");
    expect(github.requests).not.toContain("createDeployment");
  });
});

// The switch is about drawing, not a lock: a workflow that has a `resolve`
// job acts on a box it finds. Every writer still renders the dashboard the
// same way, so nothing it writes brings a box back.
describe("the other writers with dashboard.readOnly: true", () => {
  test("resolve writes the body without the rescan box", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod"]);
    writeFileSync(join(h.context.root, "sluiceway.yaml"), READ_ONLY);

    await wake(h);

    expect(rowsOf(h)["a:prod"]).toContain("waiting to start · ticked by alice");
    expect(dashboardBody(h.github)).not.toContain("sluiceway:rescan");
  });

  test("apply writes a fresh pending row without a box", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("logs")) }, ["a:prod"]);
    h.table["a:prod"] = pending("a:prod", change("logs"), change("queue", "create"));
    writeFileSync(join(h.context.root, "sluiceway.yaml"), READ_ONLY);

    await expect(runApply(h)).rejects.toThrow("the change moved since the tick");

    const body = dashboardBody(h.github);
    expect(boxes(body)).toEqual([]);
    expect(body).toContain("- **a:prod** · 1 create, 1 update · ");
    expect(body).toContain(READ_ONLY_LINE);
  });
});
