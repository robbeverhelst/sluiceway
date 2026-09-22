import { describe, expect, test } from "bun:test";
import type { Preparation, PrepareResult } from "../../src/adapters/adapter.ts";
import { type Stack, stackId } from "../../src/core/stack.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { change, dashboardBody, harness, inSync, pending, tableAdapter } from "./harness.ts";

// Some tools need a step before a preview, such as OpenTofu's init of a
// directory. The scan runs every one of them in turn, before the pool starts,
// because inits run side by side corrupted stacks in the first user's earlier
// dashboard (record 0053).

// Groups stacks by the part of their id before the colon, and answers each
// group with the result the test gives, after a pause, so that two runs at
// once would overlap.
function preparing(results: Record<string, PrepareResult>, events: string[]) {
  return (stacks: Stack[]): Preparation[] => {
    const byPath = Map.groupBy(stacks, (stack) => stack.path);
    return [...byPath].map(([path, grouped]) => ({
      title: path,
      stacks: grouped,
      run: async (context) => {
        events.push(`start ${path} ${context.timeoutMinutes}`);
        await new Promise((done) => setTimeout(done, 5));
        events.push(`end ${path}`);
        return results[path] ?? { ok: true, toolLog: "" };
      },
    }));
  };
}

describe("preparing stacks before the pool", () => {
  test("runs each preparation alone, all of them before the first preview", async () => {
    const events: string[] = [];
    const adapter = tableAdapter({
      "a:dev": pending("a:dev", change("x")),
      "a:prod": inSync("a:prod"),
      b: inSync("b"),
    });
    adapter.prepare = preparing({}, events);
    const preview = adapter.preview;
    adapter.preview = async (asked, options) => {
      events.push(`preview ${stackId(asked)}`);
      return preview(asked, options);
    };
    const { context, log } = harness(adapter, {
      config: "stacks:\n  - path: b\n    previewTimeout: 25\n",
    });

    await scan(context);

    expect(events.slice(0, 4)).toEqual(["start a 10", "end a", "start b 25", "end b"]);
    expect(events.slice(4).sort()).toEqual(["preview a:dev", "preview a:prod", "preview b"]);
    expect(log.groups.map((group) => group.title)).toContain("Prepared a");
  });

  test("a failed preparation is a preview failure for each of its stacks, which are not previewed", async () => {
    const events: string[] = [];
    const adapter = tableAdapter({
      "a:dev": inSync("a:dev"),
      "a:prod": inSync("a:prod"),
      b: inSync("b"),
    });
    adapter.prepare = preparing(
      {
        a: {
          ok: false,
          reason: { kind: "tool-error", exitCode: 1 },
          toolLog: "Error: no backend\n",
        },
      },
      events,
    );
    const { context, github, log } = harness(adapter);

    await scan(context);

    expect(adapter.previewed).toEqual(["b"]);
    const rows = parseDashboard(dashboardBody(github)).rows;
    expect(Object.fromEntries(rows.map((row) => [row.stackId, row.state]))).toEqual({
      "a:dev": "preview-failed",
      "a:prod": "preview-failed",
      b: "in-sync",
    });
    // The tool's words go to the job log, once, in the group of the
    // preparation (record 0022).
    const group = log.groups.find((one) => one.title === "Preparing a failed");
    expect(group?.lines).toEqual([
      "the tool exited with an error (exit code 1)",
      "Stacks that need it: a:dev, a:prod.",
      "The tool's own words:",
      "Error: no backend",
    ]);
    const stackGroup = log.groups.find((one) => one.title === "a:dev");
    expect(stackGroup?.lines).toEqual([
      "preview failed: the tool exited with an error (exit code 1)",
      'The tool could not prepare "a". Its group in the job log holds the tool\'s own words.',
    ]);
  });

  test("an adapter without preparations previews as before", async () => {
    const adapter = tableAdapter({ "a:prod": inSync("a:prod") });
    const { context, log } = harness(adapter);
    await scan(context);
    expect(adapter.previewed).toEqual(["a:prod"]);
    expect(log.groups.map((group) => group.title)).toEqual(["a:prod"]);
  });
});
