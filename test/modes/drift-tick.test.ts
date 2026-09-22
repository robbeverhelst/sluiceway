import { describe, expect, test } from "bun:test";
import type { DriftResult } from "../../src/adapters/adapter.ts";
import { diffHash } from "../../src/core/diff-hash.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { handedOn, rows, runApply, states } from "./apply-harness.ts";
import { change, drifted, inSync, pending } from "./harness.ts";
import { RESOLVE_RUN } from "./resolve-harness.ts";

// Record 0055: a tick on a drifted row deploys, and the deploy puts the drift
// back. The row's marker says its hash covers drift, `resolve` carries that on
// the deployment record, and `apply` checks drift again before it compares.

const ON = "drift:\n  enabled: true\n";
const gone = change("notes", "delete");

function table() {
  return {
    "network:dev": inSync("network:dev"),
    "site:prod": pending("site:prod", change("logs")),
  };
}

function marker(text: string | undefined) {
  return parseDashboard(text ?? "").rows[0];
}

describe("a tick on a drifted row", () => {
  test("resolve starts a deploy, and the record says the hash covers drift", async () => {
    const drifts = { "network:dev": drifted("network:dev", gone) };
    const h = await handedOn(table(), ["network:dev"], { config: ON, event: "schedule", drifts });
    const hash = diffHash({ stackId: "network:dev", changes: [], drift: [gone] });
    expect(h.github.deployment(h.deployment)).toMatchObject({
      task: "sluiceway:network:dev",
      payload: { v: 1, hash, ticker: "alice", run: RESOLVE_RUN, drift: true },
      status: { state: "queued" },
    });
    expect(marker(rows(h)["network:dev"])).toMatchObject({ state: "deploying" });
  });

  test("apply checks drift again, deploys with the repair, and the row is in sync", async () => {
    const drifts = { "network:dev": drifted("network:dev", gone) };
    const h = await handedOn(table(), ["network:dev"], { config: ON, event: "schedule", drifts });
    h.adapter.driftChecked.length = 0;

    await runApply(h);

    expect(h.adapter.driftChecked).toEqual(["network:dev"]);
    expect(h.adapter.applied).toEqual(["network:dev"]);
    expect(h.adapter.repaired).toEqual(["network:dev"]);
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
    expect(marker(rows(h)["network:dev"])).toMatchObject({ state: "in-sync", drift: false });
    expect(h.log.lines).toContain(
      "Checked network:dev for drift again, because the diff hash the tick approved covers drift.",
    );
    // Slice 4.7 (record 0059): the trail says the deploy put the drift back.
    expect(h.github.issue(1).body).toContain(
      "- 🟢&nbsp;network:dev · ticked by alice · put back what changed outside the code · ",
    );
  });

  test("drift that moved after the tick stops the deploy, and the row shows the fresh drift", async () => {
    const drifts: Record<string, DriftResult> = { "network:dev": drifted("network:dev", gone) };
    const h = await handedOn(table(), ["network:dev"], { config: ON, event: "schedule", drifts });
    drifts["network:dev"] = drifted("network:dev", gone, change("assets", "update"));

    await expect(runApply(h)).rejects.toThrow("the change moved");

    expect(h.adapter.applied).toEqual([]);
    expect(states(h).at(-1)).toBe("error");
    const row = marker(rows(h)["network:dev"]);
    expect(row).toMatchObject({ state: "drift", drift: true });
    expect(row?.known && row.hash).toBe(
      diffHash({
        stackId: "network:dev",
        changes: [],
        drift: [gone, change("assets", "update")],
      }),
    );
  });

  test("drift put back outside the dashboard leaves nothing to deploy", async () => {
    const drifts: Record<string, DriftResult> = { "network:dev": drifted("network:dev", gone) };
    const h = await handedOn(table(), ["network:dev"], { config: ON, event: "schedule", drifts });
    delete drifts["network:dev"];

    await runApply(h);

    expect(h.adapter.applied).toEqual([]);
    expect(states(h).at(-1)).toBe("success");
    expect(marker(rows(h)["network:dev"])).toMatchObject({ state: "in-sync" });
  });

  test("a failed drift check stops the deploy, as a failed preview does", async () => {
    const drifts: Record<string, DriftResult> = { "network:dev": drifted("network:dev", gone) };
    const h = await handedOn(table(), ["network:dev"], { config: ON, event: "schedule", drifts });
    drifts["network:dev"] = {
      ok: false,
      reason: { kind: "tool-error", exitCode: 255 },
      detail: [],
      toolLog: "",
    };

    await expect(runApply(h)).rejects.toThrow();

    expect(h.adapter.applied).toEqual([]);
    expect(states(h).at(-1)).toBe("failure");
  });
});

describe("a tick on a row without drift", () => {
  test("carries no drift on the record, checks no drift, and deploys without the repair", async () => {
    const drifts = { "network:dev": drifted("network:dev", gone) };
    const h = await handedOn(table(), ["site:prod"], { config: ON, event: "schedule", drifts });
    expect(h.github.deployment(h.deployment).payload).not.toHaveProperty("drift");
    h.adapter.driftChecked.length = 0;

    await runApply(h);

    expect(h.adapter.driftChecked).toEqual([]);
    expect(h.adapter.applied).toEqual(["site:prod"]);
    expect(h.adapter.repaired).toEqual([]);
  });
});
