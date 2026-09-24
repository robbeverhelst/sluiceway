import { describe, expect, test } from "bun:test";
import type { Preparation, PrepareOptions } from "../../src/adapters/adapter.ts";
import { type Stack, stackId } from "../../src/core/stack.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { handedOn, runApply, states } from "./apply-harness.ts";
import { change, dashboardBody, harness, inSync, pending, tableAdapter } from "./harness.ts";

// Slice 5.42, record 0107: a stack whose entry sets createInBackend: true is
// handed to the adapter to create in the backend, as a preparation before its
// first preview, by the scan and never by a deploy.

const CONFIG = "stacks:\n  - path: a\n    name: prod\n    createInBackend: true\n";

// An adapter whose preparations are the stacks to create, as Pulumi's are,
// and that remembers what it was asked.
function creating(events: string[], refuse: string[] = []) {
  const asked: (readonly Stack[] | undefined)[] = [];
  const prepare = (_stacks: Stack[], options?: PrepareOptions): Preparation[] => {
    asked.push(options?.createInBackend);
    return (options?.createInBackend ?? []).map((stack) => ({
      title: `the stack ${stackId(stack)} in the backend`,
      stacks: [stack],
      run: async () => {
        events.push(`create ${stackId(stack)}`);
        if (refuse.includes(stackId(stack))) {
          return {
            ok: false,
            reason: { kind: "tool-error", exitCode: 1 },
            toolLog: "error: stack 'prod' already exists\n",
          };
        }
        return {
          ok: true,
          toolLog: "Created stack 'prod'\n",
          detail: [
            `The backend did not hold ${stackId(stack)}, so the stack was created. Its preview shows every resource as a create.`,
          ],
        };
      },
    }));
  };
  return { prepare, asked };
}

describe("creating a stack in the backend from the scan", () => {
  test("the stacks whose entry asks are handed to the adapter to create, and no other, before the first preview", async () => {
    const events: string[] = [];
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("bucket")),
      "a:dev": inSync("a:dev"),
      b: inSync("b"),
    });
    const { prepare, asked } = creating(events);
    adapter.prepare = prepare;
    const preview = adapter.preview;
    adapter.preview = async (stack, options) => {
      events.push(`preview ${stackId(stack)}`);
      return preview(stack, options);
    };
    const { context, github, log } = harness(adapter, { config: CONFIG });

    await scan(context);

    expect(asked.map((stacks) => stacks?.map(stackId))).toEqual([["a:prod"]]);
    expect(events[0]).toBe("create a:prod");
    expect(events.slice(1).sort()).toEqual(["preview a:dev", "preview a:prod", "preview b"]);
    const rows = parseDashboard(dashboardBody(github)).rows;
    expect(Object.fromEntries(rows.map((row) => [row.stackId, row.state]))).toEqual({
      "a:dev": "in-sync",
      "a:prod": "pending",
      b: "in-sync",
    });
    // The group says what was done, in Sluiceway's words, then the tool's.
    const group = log.groups.find(
      (one) => one.title === "Prepared the stack a:prod in the backend",
    );
    expect(group?.lines).toEqual([
      "Stacks that need it: a:prod.",
      "The backend did not hold a:prod, so the stack was created. Its preview shows every resource as a create.",
      "The tool's own words:",
      "Created stack 'prod'",
    ]);
  });

  test("an init the tool refuses is a preview failure of that row alone, and the scan goes on", async () => {
    const events: string[] = [];
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("bucket")),
      b: inSync("b"),
    });
    adapter.prepare = creating(events, ["a:prod"]).prepare;
    const { context, github, log } = harness(adapter, { config: CONFIG });

    await scan(context);

    expect(adapter.previewed).toEqual(["b"]);
    const rows = parseDashboard(dashboardBody(github)).rows;
    expect(Object.fromEntries(rows.map((row) => [row.stackId, row.state]))).toEqual({
      "a:prod": "preview-failed",
      b: "in-sync",
    });
    const group = log.groups.find(
      (one) => one.title === "Preparing the stack a:prod in the backend failed",
    );
    expect(group?.lines).toEqual([
      "the tool exited with an error (exit code 1)",
      "Stacks that need it: a:prod.",
      "The tool's own words:",
      "error: stack 'prod' already exists",
    ]);
  });

  test("without an entry that asks, the adapter is handed nothing to create", async () => {
    const events: string[] = [];
    const adapter = tableAdapter({ "a:prod": inSync("a:prod") });
    const { prepare, asked } = creating(events);
    adapter.prepare = prepare;
    const { context } = harness(adapter);

    await scan(context);

    expect(asked).toEqual([[]]);
    expect(events).toEqual([]);
  });
});

describe("a deploy never creates a stack", () => {
  test("apply prepares the stack with nothing to create, whatever its entry says", async () => {
    const events: string[] = [];
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
      config: CONFIG,
    });
    const { prepare, asked } = creating(events);
    h.adapter.prepare = prepare;

    await runApply(h);

    expect(asked.map((stacks) => stacks?.map(stackId) ?? "none")).toEqual([[]]);
    expect(events).toEqual([]);
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
  });
});
