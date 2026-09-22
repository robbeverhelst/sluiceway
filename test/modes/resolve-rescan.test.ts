import { describe, expect, test } from "bun:test";
import { change, inSync, pending } from "./harness.ts";
import { ALICE, matrix, rowsOf, scanned, tick, WORKFLOW, wake } from "./resolve-harness.ts";

// The rescan box, a body of another version, and the cap of 256 deploys
// (records 0009, 0017, 0018, 0025 and 0035).

const TABLE = { "a:prod": pending("a:prod", change("logs")) };

describe("the rescan box", () => {
  test("ticked by a person with write access starts a full scan of this workflow and is cleared", async () => {
    const h = await scanned(TABLE);
    const before = rowsOf(h);
    tick(h, ALICE, [], { rescan: true });

    await wake(h);

    expect(h.github.dispatches).toEqual([{ workflow: WORKFLOW.file, ref: WORKFLOW.ref }]);
    expect(matrix(h)).toEqual([]);
    expect(h.github.issue(h.number).body).toContain("- [ ] Rescan all stacks");
    expect(rowsOf(h)).toEqual(before);
    expect(h.github.comments(h.number)).toEqual([]);
  });

  // Slice 5.9: GitHub names the run the dispatch started, and the job log and
  // the job summary of `resolve` link to it.
  test("links to the scan it started, in the job log and in the job summary", async () => {
    const h = await scanned(TABLE);
    const summaries = h.log.summaries.length;
    tick(h, ALICE, [], { rescan: true });

    await wake(h);

    const scan = "https://github.com/acme/infra/actions/runs/9000";
    expect(h.log.lines).toContain(`Started a full scan for the rescan box: ${scan}`);
    expect(h.log.summaries.slice(summaries)).toEqual([
      [
        "### Sluiceway resolve",
        "",
        "- The rescan box was ticked by alice.",
        `- Started a full scan for the rescan box: ${scan}`,
        "- Wrote the dashboard (#1).",
        "",
        `It started [a scan](${scan}).`,
        "",
      ].join("\n"),
    ]);
  });

  test("the dispatch needs `actions: write`: without it the job goes red and says so", async () => {
    const h = await scanned(TABLE);
    h.github.withoutActionsWrite();
    tick(h, ALICE, [], { rescan: true });

    await expect(wake(h)).rejects.toThrow(
      "A full scan could not be started: Resource not accessible by integration. The resolve job needs the permission `actions: write`",
    );

    expect(matrix(h)).toEqual([]);
  });

  test("a failed dispatch does not stop the deploy that was ticked with it", async () => {
    const h = await scanned(TABLE);
    h.github.withoutActionsWrite();
    tick(h, ALICE, ["a:prod"], { rescan: true });

    await expect(wake(h)).rejects.toThrow("actions: write");

    expect(matrix(h)).toHaveLength(1);
    expect(rowsOf(h)["a:prod"]).toContain("waiting to start");
  });

  test("gets its ticker from the edit history, and a bot's tick starts nothing", async () => {
    const h = await scanned(TABLE);
    tick(h, { login: "some-app[bot]", type: "Bot" }, [], { rescan: true });

    await wake(h);

    expect(h.github.dispatches).toEqual([]);
    expect(h.github.requests).not.toContain("updateIssueBody");
  });

  test("a job that does not know its workflow says so", async () => {
    const h = await scanned(TABLE);
    h.context.workflow = undefined;
    tick(h, ALICE, [], { rescan: true });

    await expect(wake(h)).rejects.toThrow("GITHUB_WORKFLOW_REF is not set");
  });
});

describe("a body of another version", () => {
  test("is not touched: no record, no comment, and a full scan is started to write it again", async () => {
    const h = await scanned(TABLE);
    h.github.editBody(
      h.number,
      h.github
        .issue(h.number)
        .body.replace('sluiceway:dashboard v="1"', 'sluiceway:dashboard v="2"'),
      ALICE,
    );
    tick(h, ALICE, ["a:prod"]);
    const body = h.github.issue(h.number).body;

    await wake(h);

    expect(h.github.dispatches).toEqual([{ workflow: WORKFLOW.file, ref: WORKFLOW.ref }]);
    expect(h.github.requests).toEqual(["readEditHistory", "dispatchWorkflow"]);
    expect(h.github.issue(h.number).body).toBe(body);
    expect(matrix(h)).toEqual([]);
  });

  test("a body that lost its root marker since the event is left alone, with no scan", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod"]);
    const event = h.github.deliverEvent();
    h.github.editBody(h.number, "Someone replaced the whole body.", ALICE);

    await wake(h, event);

    expect(h.github.requests).toEqual(["readEditHistory"]);
    expect(h.github.dispatches).toEqual([]);
  });
});

describe("more than 256 ticks in one run", () => {
  test("start 256 deploys in stack id order, and the ticks beyond are cleared with the note", async () => {
    // 258 pending rows as a scan writes them do not fit in one issue: the
    // smallest shortened row is about 280 characters. Only a body of smaller
    // rows can hold this many ticks, so this one is made by hand from a
    // dashboard of in sync rows. `resolve` never reads a row's text.
    const ids = Array.from({ length: 258 }, (_, index) => `s${String(index).padStart(3, "0")}`);
    const h = await scanned(Object.fromEntries(ids.map((id) => [id, inSync(id)])));
    await h.github.updateIssueBody(
      h.number,
      h.github
        .issue(h.number)
        .body.replace(
          /^- (s\d{3}) <!-- sluiceway:row stack="s\d{3}" state="in-sync" -->$/gm,
          '- [ ] **$1** <!-- sluiceway:row stack="$1" state="pending" hash="2b44350653e84a11" -->',
        ),
    );
    h.github.requests.length = 0;
    tick(h, ALICE, ids);

    await wake(h);

    const entries = matrix(h) as { stack: string }[];
    expect(entries.map(({ stack }) => stack)).toEqual(ids.slice(0, 256));
    expect(h.github.requests.filter((request) => request === "createDeployment")).toHaveLength(256);
    const rows = rowsOf(h);
    expect(rows.s255).toContain('state="deploying"');
    for (const id of ids.slice(256)) {
      expect(rows[id]).toStartWith(`- [ ] **${id}**`);
      expect(rows[id]).toContain("a tick on this row was not picked up. Tick again to deploy.");
    }
    expect(h.github.comments(h.number)).toEqual([]);
    // One person, one lookup, however many boxes (record 0018).
    expect(h.github.requests.filter((request) => request === "getPermission")).toHaveLength(1);
  });
});
