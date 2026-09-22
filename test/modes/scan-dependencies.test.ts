import { describe, expect, test } from "bun:test";
import type { PreviewOptions, PreviewResult } from "../../src/adapters/adapter.ts";
import { stackId } from "../../src/core/stack.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { change, dashboardBody, harness, inSync, pending, tableAdapter } from "./harness.ts";

// `dependsOn: auto` (slice 4.7, record 0059): a scan asks the adapter to read
// what a stack depends on from its stack references, only for a stack with
// auto, and puts what it read on the stack's row, where `resolve` finds it.

const AUTO = "stacks:\n  - path: app\n    dependsOn: auto\n";

// Reads network:prod when asked, and says which stacks it was handed.
function reading(result: PreviewResult, asked: string[][]) {
  return async (options: PreviewOptions): Promise<PreviewResult> => {
    if (options.dependencies === undefined || !result.ok) return result;
    asked.push(options.dependencies.map(stackId));
    return { ...result, dependencies: { stackIds: ["network:prod"], elsewhere: 1 } };
  };
}

function rowsOf(body: string) {
  return Object.fromEntries(parseDashboard(body).rows.map((row) => [row.stackId, row]));
}

describe("a stack with dependsOn: auto", () => {
  test("is previewed with the stacks of the repo, and its row carries what it read", async () => {
    const asked: string[][] = [];
    const adapter = tableAdapter({
      "app:prod": reading(pending("app:prod", change("motd")), asked),
      "network:prod": reading(inSync("network:prod"), asked),
      "site:prod": reading(inSync("site:prod"), asked),
    });
    const { context, github, log } = harness(adapter, { config: AUTO });
    await scan(context);

    // Only the stack with auto asks.
    expect(asked).toEqual([["app:prod", "network:prod", "site:prod"]]);
    const rows = rowsOf(dashboardBody(github));
    expect(rows["app:prod"]).toMatchObject({ state: "pending", dependsOn: ["network:prod"] });
    expect(rows["network:prod"]?.known && rows["network:prod"].dependsOn).toBeUndefined();
    expect(log.lines).toContain(
      "app:prod reads network:prod through its stack references. 1 stack reference names no stack of this repo that Sluiceway knows, so nothing waits on it.",
    );
  });

  test("an in sync row carries it too, so a later tick on a merge row can wait on it", async () => {
    const asked: string[][] = [];
    const adapter = tableAdapter({
      "app:prod": reading(inSync("app:prod"), asked),
      "network:prod": inSync("network:prod"),
    });
    const { context, github } = harness(adapter, { config: AUTO });
    await scan(context);
    expect(rowsOf(dashboardBody(github))["app:prod"]).toMatchObject({
      state: "in-sync",
      dependsOn: ["network:prod"],
    });
  });

  test("a repo without auto asks for nothing, and its body has no new key", async () => {
    const asked: string[][] = [];
    const adapter = tableAdapter({
      "app:prod": reading(pending("app:prod", change("motd")), asked),
      "network:prod": reading(inSync("network:prod"), asked),
    });
    const { context, github } = harness(adapter);
    await scan(context);
    expect(asked).toEqual([]);
    expect(dashboardBody(github)).not.toContain("depends-on");
  });
});
