import { describe, expect, test } from "bun:test";
import { nameTickers, ticksIn } from "../../src/core/edit-history.ts";
import { FakeGitHub } from "./fake-github.ts";

// What the lab saw of an issue's edit history on real GitHub (issue 28),
// written out here so that the fake cannot move it without a test going red.

const ALICE = { login: "alice", type: "User" };
const FIRST_PAGE = { size: 10, after: undefined };

describe("the edit history, as the lab observed it", () => {
  test("an issue that was never edited has no entries, not even its original body", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: "original", labels: [] });

    expect(await github.readEditHistory(issue.number, FIRST_PAGE)).toEqual({
      body: "original",
      entries: [],
      total: 0,
      next: undefined,
    });
  });

  test("one entry per edit, newest first, with the editor, the time and the full body, and the original body as the oldest", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: "original", labels: [] });
    await github.updateIssueBody(issue.number, "written by a scan");
    github.editBody(issue.number, "ticked by alice", ALICE);

    const history = await github.readEditHistory(issue.number, FIRST_PAGE);

    // The history writes the bot's login without "[bot]".
    expect(history).toEqual({
      body: "ticked by alice",
      entries: [
        { editor: ALICE, editedAt: "2026-01-01T00:00:02Z", body: "ticked by alice" },
        {
          editor: { login: "github-actions", type: "Bot" },
          editedAt: "2026-01-01T00:00:01Z",
          body: "written by a scan",
        },
        {
          editor: { login: "github-actions", type: "Bot" },
          editedAt: "2026-01-01T00:00:00Z",
          body: "original",
        },
      ],
      total: 3,
      next: undefined,
    });
  });

  test("an update that GitHub drops leaves no entry", async () => {
    const github = new FakeGitHub({ updateLimitBytes: 10 });
    const issue = await github.createIssue({ title: "t", body: "original", labels: [] });
    await github.updateIssueBody(issue.number, "short");

    await github.updateIssueBody(issue.number, "longer than ten bytes");

    const history = await github.readEditHistory(issue.number, FIRST_PAGE);
    expect(history.entries.map((entry) => entry.body)).toEqual(["short", "original"]);
  });

  test("after 130 edits GitHub keeps 100 entries: the original body and the newest 99 edits", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: "original", labels: [] });
    for (let edit = 1; edit <= 130; edit++) github.editBody(issue.number, `edit ${edit}`);

    const history = await github.readEditHistory(issue.number, { size: 100, after: undefined });

    expect(history.total).toBe(100);
    expect(history.next).toBeUndefined();
    const bodies = history.entries.map((entry) => entry.body);
    expect(bodies).toHaveLength(100);
    expect(bodies.slice(0, 2)).toEqual(["edit 130", "edit 129"]);
    // Edits 1 to 31 are gone.
    expect(bodies.slice(-2)).toEqual(["edit 32", "original"]);
  });

  test("a page is one request, names the page after it, and carries the body", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: "original", labels: [] });
    for (let edit = 1; edit <= 4; edit++) github.editBody(issue.number, `edit ${edit}`);

    const first = await github.readEditHistory(issue.number, { size: 2, after: undefined });
    const second = await github.readEditHistory(issue.number, { size: 2, after: first.next });
    const third = await github.readEditHistory(issue.number, { size: 2, after: second.next });

    expect(first.entries.map((entry) => entry.body)).toEqual(["edit 4", "edit 3"]);
    expect(second.entries.map((entry) => entry.body)).toEqual(["edit 2", "edit 1"]);
    expect(third.entries.map((entry) => entry.body)).toEqual(["original"]);
    expect([first.total, second.total, third.total]).toEqual([5, 5, 5]);
    expect([first.body, second.body, third.body]).toEqual(["edit 4", "edit 4", "edit 4"]);
    expect(third.next).toBeUndefined();
    expect(github.requests).toEqual([
      "createIssue",
      "readEditHistory",
      "readEditHistory",
      "readEditHistory",
    ]);
  });

  test("an entry's body can be deleted, and its editor and time stay", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: "original", labels: [] });
    github.editBody(issue.number, "ticked by alice", ALICE);
    github.editBody(issue.number, "edited again");

    github.deleteHistoryEntry(issue.number, 1);

    const history = await github.readEditHistory(issue.number, FIRST_PAGE);
    expect(history.entries[1]).toEqual({
      editor: ALICE,
      editedAt: "2026-01-01T00:00:01Z",
      body: null,
    });
    expect(history.total).toBe(3);
    expect(history.body).toBe("edited again");
  });

  test("a seeded issue starts its history with its author and its body", async () => {
    const github = new FakeGitHub();
    const issue = github.seedIssue({ body: "seeded", author: ALICE });
    github.editBody(issue.number, "edited");

    const history = await github.readEditHistory(issue.number, FIRST_PAGE);

    expect(history.entries.at(-1)).toMatchObject({ editor: ALICE, body: "seeded" });
  });

  test("what a reader does with an entry never reaches the fake", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: "original", labels: [] });
    github.editBody(issue.number, "edited", ALICE);

    const read = await github.readEditHistory(issue.number, FIRST_PAGE);
    (read.entries[0] as { body: string | null }).body = "changed by the reader";
    (read.entries[0] as { editor: { login: string } }).editor.login = "mallory";

    const again = await github.readEditHistory(issue.number, FIRST_PAGE);
    expect(again.entries[0]).toMatchObject({ editor: ALICE, body: "edited" });
  });
});

// The whole way from a body and its history to a ticker, as `resolve` will go
// it: the body and the first page come from one read.
describe("the walk against the fake", () => {
  const ROOT = '<!-- sluiceway:dashboard v="1" scan-sha="0123456" scan-run="1" scan-at="t" -->';
  const HASHES = { a: "aaaaaaaaaaaaaaaa", b: "bbbbbbbbbbbbbbbb", c: "cccccccccccccccc" };

  function dashboard(ticked: string): string {
    const rows = Object.entries(HASHES).map(([name, hash]) =>
      [
        `- [${ticked.includes(name) ? "x" : " "}] **stack-${name}** · 1 to create <!-- sluiceway:row stack="stack-${name}" state="pending" hash="${hash}" -->`,
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
    return [ROOT, "", "## Pending", "", ...rows, ""].join("\n");
  }

  async function tickers(github: FakeGitHub, number: number, size: number) {
    const first = await github.readEditHistory(number, { size, after: undefined });
    const ticks = ticksIn(first.body);
    const named = await nameTickers(ticks, async (after) =>
      after === undefined ? first : github.readEditHistory(number, { size, after }),
    );
    return ticks.map((tick, index) => [
      tick.kind === "row" ? tick.stackId : "rescan",
      named[index],
    ]);
  }

  test("the race of issue 28: three people tick one second apart, and each tick keeps its own ticker", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: dashboard(""), labels: [] });
    github.editBody(issue.number, dashboard("a"), { login: "alice", type: "User" });
    github.editBody(issue.number, dashboard("ab"), { login: "bob", type: "User" });
    github.editBody(issue.number, dashboard("abc"), { login: "carol", type: "User" });

    expect(await tickers(github, issue.number, 10)).toEqual([
      ["stack-a", { named: true, editor: ALICE, editedAt: "2026-01-01T00:00:01Z" }],
      [
        "stack-b",
        { named: true, editor: { login: "bob", type: "User" }, editedAt: "2026-01-01T00:00:02Z" },
      ],
      [
        "stack-c",
        { named: true, editor: { login: "carol", type: "User" }, editedAt: "2026-01-01T00:00:03Z" },
      ],
    ]);
    expect(github.requests.filter((request) => request === "readEditHistory")).toHaveLength(1);
  });

  test("a tick the bot carried through twelve writes costs two small pages, not the whole history", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: dashboard(""), labels: [] });
    for (let scan = 1; scan <= 40; scan++) {
      await github.updateIssueBody(issue.number, `${dashboard("")}scan ${scan}\n`);
    }
    github.editBody(issue.number, dashboard("a"), ALICE);
    for (let scan = 1; scan <= 12; scan++) {
      await github.updateIssueBody(issue.number, `${dashboard("a")}scan ${scan}\n`);
    }
    github.requests.length = 0;

    expect(await tickers(github, issue.number, 10)).toEqual([
      ["stack-a", { named: true, editor: ALICE, editedAt: "2026-01-01T00:00:41Z" }],
    ]);
    expect(github.requests).toEqual(["readEditHistory", "readEditHistory"]);
  });

  test("a tick that outlived 99 later edits has fallen into the gap, and the history names nobody", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: dashboard(""), labels: [] });
    github.editBody(issue.number, dashboard("a"), ALICE);
    for (let scan = 1; scan <= 99; scan++) {
      await github.updateIssueBody(issue.number, `${dashboard("a")}scan ${scan}\n`);
    }

    expect(await tickers(github, issue.number, 10)).toEqual([
      ["stack-a", { named: false, reason: "end-of-history" }],
    ]);
  });

  test("a ticker who deletes their own entry is not replaced by the next editor", async () => {
    const github = new FakeGitHub();
    const issue = await github.createIssue({ title: "t", body: dashboard(""), labels: [] });
    github.editBody(issue.number, dashboard("a"), { login: "mallory", type: "User" });
    github.editBody(issue.number, dashboard("ab"), { login: "admin", type: "User" });
    github.deleteHistoryEntry(issue.number, 1);

    // The admin's own tick is named nobody too: what the deleted entry held
    // for stack-b cannot be known. The admin ticks again.
    expect(await tickers(github, issue.number, 10)).toEqual([
      ["stack-a", { named: false, reason: "entry-without-body" }],
      ["stack-b", { named: false, reason: "entry-without-body" }],
    ]);
  });
});
