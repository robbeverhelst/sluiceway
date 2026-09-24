import { describe, expect, test } from "bun:test";
import type { Change } from "../../src/core/diff.ts";
import { valueFingerprint } from "../../src/core/value-fingerprint.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { VALUE_EVERY_RUN_NOTE } from "../../src/render/row.ts";
import { handedOn, rows, runApply, states } from "./apply-harness.ts";
import {
  change,
  dashboardBody,
  drifted,
  harness,
  inSync,
  pending,
  RUN_ID,
  SHA,
  tableAdapter,
} from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";
import { ALICE, matrix, scanned, tick, wake } from "./resolve-harness.ts";

// Slice 5.37 (record 0102): a tick covers the values a row does not show. The
// adapter is a table, so the fingerprint of a change is whatever the table
// says: what is under test is that it travels from the row to the record and
// is compared by `apply`, and what the dashboard says when it differs.

const F1 = "1111111111111111";
const F2 = "2222222222222222";

function fingerprinted(name: string, fingerprint: string, op: Change["op"] = "update"): Change {
  return { ...change(name, op), fingerprint };
}

const withF1 = () => ({
  "a:prod": pending("a:prod", fingerprinted("web", F1)),
  "b:prod": pending("b:prod", change("other")),
});

function markerOf(body: string, id: string): string | undefined {
  const row = parseDashboard(body).rows.find((one) => one.stackId === id);
  return row?.known ? row.fingerprint : undefined;
}

function rowText(body: string, id: string): string {
  return parseDashboard(body).rows.find((one) => one.stackId === id)?.text ?? "";
}

describe("a scan", () => {
  test("writes the fingerprint of the diff on a pending row and a drifted row, and none on a row without one", async () => {
    const table = { ...withF1(), "c:prod": inSync("c:prod") };
    const adapter = tableAdapter(
      table,
      {},
      {},
      {
        "c:prod": drifted("c:prod", fingerprinted("bucket", F2)),
      },
    );
    const { context, github } = harness(adapter, {
      config: "drift:\n  enabled: true\n",
      event: "schedule",
    });

    await scan(context);

    const body = dashboardBody(github);
    const a = table["a:prod"];
    expect(markerOf(body, "a:prod")).toBe(a.ok ? valueFingerprint(a.diff) : "");
    expect(markerOf(body, "a:prod")).toMatch(/^[0-9a-f]{16}$/);
    expect(markerOf(body, "b:prod")).toBeUndefined();
    expect(rowText(body, "c:prod")).toContain('state="drift"');
    expect(markerOf(body, "c:prod")).toMatch(/^[0-9a-f]{16}$/);
  });

  test("asks every preview for the fingerprint, unless the repo or the stack turns it off", async () => {
    const on = tableAdapter(withF1());
    await scan(harness(on).context);
    expect(on.fingerprintAsked).toEqual({ "a:prod": true, "b:prod": true });

    const repoOff = tableAdapter(withF1());
    await scan(harness(repoOff, { config: "valueFingerprint: false\n" }).context);
    expect(repoOff.fingerprintAsked).toEqual({ "a:prod": false, "b:prod": false });

    const stackOff = tableAdapter(withF1());
    await scan(
      harness(stackOff, { config: "stacks:\n  - path: a\n    valueFingerprint: false\n" }).context,
    );
    expect(stackOff.fingerprintAsked).toEqual({ "a:prod": false, "b:prod": true });
  });

  test("says on the row when a value differed between two previews of the commit of the last scan, and not at another commit", async () => {
    const table = withF1();
    const adapter = tableAdapter(table);
    const { context, github } = harness(adapter);
    await scan(context);
    expect(rowText(dashboardBody(github), "a:prod")).not.toContain(VALUE_EVERY_RUN_NOTE);

    table["a:prod"] = pending("a:prod", fingerprinted("web", F2));
    await scan(context);
    expect(rowText(dashboardBody(github), "a:prod")).toContain(`  ${VALUE_EVERY_RUN_NOTE}\n`);
    expect(rowText(dashboardBody(github), "b:prod")).not.toContain(VALUE_EVERY_RUN_NOTE);

    table["a:prod"] = pending("a:prod", fingerprinted("web", F1));
    context.sha = "fedcba9876543210fedcba9876543210fedcba98";
    await scan(context);
    expect(rowText(dashboardBody(github), "a:prod")).not.toContain(VALUE_EVERY_RUN_NOTE);
  });
});

describe("a tick", () => {
  test("puts the row's fingerprint on the record, and none when the row has none", async () => {
    const h = await scanned(withF1());
    const body = dashboardBody(h.github);
    tick(h, ALICE, ["a:prod", "b:prod"]);

    await wake(h);

    const entries = matrix(h) as { stack: string; deployment: number }[];
    const payloads = Object.fromEntries(
      entries.map(({ stack, deployment }) => [
        stack,
        (h.github.deployment(deployment).payload as { fingerprint?: string }).fingerprint,
      ]),
    );
    expect(payloads).toEqual({ "a:prod": markerOf(body, "a:prod"), "b:prod": undefined });
    expect(payloads["a:prod"]).toMatch(/^[0-9a-f]{16}$/);
  });

  test("a queued record keeps it", async () => {
    const h = await scanned(withF1(), {
      config: "stacks:\n  - path: a\n    dependsOn: [b:prod]\n",
    });
    const body = dashboardBody(h.github);
    tick(h, ALICE, ["a:prod", "b:prod"]);

    await wake(h);

    const queued = h.github
      .deploymentsOf("sluiceway")
      .find((record) => record.task === "sluiceway:a:prod");
    expect(queued?.payload).toMatchObject({
      behind: ["b:prod"],
      fingerprint: markerOf(body, "a:prod"),
    });
  });

  test("an on-merge record carries it", async () => {
    const outputs = rememberingOutputs();
    const { context, github } = harness(tableAdapter(withF1()), {
      config: "stacks:\n  - path: a\n    deploy: on-merge\n",
      event: "push",
      outputs,
      mergedBy: "alice",
    });
    github.seedRun(RUN_ID, { completed: false });

    await scan(context);

    const [entry] = JSON.parse(outputs.values.matrix ?? "[]") as { deployment: number }[];
    const payload = github.deployment(entry?.deployment ?? 0).payload as Record<string, unknown>;
    expect(payload.onMerge).toBe(true);
    expect(payload.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("apply", () => {
  const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";

  test("refuses a value that changed since the tick: the record ends as error, the row shows the fresh diff with the failure line, and the ticker gets one comment", async () => {
    const h = await handedOn(withF1(), ["a:prod"]);
    h.table["a:prod"] = pending("a:prod", fingerprinted("web", F2));
    h.context.sha = OTHER_SHA;

    await expect(runApply(h)).rejects.toThrow("a value changed since the tick");

    expect(states(h).at(-1)).toBe("error");
    expect(h.github.deploymentStatuses(h.deployment).at(-1)?.description).toBe(
      "a value changed since the tick",
    );
    expect(h.adapter.applied).toEqual([]);
    const row = rows(h)["a:prod"] ?? "";
    expect(row.split("\n")[0]).toStartWith("- [ ] **a:prod**");
    expect(row).toContain(
      ":x: last deploy failed: a value changed since the tick · ticked by alice",
    );
    expect(row).toContain(`fingerprint="${markerFrom(h.table["a:prod"])}"`);
    expect(h.github.comments(h.number)).toEqual([
      "@alice ticked **a:prod**, and a value the row does not show changed since the tick, so nothing was deployed. The row on the dashboard shows the change as it is now. Look at it and tick it again to deploy that.",
    ]);
  });

  test("at the commit of the last scan the reason and the comment say the value differs on every run, and name the switch", async () => {
    const h = await handedOn(withF1(), ["a:prod"]);
    h.table["a:prod"] = pending("a:prod", fingerprinted("web", F2));

    await expect(runApply(h)).rejects.toThrow("may differ on every run");

    expect(h.github.deploymentStatuses(h.deployment).at(-1)?.description).toBe(
      "a value changed since the tick with no new commit, so it may differ on every run: see valueFingerprint in sluiceway.yaml",
    );
    expect(rows(h)["a:prod"]).toContain("see valueFingerprint in sluiceway.yaml · ticked by alice");
    expect(h.github.comments(h.number)).toEqual([
      "@alice ticked **a:prod**, and a value the row does not show changed between the tick and the deploy with no new commit in between, so nothing was deployed. A value in the program may differ on every run, and no tick can approve it while the value fingerprint is on. Turn it off for this stack with `valueFingerprint: false` on its `stacks` entry in `sluiceway.yaml`, then tick again.",
    ]);
  });

  test("refuses a record without a fingerprint when the fresh preview gives one", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("web")) }, ["a:prod"]);
    h.table["a:prod"] = pending("a:prod", fingerprinted("web", F1));
    h.context.sha = OTHER_SHA;

    await expect(runApply(h)).rejects.toThrow("a value changed since the tick");
    expect(h.adapter.applied).toEqual([]);
  });

  test("deploys when the fresh preview gives none: the check is off, or nothing to cover", async () => {
    const h = await handedOn(withF1(), ["a:prod"]);
    h.table["a:prod"] = pending("a:prod", change("web"));

    await runApply(h);

    expect(h.adapter.applied).toEqual(["a:prod"]);
    expect(states(h).at(-1)).toBe("success");
  });

  test("deploys the same fingerprint, and a rehearsal stops after the check", async () => {
    const same = await handedOn(withF1(), ["a:prod"]);
    await runApply(same);
    expect(same.adapter.applied).toEqual(["a:prod"]);

    const rehearsal = await handedOn(withF1(), ["a:prod"]);
    rehearsal.context.dryRun = true;
    await runApply(rehearsal);
    expect(rehearsal.adapter.applied).toEqual([]);
    expect(states(rehearsal).at(-1)).toBe("inactive");

    const refused = await handedOn(withF1(), ["a:prod"]);
    refused.context.dryRun = true;
    refused.table["a:prod"] = pending("a:prod", fingerprinted("web", F2));
    await expect(runApply(refused)).rejects.toThrow("a value changed since the tick");
  });

  test("the switch reaches the fresh preview", async () => {
    const h = await handedOn(withF1(), ["a:prod"], {
      config: "stacks:\n  - path: a\n    valueFingerprint: false\n",
    });
    await runApply(h);
    expect(h.adapter.fingerprintAsked["a:prod"]).toBe(false);
  });
});

function markerFrom(result: ReturnType<typeof pending>): string {
  return result.ok ? (valueFingerprint(result.diff) ?? "") : "";
}

// The fixed commit of the harness is what every record and run is of, so a
// refusal there is the every-run one unless a test moves the commit.
void SHA;
