import { describe, expect, test } from "bun:test";
import { type ApplyHarness, handedOn, runApply } from "./apply-harness.ts";
import { change, inSync, pending } from "./harness.ts";

// Slice 4.5: the line that says how the deployment record ended starts with
// the dot of the job's outcome, so a person scanning the log sees the result
// at once. The dots are the ones of the recently deployed list.

const table = () => ({ "a:prod": pending("a:prod", change("bucket")) });

function ended(h: ApplyHarness): string[] {
  return h.log.lines.filter((line) => line.includes(`Deployment record ${h.deployment} ended as`));
}

describe("the result line of apply", () => {
  test("a deploy that went out is green", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    await runApply(h);
    expect(ended(h)).toEqual([`🟢 Deployment record ${h.deployment} ended as success.`]);
  });

  test("a deploy that failed is red", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.adapter.apply = async () => {
      throw new Error("the tool fell over");
    };
    await expect(runApply(h)).rejects.toThrow();
    expect(ended(h)).toEqual([`🔴 Deployment record ${h.deployment} ended as failure.`]);
  });

  test("a change that moved since the tick is refused, and yellow", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.table["a:prod"] = pending("a:prod", change("bucket"), change("queue", "create"));
    await expect(runApply(h)).rejects.toThrow("the change moved since the tick");
    expect(ended(h)).toEqual([`🟡 Deployment record ${h.deployment} ended as error.`]);
  });

  test("nothing to deploy is white", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.table["a:prod"] = inSync("a:prod");
    await runApply(h);
    expect(ended(h)).toEqual([`⚪ Deployment record ${h.deployment} ended as success.`]);
  });

  test("a rehearsal is purple", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.context.dryRun = true;
    await runApply(h);
    expect(ended(h)).toEqual([`🟣 Deployment record ${h.deployment} ended as inactive.`]);
  });
});
