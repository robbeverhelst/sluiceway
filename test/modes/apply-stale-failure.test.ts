import { describe, expect, test } from "bun:test";
import { outsideMarker, parseDashboard } from "../../src/render/marker.ts";
import { type ApplyHarness, handedOn, runApply } from "./apply-harness.ts";
import { change, pending } from "./harness.ts";

// Record 0076: the row `apply` swaps in shows the failure line only while no
// deploy of its stack, from the dashboard or outside it, ended after the
// failure. `apply` reads no history, so an outside deploy is one whose line
// the body carries (record 0073). Its own record is always the newest, so the
// rule matters when that record is no deploy fact: a rehearsal.

// The fake writes its own records from 2026-01-01 on, so these come before.
const FAILED_AT = "2025-12-31T23:00:00Z";

async function rehearsalAfterFailure(outsideAt: string): Promise<ApplyHarness> {
  const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"]);
  h.context.dryRun = true;
  h.github.seedDeployment({
    task: "sluiceway:a:prod",
    payload: { v: 1, hash: "2b44350653e84a11", ticker: "carol", run: "70" },
    createdAt: "2025-12-31T22:58:00Z",
    status: {
      state: "failure",
      description: "the tool exited with an error (exit code 255)",
      createdAt: FAILED_AT,
    },
  });
  const line = `- a:prod · deployed outside the dashboard ${outsideMarker({
    stackId: "a:prod",
    kind: "deploy",
    at: new Date(outsideAt),
  })}`;
  const body = h.github.issue(h.number).body;
  h.github.editBody(h.number, `${body}\n\n${line}\n`);
  return h;
}

function rowOf(h: ApplyHarness) {
  return parseDashboard(h.github.issue(h.number).body).rows.find((row) => row.stackId === "a:prod");
}

describe("the row apply writes", () => {
  test("has no failure line when a deploy outside the dashboard ended after the failure", async () => {
    const h = await rehearsalAfterFailure("2025-12-31T23:30:00Z");

    await runApply(h);

    expect(rowOf(h)).toMatchObject({ state: "pending", failed: false });
    expect(rowOf(h)?.text).not.toContain("last deploy failed");
    // The trail keeps the failed deploy.
    expect(h.github.issue(h.number).body).toContain("a:prod · failed · carol");
  });

  test("keeps the failure line when the outside deploy ended before the failure", async () => {
    const h = await rehearsalAfterFailure("2025-12-31T22:00:00Z");

    await runApply(h);

    expect(rowOf(h)).toMatchObject({ state: "pending", failed: true });
    expect(rowOf(h)?.text).toContain(
      ":x: last deploy failed: the tool exited with an error (exit code 255) · ticked by carol",
    );
  });
});
