import { describe, expect, test } from "bun:test";
import type { PreviewResult, SavedPlan } from "../../src/adapters/adapter.ts";
import { type ApplyHarness, handedOn, runApply, states } from "./apply-harness.ts";
import { change, pending } from "./harness.ts";

// A tool that can save a plan deploys exactly the plan whose diff hash the
// tick approved (record 0053): `apply` asks its fresh preview to keep the
// plan, hands that plan to the deploy, and lets it go on every way out.

interface Planned {
  plans: { plan: SavedPlan; disposed: boolean }[];
  asked: (boolean | undefined)[];
  deployedWith: (SavedPlan | undefined)[];
}

// Every preview that is asked to keep its plan gives a new one.
function savingPlans(h: ApplyHarness): Planned {
  const planned: Planned = { plans: [], asked: [], deployedWith: [] };
  const preview = h.adapter.preview;
  h.adapter.preview = async (stack, options) => {
    planned.asked.push(options.savePlan);
    const result: PreviewResult = await preview(stack, options);
    if (!options.savePlan || !result.ok) return result;
    const entry = { plan: {} as SavedPlan, disposed: false };
    entry.plan = {
      dispose: async () => {
        entry.disposed = true;
      },
    };
    planned.plans.push(entry);
    return { ...result, plan: entry.plan };
  };
  const deploy = h.adapter.apply;
  h.adapter.apply = async (stack, context, plan) => {
    planned.deployedWith.push(plan);
    return deploy(stack, context, plan);
  };
  return planned;
}

const table = () => ({ "a:prod": pending("a:prod", change("bucket")) });

describe("a saved plan", () => {
  test("the deploy gets the plan of the fresh preview, which is let go afterwards", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    const planned = savingPlans(h);

    await runApply(h);

    expect(planned.asked).toEqual([true]);
    expect(planned.plans).toHaveLength(1);
    expect(planned.deployedWith).toEqual([planned.plans[0]?.plan]);
    expect(planned.plans[0]?.disposed).toBe(true);
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
  });

  test("a change that moved deploys nothing, and the plan is let go", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.table["a:prod"] = pending("a:prod", change("bucket"), change("queue", "create"));
    const planned = savingPlans(h);

    await expect(runApply(h)).rejects.toThrow("the change moved since the tick");

    expect(planned.deployedWith).toEqual([]);
    expect(planned.plans.map((one) => one.disposed)).toEqual([true]);
  });

  test("a rehearsal deploys nothing, and the plan is let go", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.context.dryRun = true;
    const planned = savingPlans(h);

    await runApply(h);

    expect(planned.deployedWith).toEqual([]);
    expect(planned.plans.map((one) => one.disposed)).toEqual([true]);
  });

  test("the preview after a failed deploy keeps no plan", async () => {
    const h = await handedOn(table(), ["a:prod"], {
      deploys: {
        "a:prod": { ok: false, reason: { kind: "tool-error", exitCode: 1 }, toolLog: "" },
      },
    });
    const planned = savingPlans(h);

    await expect(runApply(h)).rejects.toThrow();

    expect(planned.asked).toEqual([true, undefined]);
    expect(planned.plans.map((one) => one.disposed)).toEqual([true]);
  });
});

describe("preparing the stack before its fresh preview", () => {
  test("a failed preparation ends the record as a failed preview, and the tool deploys nothing", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.adapter.prepare = (stacks) => [
      {
        title: "a",
        stacks,
        run: async () => ({ ok: false, reason: { kind: "tool-error", exitCode: 1 }, toolLog: "" }),
      },
    ];

    await expect(runApply(h)).rejects.toThrow(
      "the preview before the deploy failed: the tool exited with an error (exit code 1)",
    );

    expect(h.adapter.previewed).toEqual([]);
    expect(h.adapter.applied).toEqual([]);
  });

  test("a preparation that works runs once, before the fresh preview", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    const events: string[] = [];
    h.adapter.prepare = (stacks) => [
      {
        title: "a",
        stacks,
        run: async () => {
          events.push("prepare");
          return { ok: true, toolLog: "" };
        },
      },
    ];
    const preview = h.adapter.preview;
    h.adapter.preview = async (stack, options) => {
      events.push("preview");
      return preview(stack, options);
    };

    await runApply(h);

    expect(events).toEqual(["prepare", "preview"]);
    expect(h.adapter.applied).toEqual(["a:prod"]);
  });
});
