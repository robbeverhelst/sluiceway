import { describe, expect, test } from "bun:test";
import { handedOn, rows, runApply, states } from "./apply-harness.ts";
import { change, pending } from "./harness.ts";
import { RESOLVE_RUN_URL } from "./resolve-harness.ts";

// The apply mode (records 0008, 0019, 0021 and 0035): the job that deploys one
// stack from the deployment record `resolve` handed on. Only what the row
// showed goes out, and a re-run deploys nothing.

describe("a deploy that goes out", () => {
  test("the record ends as success, the stack deployed once, and its row is in sync", async () => {
    const h = await handedOn(
      { "a:prod": pending("a:prod", change("bucket")), "b:prod": pending("b:prod", change("x")) },
      ["a:prod"],
    );
    const before = rows(h)["b:prod"];

    await runApply(h);

    expect(h.adapter.applied).toEqual(["a:prod"]);
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
    expect(rows(h)["a:prod"]).toBe(
      '- a:prod <!-- sluiceway:row stack="a:prod" state="in-sync" -->\n  <!-- /sluiceway:row -->',
    );
    // Every other row is carried byte for byte (record 0004).
    expect(rows(h)["b:prod"]).toBe(before);
    // Recently deployed names the deploy and the run that made it.
    const recently = h.github.issue(h.number).body.split("## Recently deployed\n\n")[1] ?? "";
    expect(recently.split("\n")[0]).toStartWith("- a:prod · ticked by alice · ");
    expect(recently.split("\n")[0]).toEndWith(` · [run](${RESOLVE_RUN_URL})`);
  });
});
