import { describe, expect, test } from "bun:test";
import { applyNotification, repositoryOf, scanNotifications } from "../../src/core/notify.ts";

// Slice 5.13 (record 0078): what a scan and an apply tell. A scan tells what
// is new since the body it started from, so a push that changes nothing for a
// stack that already waits tells nobody again.

const DASHBOARD = "https://github.com/acme/infra/issues/1";
const LINKS = { repository: "acme/infra", dashboardUrl: DASHBOARD };

// Row blocks as the renderer writes their markers. The words on the line are
// not read.
function body(rows: Record<string, string>): string {
  return Object.entries(rows)
    .flatMap(([id, state]) => [
      `- [ ] **${id}** <!-- sluiceway:row stack="${id}" state="${state}" destroys="0" -->`,
      "  <!-- /sluiceway:row -->",
    ])
    .join("\n");
}

describe("a scan", () => {
  test("tells the stacks that are pending now and were not before, in id order", () => {
    const before = body({ "a:prod": "in-sync", "b:prod": "pending" });
    const after = body({ "c:prod": "pending", "a:prod": "pending", "b:prod": "pending" });
    expect(scanNotifications(before, after, LINKS)).toEqual([
      { event: "pending", stacks: ["a:prod", "c:prod"], ...LINKS },
    ]);
  });

  test("on a new dashboard, every pending stack is new", () => {
    expect(scanNotifications("", body({ "a:prod": "pending" }), LINKS)).toEqual([
      { event: "pending", stacks: ["a:prod"], ...LINKS },
    ]);
  });

  test("tells nothing when the same stacks stay pending", () => {
    const same = body({ "a:prod": "pending" });
    expect(scanNotifications(same, same, LINKS)).toEqual([]);
  });

  test("tells drift found on a stack that showed none, apart from pending", () => {
    const before = body({ "a:prod": "drift", "b:prod": "in-sync" });
    const after = body({ "a:prod": "drift", "b:prod": "drift", "c:prod": "pending" });
    expect(scanNotifications(before, after, LINKS)).toEqual([
      { event: "pending", stacks: ["c:prod"], ...LINKS },
      { event: "drift", stacks: ["b:prod"], ...LINKS },
    ]);
  });

  test("a stack that deployed and is pending again is new again", () => {
    const before = body({ "a:prod": "deploying" });
    const after = body({ "a:prod": "pending" });
    expect(scanNotifications(before, after, LINKS)[0]?.stacks).toEqual(["a:prod"]);
  });
});

describe("an apply", () => {
  const links = { repository: "acme/infra", dashboardUrl: DASHBOARD, runUrl: "run" };

  test("tells deployed, failed and refused, each with its stack", () => {
    for (const outcome of ["deployed", "failed", "refused"] as const) {
      expect(applyNotification(outcome, "a:prod", links)).toEqual({
        event: outcome,
        stacks: ["a:prod"],
        ...links,
      });
    }
  });

  test("tells a failure before the stack was known, with no stack", () => {
    expect(applyNotification("failed", undefined, links)?.stacks).toEqual([]);
  });

  test("tells nothing when nothing went out and nobody is needed", () => {
    expect(applyNotification("in-sync", "a:prod", links)).toBeUndefined();
    expect(applyNotification("rehearsed", "a:prod", links)).toBeUndefined();
  });
});

test("the repository is owner and repo from the repo's address", () => {
  expect(repositoryOf("https://github.com/acme/infra")).toBe("acme/infra");
  expect(repositoryOf("https://ghe.example.com/acme/infra/")).toBe("acme/infra");
});
