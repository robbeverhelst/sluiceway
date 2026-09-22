import { describe, expect, test } from "bun:test";
import { diffHash } from "../../src/core/diff-hash.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  change,
  dashboardBody,
  drifted,
  harness,
  inSync,
  pending,
  SHA,
  tableAdapter,
} from "./harness.ts";

// Record 0055: a scan that a schedule, or a person, starts checks every stack
// for drift when `drift.enabled` is on. Drift lands on the stack's own row.

const ON = "drift:\n  enabled: true\n";
const OLD = "1111111111111111111111111111111111111111";

const gone = change("notes", "delete");
const changed = change("assets", "update");

const TABLE = {
  "app:prod": pending("app:prod", change("motd")),
  "network:dev": inSync("network:dev"),
  "site:prod": inSync("site:prod"),
};
const DRIFTS = {
  "app:prod": drifted("app:prod", changed),
  "network:dev": drifted("network:dev", gone),
};

function rowsOf(body: string) {
  return Object.fromEntries(parseDashboard(body).rows.map((row) => [row.stackId, row]));
}

describe("a scheduled scan with drift on", () => {
  test("checks every stack, and drift lands on the stack's own row", async () => {
    const adapter = tableAdapter(TABLE, {}, {}, DRIFTS);
    const { context, github } = harness(adapter, { config: ON, event: "schedule" });
    await scan(context);

    expect(adapter.driftChecked.sort()).toEqual(["app:prod", "network:dev", "site:prod"]);
    const body = dashboardBody(github);
    const rows = rowsOf(body);
    expect(rows["network:dev"]).toMatchObject({
      state: "drift",
      drift: true,
      hash: diffHash({ stackId: "network:dev", changes: [], drift: [gone] }),
    });
    expect(rows["app:prod"]).toMatchObject({
      state: "pending",
      drift: true,
      hash: diffHash({ stackId: "app:prod", changes: [change("motd")], drift: [changed] }),
    });
    expect(rows["site:prod"]).toMatchObject({ state: "in-sync", drift: false });
    expect(body).toContain("## Drifted");
    expect(body).toContain("🟠&nbsp;1 drifted");
  });

  test("a dispatch that a person started (Run workflow) checks too", async () => {
    const adapter = tableAdapter(TABLE, {}, {}, DRIFTS);
    const { context } = harness(adapter, {
      config: ON,
      event: "workflow_dispatch",
      startedByPerson: true,
    });
    await scan(context);
    expect(adapter.driftChecked).toHaveLength(3);
  });

  // `settle` dispatches a full scan after every deploy, and the rescan box
  // dispatches one too. Checking drift there would read every real resource
  // after every deploy.
  test("a dispatch by the workflow token checks nothing", async () => {
    const adapter = tableAdapter(TABLE, {}, {}, DRIFTS);
    const { context } = harness(adapter, {
      config: ON,
      event: "workflow_dispatch",
      startedByPerson: false,
    });
    await scan(context);
    expect(adapter.driftChecked).toEqual([]);
  });

  test("the drift goes to the stack's group of the job log and the summary", async () => {
    const adapter = tableAdapter(TABLE, {}, {}, DRIFTS);
    const { context, log } = harness(adapter, { config: ON, event: "schedule" });
    await scan(context);
    const group = log.groups.find((one) => one.title === "network:dev");
    expect(group?.lines).toContain("1 gone outside the code");
    expect(log.summaries.at(-1)).toContain("### Drifted");
    expect(log.lines.some((line) => line.startsWith("Checked network:dev for drift"))).toBe(true);
  });

  test("a check that fails leaves the row as the preview made it, and warns", async () => {
    const adapter = tableAdapter(
      TABLE,
      {},
      {},
      {
        "network:dev": {
          ok: false,
          reason: { kind: "tool-error", exitCode: 255 },
          detail: [],
          toolLog: "error: the backend is down\n",
        },
      },
    );
    const { context, log, github } = harness(adapter, { config: ON, event: "schedule" });
    await scan(context);
    expect(rowsOf(dashboardBody(github))["network:dev"]).toMatchObject({ state: "in-sync" });
    expect(log.warnings).toContainEqual({
      title: "Drift check failed",
      message:
        "The drift check of network:dev failed: the tool exited with an error (exit code 255). Its row shows the preview alone.",
    });
    const group = log.groups.find((one) => one.title === "network:dev");
    expect(group?.lines.join("\n")).toContain("error: the backend is down");
  });

  test("a stack whose tool cannot check drift is left as the preview made it", async () => {
    const adapter = tableAdapter(TABLE, {}, {}, { "network:dev": undefined });
    const { context, github } = harness(adapter, { config: ON, event: "schedule" });
    await scan(context);
    expect(rowsOf(dashboardBody(github))["network:dev"]).toMatchObject({ state: "in-sync" });
  });

  test("a preview that failed gets no drift check", async () => {
    const adapter = tableAdapter(
      {
        ...TABLE,
        "site:prod": {
          ok: false,
          reason: { kind: "tool-error", exitCode: 1 },
          detail: [],
          toolLog: "",
        },
      },
      {},
      {},
      DRIFTS,
    );
    const { context } = harness(adapter, { config: ON, event: "schedule" });
    await scan(context);
    expect(adapter.driftChecked).not.toContain("site:prod");
  });
});

describe("when no drift is checked", () => {
  test("with drift off, a scheduled scan checks nothing", async () => {
    const adapter = tableAdapter(TABLE, {}, {}, DRIFTS);
    const { context, github } = harness(adapter, { event: "schedule" });
    await scan(context);
    expect(adapter.driftChecked).toEqual([]);
    expect(dashboardBody(github)).not.toContain("drift");
  });

  // A push checks only the stacks whose row showed drift at its first read,
  // so known drift is not lost when their files change.
  test("a push checks only the stacks it previews whose row showed drift", async () => {
    const first = harness(tableAdapter(TABLE, {}, {}, DRIFTS), {
      config: ON,
      event: "schedule",
      sha: OLD,
      runId: "4000",
    });
    await scan(first.context);

    const adapter = tableAdapter(TABLE, {}, {}, DRIFTS);
    first.github.seedComparison(OLD, SHA, {
      status: "ahead",
      files: [{ path: "network/Pulumi.yaml" }, { path: "site/index.ts" }],
    });
    const { log, context } = harness(adapter);
    await scan({
      ...first.context,
      adapter,
      log,
      now: context.now,
      sha: SHA,
      runId: "4242",
      event: "push",
    });

    expect(adapter.previewed.sort()).toEqual(["network:dev", "site:prod"]);
    expect(adapter.driftChecked).toEqual(["network:dev"]);
    const rows = rowsOf(dashboardBody(first.github));
    expect(rows["network:dev"]).toMatchObject({ state: "drift" });
    // Carried as it was, byte for byte.
    expect(rows["app:prod"]).toMatchObject({ state: "pending", drift: true });
  });
});

// The orphan tick sweep of record 0025 treats a drifted row's box like a
// pending row's: a tick nothing picked up is cleared with the note.
describe("a tick on a drifted row that nothing picked up", () => {
  test("is cleared by the next scan with the note, and deploys nothing", async () => {
    const adapter = tableAdapter(TABLE, {}, {}, DRIFTS);
    const { context, github } = harness(adapter, { config: ON, event: "schedule" });
    await scan(context);
    const body = dashboardBody(github);
    github.editBody(1, body.replace("- [ ] **network:dev**", "- [x] **network:dev**"), {
      login: "alice",
      type: "User",
    });
    expect(rowsOf(dashboardBody(github))["network:dev"]).toMatchObject({ ticked: true });

    await scan(context);

    const swept = rowsOf(dashboardBody(github))["network:dev"];
    expect(swept).toMatchObject({ state: "drift", ticked: false });
    expect(swept?.text).toContain("a tick on this row was not picked up");
    expect(adapter.applied).toEqual([]);
  });
});

// Slice 4.7 (record 0059): drift per stack, and a drifted stack's page.
describe("drift on a stack entry", () => {
  test("turns the check off for its stacks while the top level has it on", async () => {
    const adapter = tableAdapter(TABLE, {}, {}, DRIFTS);
    const { context } = harness(adapter, {
      config: `${ON}stacks:\n  - path: network\n    drift:\n      enabled: false\n`,
      event: "schedule",
    });
    await scan(context);
    expect(adapter.driftChecked.sort()).toEqual(["app:prod", "site:prod"]);
  });

  test("turns it on for its stacks alone while the top level has it off", async () => {
    const adapter = tableAdapter(TABLE, {}, {}, DRIFTS);
    const { context, github } = harness(adapter, {
      config: "stacks:\n  - path: network\n    drift:\n      enabled: true\n",
      event: "schedule",
    });
    await scan(context);
    expect(adapter.driftChecked).toEqual(["network:dev"]);
    expect(rowsOf(dashboardBody(github))["network:dev"]).toMatchObject({ state: "drift" });
  });

  test("the same scans check: a dispatch by the workflow token does not", async () => {
    const adapter = tableAdapter(TABLE, {}, {}, DRIFTS);
    const { context } = harness(adapter, {
      config: "stacks:\n  - path: network\n    drift:\n      enabled: true\n",
      event: "workflow_dispatch",
      startedByPerson: false,
    });
    await scan(context);
    expect(adapter.driftChecked).toEqual([]);
  });
});

describe("the preview page of a drifted stack", () => {
  test("lists its drift, and the drifted row's preview link lands on it", async () => {
    const adapter = tableAdapter(TABLE, {}, {}, DRIFTS);
    const { context, github } = harness(adapter, { config: ON, event: "schedule" });
    await scan(context);
    const page = github.checkRuns(SHA).find((run) => run.name === "sluiceway / network:dev");
    expect(page?.output?.title).toBe("network:dev: 1 gone outside the code");
    expect(page?.output?.text).toContain("<kbd>gone</kbd>");
    expect(dashboardBody(github)).toContain(
      `- [ ] **network:dev** · 1 gone outside the code · [preview](${page?.htmlUrl})`,
    );
    // A pending stack that also drifted lists its drift on its page too.
    const app = github.checkRuns(SHA).find((run) => run.name === "sluiceway / app:prod");
    expect(app?.output?.text).toContain("<kbd>changed</kbd>");
  });
});
