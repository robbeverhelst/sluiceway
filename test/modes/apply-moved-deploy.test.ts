import { describe, expect, test } from "bun:test";
import { handedOn, rows, runApply, states } from "./apply-harness.ts";
import { change, pending } from "./harness.ts";

// Record 0058: an adapter may find, right before its tool deploys anything,
// that what the deploy would install is no longer what the fresh preview saw.
// Helm does, when the chart renders differently the second time. That is a
// moved change like the one the diff hash finds: nothing goes out, the record
// ends as error, the row is pending with its box, and the ticker is told.

const table = () => ({ "a:prod": pending("a:prod", change("bucket")) });

describe("a deploy that the adapter refuses as moved", () => {
  test("ends the record as error, keeps the row pending and tells the ticker", async () => {
    const h = await handedOn(table(), ["a:prod"], {
      deploys: { "a:prod": { ok: false, reason: { kind: "moved" }, toolLog: "" } },
    });

    const error = await runApply(h).catch((thrown: Error) => thrown);
    expect(String(error)).toContain(
      "a:prod was not deployed: the change moved since the tick. What the deploy would install changed after the fresh preview, so nothing was deployed.",
    );

    expect(states(h)).toEqual(["queued", "in_progress", "error"]);
    expect(h.github.deploymentStatuses(h.deployment).at(-1)?.description).toBe(
      "the change moved since the tick",
    );
    const row = rows(h)["a:prod"] ?? "";
    expect(row).toStartWith("- [ ] **a:prod**");
    expect(row).toContain('state="pending"');
    expect(h.github.comments(h.number)).toHaveLength(1);
    expect(h.github.comments(h.number)[0]).toContain("@alice ticked **a:prod**");
    // No second preview: the fresh one still stands, and nothing went out.
    expect(h.adapter.previewed).toEqual(["a:prod"]);
  });
});
