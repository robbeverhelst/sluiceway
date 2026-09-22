import { describe, expect, test } from "bun:test";
import { parseDashboard } from "../../src/render/marker.ts";
import { handedOn, runApply, states } from "./apply-harness.ts";
import { change, pending } from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";

// Slice 2.20 (record 0051): with `dry-run: true`, `apply` runs the whole path
// of a tick up to the hash check and stops. Nothing is deployed, and the
// record ends with a result of its own.

const table = () => ({
  "a:prod": pending("a:prod", change("bucket"), change("old", "delete")),
  "b:prod": pending("b:prod", change("other")),
});

async function rehearsal() {
  const h = await handedOn(table(), ["a:prod"]);
  const outputs = rememberingOutputs();
  h.context.outputs = outputs;
  h.context.dryRun = true;
  return { ...h, outputs };
}

describe("a rehearsal", () => {
  test("previews, checks the hash and deploys nothing; the record ends as rehearsed", async () => {
    const h = await rehearsal();

    await runApply(h);

    expect(h.adapter.versionChecks).toBe(1);
    expect(h.adapter.previewed).toEqual(["a:prod"]);
    expect(h.adapter.applied).toEqual([]);
    expect(states(h)).toEqual(["queued", "in_progress", "inactive"]);
    expect(h.github.deploymentStatuses(h.deployment).at(-1)?.description).toBe(
      "rehearsed, nothing was deployed",
    );
    expect(h.outputs.values.outcome).toBe("rehearsed");
    expect(h.outputs.resultFile("apply")).toMatchObject({ outcome: "rehearsed", reason: null });
  });

  test("the row is pending again with its box, and the trail says rehearsed", async () => {
    const h = await rehearsal();

    await runApply(h);

    const body = h.github.issue(h.number).body;
    const row = parseDashboard(body).rows.find((one) => one.stackId === "a:prod");
    expect(row).toMatchObject({ state: "pending", ticked: false, failed: false });
    expect(body).toContain("- [ ] **a:prod**");
    expect(body).toContain("- a:prod · ticked by alice · rehearsed, nothing was deployed · ");
    // The row never said deploying for a deploy that was never going to run.
    expect(h.github.comments(h.number)).toEqual([]);
  });

  test("the summary says what a deploy would have sent", async () => {
    const h = await rehearsal();

    await runApply(h);

    const summary = h.log.summaries.at(-1) ?? "";
    expect(summary).toContain("**a:prod** · rehearsed, nothing was deployed · ticked by alice");
    expect(summary).toContain("### What a deploy would send");
  });

  test("a change that moved is still a moved change", async () => {
    const h = await rehearsal();
    h.table["a:prod"] = pending("a:prod", change("bucket"));

    await expect(runApply(h)).rejects.toThrow("the change moved since the tick");

    expect(states(h)).toEqual(["queued", "in_progress", "error"]);
    expect(h.outputs.values.outcome).toBe("refused");
  });
});
