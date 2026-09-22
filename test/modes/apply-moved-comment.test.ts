import { describe, expect, test } from "bun:test";
import { MOVED_COMMENT_TAIL, movedComment } from "../../src/render/moved-comment.ts";
import { handedOn, runApply } from "./apply-harness.ts";
import { change, pending } from "./harness.ts";

// Slice 2.20 (record 0051): when a change moved since the tick, a red job and
// a failure line do not reach the person who ticked. One comment on the
// dashboard does, as it does for a refused tick (record 0018).

// A table of its own per run: a test changes it to move a change.
const table = () => ({
  "a:prod": pending("a:prod", change("bucket")),
  "b:prod": pending("b:prod", change("other")),
});

describe("a change that moved since the tick", () => {
  test("gets one comment that mentions the ticker once and names the stack", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.table["a:prod"] = pending("a:prod", change("bucket"), change("queue", "create"));

    await expect(runApply(h)).rejects.toThrow("the change moved since the tick");

    const comments = h.github.comments(h.number);
    expect(comments).toEqual([
      "@alice ticked **a:prod**, and the change moved since the tick, so nothing was deployed. The row on the dashboard shows the change as it is now. Tick it again to deploy that.",
    ]);
    expect(comments[0]?.match(/@alice/g)).toHaveLength(1);
    // Names only: no type, no resource name, no property path of the diff.
    expect(comments[0]).not.toContain("queue");
    expect(comments[0]).not.toContain("bucket");
    // The comment says the row shows the fresh diff, so it comes after the
    // body write.
    expect(h.github.requests.lastIndexOf("createComment")).toBeGreaterThan(
      h.github.requests.lastIndexOf("updateIssueBody"),
    );
  });

  test("a deploy that went out, one that failed, and nothing to deploy get no comment", async () => {
    const out = await handedOn(table(), ["a:prod"]);
    await runApply(out);
    expect(out.github.comments(out.number)).toEqual([]);

    const failed = await handedOn(table(), ["a:prod"], {
      deploys: {
        "a:prod": { ok: false, reason: { kind: "tool-error", exitCode: 1 }, toolLog: "" },
      },
    });
    await expect(runApply(failed)).rejects.toThrow();
    expect(failed.github.comments(failed.number)).toEqual([]);

    const empty = await handedOn(table(), ["a:prod"]);
    empty.table["a:prod"] = pending("a:prod");
    await runApply(empty);
    expect(empty.github.comments(empty.number)).toEqual([]);
  });

  test("a comment that cannot be written turns nothing back, and the job says so", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.table["a:prod"] = pending("a:prod", change("queue", "create"));
    h.github.createComment = async () => {
      throw new Error("403 Resource not accessible by integration");
    };

    await expect(runApply(h)).rejects.toThrow(
      "The comment to alice about the moved change could not be written: 403 Resource not accessible by integration.",
    );
    expect(h.github.deploymentStatuses(h.deployment).at(-1)?.state).toBe("error");
  });
});

describe("the words", () => {
  test("a stack id is text, never markup, and a login is written as GitHub gave it", () => {
    expect(movedComment({ login: "carol-x", stackId: "apps/*web*:prod" })).toBe(
      `@carol-x ticked **apps/&#42;web&#42;:prod**, and the change moved since the tick, so nothing was deployed. ${MOVED_COMMENT_TAIL}`,
    );
  });
});
