import { describe, expect, test } from "bun:test";
import type { PreviewResult } from "../../src/adapters/adapter.ts";
import type { CostResult } from "../../src/core/cost.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { change, dashboardBody, harness, pending, RUN_ID, tableAdapter } from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";

// Record 0105: with cost.enabled the scan asks each preview for the cost of
// its change, a pending row shows what the change does to the monthly bill,
// a failed estimate is a missing line and a warning and never a red scan,
// and a stack set to on-merge whose change costs more than the threshold
// waits for a tick with its row saying why.

const priced = (id: string, monthly: number): PreviewResult => ({
  ok: true,
  diff: { stackId: id, changes: [change("motd")] },
  toolLog: "",
  cost: { ok: true, estimate: { monthly, currency: "USD" } },
});

const unpriced = (
  id: string,
  reason: Extract<CostResult, { ok: false }>["reason"],
): PreviewResult => ({
  ok: true,
  diff: { stackId: id, changes: [change("motd")] },
  toolLog: "",
  cost: { ok: false, reason, detail: ["The Infracost CLI could not be started."] },
});

function rows(body: string): Record<string, { state: string; text: string }> {
  return Object.fromEntries(
    parseDashboard(body).rows.map((row) => [row.stackId, { state: row.state, text: row.text }]),
  );
}

async function scanned(
  table: Parameters<typeof tableAdapter>[0],
  options: { config?: string; mergedBy?: string; event?: string } = {},
) {
  const outputs = rememberingOutputs();
  const adapter = tableAdapter(table);
  const { context, github, log } = harness(adapter, {
    config: options.config ?? "cost:\n  enabled: true\n",
    event: options.event ?? "push",
    outputs,
    ...(options.mergedBy === undefined ? {} : { mergedBy: options.mergedBy }),
  });
  github.seedRun(RUN_ID, { completed: false });
  await scan(context);
  const matrix = JSON.parse(outputs.values.matrix ?? "[]") as { stack: string }[];
  return { adapter, github, log, matrix, body: dashboardBody(github) };
}

describe("a scan with cost.enabled", () => {
  test("asks every preview for the estimate, and the row shows what the change costs", async () => {
    const { adapter, body, log } = await scanned({
      "app:prod": priced("app:prod", 31.2),
      "site:prod": priced("site:prod", -4),
    });
    expect(adapter.costAsked).toEqual({ "app:prod": true, "site:prod": true });
    const found = rows(body);
    expect(found["app:prod"]?.text).toContain("about **31.20 USD** more a month");
    expect(found["site:prod"]?.text).toContain("about **4.00 USD** less a month");
    expect(log.lines).toContain("app:prod costs about 31.20 USD more a month.");
    const group = log.groups.find(({ title }) => title === "app:prod");
    expect(group?.lines).toContain("cost: about 31.20 USD more a month");
  });

  test("a stack whose tool has no estimate gets no line and no warning", async () => {
    const { body, log } = await scanned({ "app:prod": pending("app:prod", change("motd")) });
    expect(rows(body)["app:prod"]?.text).not.toContain("a month");
    expect(log.warnings).toEqual([]);
  });

  test("a failed estimate is a missing line and a warning, and the scan stays green", async () => {
    const { body, log, github } = await scanned({
      "app:prod": unpriced("app:prod", { kind: "not-started" }),
    });
    expect(rows(body)["app:prod"]?.state).toBe("pending");
    expect(rows(body)["app:prod"]?.text).not.toContain("a month");
    expect(log.warnings).toEqual([
      {
        title: "Cost not estimated",
        message:
          "The cost of app:prod was not estimated: the Infracost CLI could not be started. Its row shows no cost line.",
      },
    ]);
    const group = log.groups.find(({ title }) => title === "app:prod");
    expect(group?.lines).toContain("cost not estimated: the Infracost CLI could not be started");
    expect(group?.lines).toContain("The Infracost CLI could not be started.");
    expect(github.issue(1).state).toBe("open");
  });

  test("off by default, and per stack: nothing is asked and no line is drawn", async () => {
    const off = await scanned({ "app:prod": pending("app:prod", change("motd")) }, { config: "" });
    expect(off.adapter.costAsked).toEqual({ "app:prod": false });
    expect(rows(off.body)["app:prod"]?.text).not.toContain("a month");
    const perStack = await scanned(
      { "app:prod": priced("app:prod", 31.2), "site:prod": priced("site:prod", 1) },
      {
        config:
          "cost:\n  enabled: true\nstacks:\n  - path: site\n    cost:\n      enabled: false\n",
      },
    );
    expect(perStack.adapter.costAsked).toEqual({ "app:prod": true, "site:prod": false });
  });
});

describe("the cost threshold on a stack set to on-merge", () => {
  const CONFIG =
    "cost:\n  enabled: true\n  threshold: 100\nstacks:\n  - path: app\n    deploy: on-merge\n";

  test("a change under the threshold goes out on merge", async () => {
    const { matrix, body } = await scanned(
      { "app:prod": priced("app:prod", 99) },
      { config: CONFIG, mergedBy: "alice" },
    );
    expect(matrix.map(({ stack }) => stack)).toEqual(["app:prod"]);
    expect(rows(body)["app:prod"]?.state).toBe("deploying");
  });

  test("a change over the threshold waits for a tick, and the row and the log say why", async () => {
    const { matrix, body, log } = await scanned(
      { "app:prod": priced("app:prod", 120.5) },
      { config: CONFIG, mergedBy: "alice" },
    );
    expect(matrix).toEqual([]);
    const row = rows(body)["app:prod"];
    expect(row?.state).toBe("pending");
    expect(row?.text).toContain("about **120.50 USD** more a month");
    expect(row?.text).toContain(
      ":information_source: this stack deploys on merge, and this change waits for a tick: it costs about **120.50 USD** more a month, above the threshold of 100.00 USD.",
    );
    expect(log.lines).toContain(
      "app:prod deploys on merge, and this change waits for a tick: it costs about 120.50 USD more a month, above the threshold of 100.00 USD.",
    );
  });

  test("a failed estimate waits too: the gate fails closed", async () => {
    const { matrix, body } = await scanned(
      { "app:prod": unpriced("app:prod", { kind: "exited", exitCode: 1 }) },
      { config: CONFIG, mergedBy: "alice" },
    );
    expect(matrix).toEqual([]);
    expect(rows(body)["app:prod"]?.text).toContain(
      "its cost could not be estimated, and `cost.threshold` is set to 100.00.",
    );
  });

  test("a stack's own threshold wins over the top level", async () => {
    const { matrix } = await scanned(
      { "app:prod": priced("app:prod", 120.5) },
      {
        config:
          "cost:\n  enabled: true\n  threshold: 100\nstacks:\n  - path: app\n    deploy: on-merge\n    cost:\n      threshold: 500\n",
        mergedBy: "alice",
      },
    );
    expect(matrix.map(({ stack }) => stack)).toEqual(["app:prod"]);
  });
});
