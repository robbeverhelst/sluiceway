import { describe, expect, test } from "bun:test";
import { change, pending, REPO_URL, SHA } from "./harness.ts";
import { ALICE, scanned, tick, wake } from "./resolve-harness.ts";

// Record 0072: `resolve` writes the trail too, and works out again what each
// deploy on it shipped, up to the `scan-sha` of the live body.

const FIRST = "1111111111111111111111111111111111111111";
const SECOND = "2222222222222222222222222222222222222222";

describe("the trail resolve writes", () => {
  test("says what a deploy shipped", async () => {
    const h = await scanned({ "a:prod": pending("a:prod", change("x")) });
    h.github.seedCommit({ sha: FIRST });
    h.github.seedCommit({ sha: SECOND, parents: [FIRST] });
    h.github.seedCommit({ sha: SHA, parents: [SECOND] });
    h.github.seedPullRequest({ number: 4, author: "dave", files: ["a/x.ts"], commits: [SECOND] });
    for (const [sha, at] of [
      [FIRST, "2025-12-30T08:00:00Z"],
      [SECOND, "2025-12-31T08:00:00Z"],
    ] as const) {
      h.github.seedDeployment({
        task: "sluiceway:a:prod",
        sha,
        status: { state: "success", createdAt: at },
        createdAt: at,
      });
    }
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    const trail = h.github.issue(h.number).body.split("## Recently deployed\n\n")[1] ?? "";
    expect(trail.split("\n")[1]).toBe(
      `  shipped #4 by dave · [compare](${REPO_URL}/compare/111111111111...222222222222)`,
    );
  });
});
