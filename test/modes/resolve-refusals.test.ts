import { describe, expect, test } from "bun:test";
import { change, inSync, pending, REPO_URL } from "./harness.ts";
import {
  ADMIN,
  ALICE,
  BOB,
  matrix,
  RESOLVE_RUN_URL,
  rowsOf,
  scanned,
  tick,
  WRITE,
  wake,
} from "./resolve-harness.ts";

// Every way a ticked box starts nothing (records 0003, 0018, 0025 and 0035).

const TABLE = {
  "a:prod": pending("a:prod", change("logs"), change("old", "delete")),
  "b:prod": pending("b:prod", change("logs")),
  "c:prod": inSync("c:prod"),
};

const ADMIN_ONLY = "stacks:\n  - path: a\n    tickers: admin\n";
const NOTE = "  :information_source: a tick on this row was not picked up. Tick again to deploy.";
const MALLORY = { login: "mallory", type: "User" };

function payload(run: string, ticker = "carol") {
  return { v: 1, hash: "2b44350653e84a11", ticker, run };
}

describe("a second tick on a stack that is deploying", () => {
  test("is dropped: no record, no lookup, and the stale row is repaired from the open record", async () => {
    const h = await scanned(TABLE);
    const before = rowsOf(h);
    // The deploy started after the scan, and its row swap was lost (0004).
    h.github.seedDeployment({
      task: "sluiceway:a:prod",
      payload: payload("77"),
      status: { state: "in_progress" },
    });
    h.github.seedRun("77", { completed: false });
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).not.toContain("createDeployment");
    expect(h.github.requests).not.toContain("getPermission");
    expect(h.github.comments(h.number)).toEqual([]);
    expect(rowsOf(h)["a:prod"]).toBe(
      [
        `- **a:prod** · deploying · ticked by carol · [run](${REPO_URL}/actions/runs/77) <!-- sluiceway:row stack="a:prod" state="deploying" destroys="1" -->`,
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
    expect(rowsOf(h)["b:prod"]).toBe(before["b:prod"] as string);
  });

  test("does not hold up the tick on another stack in the same run", async () => {
    const h = await scanned(TABLE);
    h.github.seedDeployment({
      task: "sluiceway:a:prod",
      payload: payload("77"),
      status: { state: "queued" },
    });
    h.github.seedRun("77", { completed: false });
    tick(h, ALICE, ["a:prod", "b:prod"]);

    await wake(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["b:prod"]);
  });

  test("an open deployment whose run is over gets its result, and the fresh tick deploys", async () => {
    const h = await scanned(TABLE);
    const stale = h.github.seedDeployment({
      task: "sluiceway:a:prod",
      payload: payload("77"),
      status: { state: "queued" },
    });
    h.github.seedRun("77", { completed: true });
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(h.github.deployment(stale.id).status?.state).toBe("error");
    expect(matrix(h)).toHaveLength(1);
    expect(rowsOf(h)["a:prod"]).toContain(`ticked by alice · [run](${RESOLVE_RUN_URL})`);
  });
});

describe("a refused tick", () => {
  test("creates no record, clears the box, leaves the row otherwise unchanged, and the job stays green", async () => {
    const h = await scanned(TABLE, { config: ADMIN_ONLY });
    const before = rowsOf(h);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).not.toContain("createDeployment");
    expect(rowsOf(h)["a:prod"]).toBe(before["a:prod"] as string);
    expect(h.github.comments(h.number)).toHaveLength(1);
    expect(h.github.comments(h.number)[0]).toContain("@alice");
    expect(h.github.comments(h.number)[0]).toContain("**a:prod**");
  });

  test("the comment is written after the box is cleared", async () => {
    const h = await scanned(TABLE, { config: ADMIN_ONLY });
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(h.github.requests.indexOf("createComment")).toBeGreaterThan(
      h.github.requests.lastIndexOf("updateIssueBody"),
    );
  });

  test("when the body write fails no comment promises a cleared box, and the job goes red", async () => {
    const h = await scanned(TABLE, { config: ADMIN_ONLY });
    tick(h, ALICE, ["a:prod"]);
    let edits = 0;
    h.github.onRequest = (request) => {
      if (request === "getIssue" && h.github.requests.includes("updateIssueBody")) {
        h.github.editBody(h.number, `${h.github.issue(h.number).body}\nedit ${edits++}`, BOB);
      }
    };

    await expect(wake(h)).rejects.toThrow("could not be written");

    expect(h.github.comments(h.number)).toEqual([]);
  });

  test("an allowed tick next to it still deploys, and the two refusals share one comment", async () => {
    const h = await scanned(TABLE, { config: `${ADMIN_ONLY}  - path: b\n    tickers: [bob]\n` });
    h.github.seedPermission("carol", ADMIN);
    tick(h, ALICE, ["a:prod", "b:prod"]);
    h.github.editBody(
      h.number,
      h.github.issue(h.number).body.replace("- [x] **a:prod**", "- [ ] **a:prod**"),
      ALICE,
    );
    tick(h, { login: "carol", type: "User" }, ["a:prod"]);
    tick(h, ALICE, [], { rescan: true });
    h.github.seedPermission(ALICE.login, { push: false, maintain: false, admin: false });

    await wake(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["a:prod"]);
    expect(h.github.comments(h.number)).toHaveLength(1);
    expect(h.github.comments(h.number)[0]).toContain("**b:prod**");
    expect(h.github.comments(h.number)[0]).toContain("the rescan box");
    expect(h.github.dispatches).toEqual([]);
    expect(h.github.issue(h.number).body).toContain("- [ ] Rescan all stacks");
    expect(rowsOf(h)["b:prod"]).toStartWith("- [ ] **b:prod**");
  });
});

describe("a box that is ticked again at another hash before the write", () => {
  test("is not cleared: the refusal was about the tick that was judged, and this is another tick", async () => {
    const h = await scanned(TABLE, { config: ADMIN_ONLY });
    tick(h, ALICE, ["a:prod"]);
    let moved = false;
    h.github.onRequest = (request) => {
      // The late read of the write loop. A scan wrote a fresh row in between
      // and Bob ticked it.
      if (request !== "getIssue" || moved) return;
      moved = true;
      h.github.editBody(
        h.number,
        h.github
          .issue(h.number)
          .body.replace(/hash="[0-9a-f]{16}" destroys="1"/, 'hash="ffffffffffffffff" destroys="1"'),
        BOB,
      );
    };

    await wake(h);

    expect(rowsOf(h)["a:prod"]).toStartWith("- [x] **a:prod**");
    expect(rowsOf(h)["a:prod"]).toContain('hash="ffffffffffffffff"');
  });
});

describe("an unverified tick", () => {
  test("fails closed: no record, a cleared box, a comment that asks for a fresh tick, and a red job", async () => {
    const h = await scanned(TABLE);
    h.github.failPermissionLookup(ALICE.login);
    tick(h, ALICE, ["a:prod"]);

    await expect(wake(h)).rejects.toThrow(
      "GitHub gave no answer about the access of alice, so 1 tick could not be verified.",
    );

    expect(matrix(h)).toEqual([]);
    expect(rowsOf(h)["a:prod"]).toStartWith("- [ ] **a:prod**");
    expect(h.github.comments(h.number)).toHaveLength(1);
  });

  test("the verified ticks of the same run are started and handed on before the job goes red", async () => {
    const h = await scanned(TABLE);
    h.github.seedPermission(BOB.login, WRITE);
    h.github.failPermissionLookup(ALICE.login);
    tick(h, ALICE, ["a:prod"]);
    tick(h, BOB, ["b:prod"]);

    await expect(wake(h)).rejects.toThrow("could not be verified");

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["b:prod"]);
    expect(rowsOf(h)["b:prod"]).toContain("waiting to start · ticked by bob");
  });
});

describe("a tick that is not a person's", () => {
  test("gets no lookup, no comment and no row swap", async () => {
    const h = await scanned(TABLE);
    tick(h, { login: "some-app[bot]", type: "Bot" }, ["a:prod"]);
    const body = h.github.issue(h.number).body;

    await wake(h);

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).not.toContain("getPermission");
    expect(h.github.requests).not.toContain("updateIssueBody");
    expect(h.github.comments(h.number)).toEqual([]);
    expect(h.github.issue(h.number).body).toBe(body);
  });
});

describe("a tick the edit history names nobody for", () => {
  test("deploys nothing, clears the box with the note, writes no comment and stays green", async () => {
    const h = await scanned(TABLE);
    const before = rowsOf(h);
    tick(h, MALLORY, ["a:prod"]);
    h.github.editBody(h.number, `${h.github.issue(h.number).body}\nA note.`, ALICE);
    // Mallory deletes the content of her own entry (record 0025).
    h.github.deleteHistoryEntry(h.number, 1);

    await wake(h);

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).not.toContain("getPermission");
    expect(h.github.comments(h.number)).toEqual([]);
    const [first = "", ...rest] = (before["a:prod"] as string).split("\n");
    expect(rowsOf(h)["a:prod"]).toBe([first, NOTE, ...rest].join("\n"));
  });
});

describe("a tick on a row whose stack discovery does not know", () => {
  test("is left alone", async () => {
    const h = await scanned(TABLE);
    h.github.editBody(
      h.number,
      h.github.issue(h.number).body.replaceAll("a:prod", "z:gone"),
      ALICE,
    );
    tick(h, ALICE, ["z:gone"]);
    const body = h.github.issue(h.number).body;

    await wake(h);

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).toEqual(["readEditHistory"]);
    expect(h.github.issue(h.number).body).toBe(body);
  });
});

describe("a body that moves between the read and the walk", () => {
  test("is read again, and the tick that landed in between is handled in the same run", async () => {
    const h = await scanned(TABLE);
    h.github.seedPermission(BOB.login, WRITE);
    tick(h, ALICE, ["a:prod"]);
    // The fake answers a request after `onRequest`, so to stand between the
    // body and the history of one read, the first read is answered from a
    // copy made before Bob's edit.
    const real = h.github.readEditHistory.bind(h.github);
    let reads = 0;
    h.github.readEditHistory = async (number, page) => {
      const answer = await real(number, page);
      if (reads++ > 0) return answer;
      tick(h, BOB, ["b:prod"]);
      const moved = await real(number, page);
      h.github.requests.pop();
      // The body of the second moment with the history of the first.
      return { ...answer, body: moved.body };
    };

    await wake(h);

    expect(h.github.requests.filter((request) => request === "readEditHistory")).toHaveLength(2);
    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual([
      "a:prod",
      "b:prod",
    ]);
  });
});

describe("a deployment record that cannot be written", () => {
  test("hands on the records that exist, shows them, and turns the job red", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod", "b:prod"]);
    const real = h.github.createDeployment.bind(h.github);
    h.github.createDeployment = async (deployment) => {
      if (deployment.task === "sluiceway:b:prod") throw new Error("Resource not accessible");
      return real(deployment);
    };

    await expect(wake(h)).rejects.toThrow(
      "The deployment record of b:prod could not be written: Resource not accessible.",
    );

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["a:prod"]);
    expect(rowsOf(h)["a:prod"]).toContain("waiting to start");
    // The tick that started nothing stays for the next run.
    expect(rowsOf(h)["b:prod"]).toStartWith("- [x] **b:prod**");
  });

  test("stops at the first record that fails, so a missing permission costs one request", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod", "b:prod"]);
    h.github.createDeployment = async () => {
      h.github.requests.push("createDeployment");
      throw new Error("Resource not accessible");
    };

    await expect(wake(h)).rejects.toThrow("The deployment record of a:prod could not be written");

    expect(h.github.requests.filter((request) => request === "createDeployment")).toHaveLength(1);
    expect(matrix(h)).toEqual([]);
  });
});
