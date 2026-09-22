import { describe, expect, test } from "bun:test";
import { handedOn, runApply } from "./apply-harness.ts";
import { change, pending, REPO_URL, SHA } from "./harness.ts";

// Record 0072: the deploy that `apply` just finished says on the trail what
// it shipped, worked out again by `apply` with the one shared function.

const FIRST = "1111111111111111111111111111111111111111";

describe("the deploy apply finished", () => {
  test("says what it shipped since the stack's success before it", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"]);
    h.github.seedCommit({ sha: FIRST });
    h.github.seedCommit({ sha: SHA, parents: [FIRST] });
    h.github.seedPullRequest({ number: 9, author: "carol", files: ["a/index.ts"], commits: [SHA] });
    h.github.seedDeployment({
      task: "sluiceway:a:prod",
      sha: FIRST,
      // Before the clock of the harness, which starts on 2026-01-01.
      status: { state: "success", createdAt: "2025-12-31T08:00:00Z" },
      createdAt: "2025-12-31T08:00:00Z",
    });

    await runApply(h);

    const trail = h.github.issue(h.number).body.split("## Recently deployed\n\n")[1] ?? "";
    expect(trail.split("\n").slice(0, 2)).toEqual([
      expect.stringContaining("a:prod · ticked by alice"),
      `  shipped #9 by carol · [compare](${REPO_URL}/compare/111111111111...0123456789ab)`,
    ]);
  });
});
