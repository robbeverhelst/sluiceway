import { describe, expect, test } from "bun:test";
import { type ScanContext, scan } from "../../src/modes/scan.ts";
import { change, harness, pending, REPO_URL, SPINNER } from "./harness.ts";
import {
  ALICE,
  matrix,
  RESOLVE_RUN,
  type ResolveHarness,
  rowsOf,
  scanned,
  tick,
  wake,
} from "./resolve-harness.ts";

// Queued rows survive a scan (record 0056): the scan makes them from the
// queued record, as it makes a deploying row from an open one, and a queued
// record is not ended because its run is over.

const TABLE = {
  "app:prod": pending("app:prod", change("web")),
  "network:prod": pending("network:prod", change("vpc")),
  "site:prod": pending("site:prod", change("cdn")),
};

const CHAIN =
  "stacks:\n  - path: app\n    dependsOn: [network:prod]\n  - path: site\n    dependsOn: [app:prod]\n";

function scanContext(h: ResolveHarness): ScanContext {
  const { context } = harness(h.adapter);
  return { ...context, root: h.context.root, github: h.github, log: h.log, runId: "8080" };
}

async function chain(): Promise<ResolveHarness> {
  const h = await scanned(TABLE, { config: CHAIN });
  tick(h, ALICE, ["site:prod", "app:prod", "network:prod"]);
  await wake(h);
  h.github.seedRun("8080", { completed: false });
  return h;
}

const firstLine = (row: string | undefined) => row?.split("\n")[0] ?? "";

describe("a scan while a chain is under way", () => {
  test("keeps the queued rows, byte for byte, next to the deploying one", async () => {
    const h = await chain();
    const before = rowsOf(h);

    await scan(scanContext(h));

    const after = rowsOf(h);
    expect(after["app:prod"]).toBe(before["app:prod"] as string);
    expect(after["site:prod"]).toBe(before["site:prod"] as string);
    expect(firstLine(after["network:prod"])).toContain('state="deploying"');
  });

  test("makes a queued row from its record when the live body lost it", async () => {
    const h = await chain();
    const body = h.github.issue(h.number).body;
    h.github.editBody(h.number, body.replace(/^- \*\*app:prod\*\*.*\n(?: {2}.*\n)*?/m, ""), ALICE);

    await scan(scanContext(h));

    expect(firstLine(rowsOf(h)["app:prod"])).toBe(
      `- ${SPINNER}**app:prod** · queued behind **network:prod** · ticked by alice · [run](${REPO_URL}/actions/runs/${RESOLVE_RUN}) <!-- sluiceway:row stack="app:prod" state="queued" -->`,
    );
  });

  test("leaves a queued record open once its run is over, while it can still start", async () => {
    const h = await chain();
    const [first] = matrix(h) as { deployment: number }[];
    h.github.addDeploymentStatus(first?.deployment ?? 0, { state: "success", autoInactive: false });
    h.github.seedRun(RESOLVE_RUN, { completed: true });

    await scan(scanContext(h));

    expect(firstLine(rowsOf(h)["app:prod"])).toContain('state="queued"');
    const app = h.github
      .deploymentsOf("sluiceway")
      .find(({ task }) => task === "sluiceway:app:prod");
    expect(app?.status?.state).toBe("queued");
  });

  test("ends the chain when the run is over and the first layer never reported", async () => {
    const h = await chain();
    h.github.seedRun(RESOLVE_RUN, { completed: true });

    await scan(scanContext(h));

    const rows = rowsOf(h);
    expect(rows["network:prod"]).toContain(
      ":x: last deploy failed: the run ended without a result",
    );
    expect(rows["app:prod"]).toContain(
      ":x: last deploy failed: a stack it depends on did not deploy",
    );
    expect(rows["site:prod"]).toContain(
      ":x: last deploy failed: a stack it depends on did not deploy",
    );
  });
});
