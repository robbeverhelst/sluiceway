import { describe, expect, test } from "bun:test";
import {
  type HistoryEntry,
  type HistoryPage,
  nameTickers,
  type Tick,
  ticksIn,
} from "../../src/core/edit-history.ts";

// Bodies are written out by hand in the format of record 0009, so the walk is
// held to the format and not to the renderer.

const ROOT = '<!-- sluiceway:dashboard v="1" scan-sha="0123456" scan-run="1" scan-at="t" -->';

type Box = " " | "x" | "X";

function row(stackId: string, box: Box, hash: string): string {
  return [
    `- [${box}] **${stackId}** · 1 to create <!-- sluiceway:row stack="${stackId}" state="pending" hash="${hash}" -->`,
    "  <!-- /sluiceway:row -->",
  ].join("\n");
}

function body(...rows: string[]): string {
  return [ROOT, "", "## Pending", "", ...rows, ""].join("\n");
}

const BOT = { login: "github-actions", type: "Bot" };

function person(login: string) {
  return { login, type: "User" };
}

// A history, newest entry first, handed out in pages. `reads` counts them.
function history(entries: HistoryEntry[], size = 10, total = entries.length) {
  const reads: (string | undefined)[] = [];
  const readPage = async (after: string | undefined): Promise<HistoryPage> => {
    reads.push(after);
    const start = after === undefined ? 0 : Number(after);
    const end = start + size;
    return {
      entries: entries.slice(start, end),
      total,
      next: end < entries.length ? String(end) : undefined,
    };
  };
  return { reads, readPage };
}

const A = { kind: "row", stackId: "stack-a", hash: "aaaaaaaaaaaaaaaa" } as const satisfies Tick;
const B = { kind: "row", stackId: "stack-b", hash: "bbbbbbbbbbbbbbbb" } as const satisfies Tick;
const C = { kind: "row", stackId: "stack-c", hash: "cccccccccccccccc" } as const satisfies Tick;

// The three rows of the lab issue, each ticked or not.
function lab(a: Box, b: Box, c: Box): string {
  return body(row("stack-a", a, A.hash), row("stack-b", b, B.hash), row("stack-c", c, C.hash));
}

describe("the ticker is the person whose edit made the tick", () => {
  test("a tick in the interface, after the bot's last write", async () => {
    const { readPage } = history([
      {
        editor: person("alice"),
        editedAt: "2026-09-21T07:11:52Z",
        body: body(row("stack-a", "x", A.hash)),
      },
      { editor: BOT, editedAt: "2026-09-20T20:18:26Z", body: body(row("stack-a", " ", A.hash)) },
      { editor: BOT, editedAt: "2026-09-20T20:18:24Z", body: body() },
    ]);

    expect(await nameTickers([A], readPage)).toEqual([
      { named: true, editor: person("alice"), editedAt: "2026-09-21T07:11:52Z" },
    ]);
  });

  // Issue 28: three edits one second apart, and every event carried the final
  // body with all three rows ticked. The history has one correct entry per
  // edit, so each tick keeps its own ticker.
  test("the recorded race: three ticks one second apart by three people", async () => {
    const { readPage } = history([
      { editor: person("carol"), editedAt: "2026-09-21T08:40:19Z", body: lab("x", "x", "x") },
      { editor: person("bob"), editedAt: "2026-09-21T08:40:18Z", body: lab("x", "x", " ") },
      { editor: person("alice"), editedAt: "2026-09-21T08:40:17Z", body: lab("x", " ", " ") },
      { editor: BOT, editedAt: "2026-09-21T08:40:03Z", body: lab(" ", " ", " ") },
    ]);

    expect(await nameTickers([A, B, C], readPage)).toEqual([
      { named: true, editor: person("alice"), editedAt: "2026-09-21T08:40:17Z" },
      { named: true, editor: person("bob"), editedAt: "2026-09-21T08:40:18Z" },
      { named: true, editor: person("carol"), editedAt: "2026-09-21T08:40:19Z" },
    ]);
  });

  test("bot entries inside the stretch are normal: a scan or a row swap carries a tick through", async () => {
    const { readPage } = history([
      { editor: BOT, editedAt: "2026-09-21T08:50:00Z", body: lab("x", " ", "x") },
      { editor: person("carol"), editedAt: "2026-09-21T08:45:00Z", body: lab("x", " ", "x") },
      { editor: BOT, editedAt: "2026-09-21T08:42:00Z", body: lab("x", " ", " ") },
      { editor: person("alice"), editedAt: "2026-09-21T08:40:17Z", body: lab("x", " ", " ") },
      { editor: BOT, editedAt: "2026-09-21T08:40:03Z", body: lab(" ", " ", " ") },
    ]);

    expect(await nameTickers([A, C], readPage)).toEqual([
      { named: true, editor: person("alice"), editedAt: "2026-09-21T08:40:17Z" },
      { named: true, editor: person("carol"), editedAt: "2026-09-21T08:45:00Z" },
    ]);
  });
});

describe("the history names nobody", () => {
  // Mallory ticks, waits for an admin's next edit and deletes her own entry.
  // Skipping over the entry would name the admin.
  test("an entry without a body breaks the stretch", async () => {
    const { readPage } = history([
      { editor: person("admin"), editedAt: "2026-09-21T09:00:00Z", body: lab("x", "x", " ") },
      { editor: person("mallory"), editedAt: "2026-09-21T08:59:00Z", body: null },
      { editor: BOT, editedAt: "2026-09-21T08:40:03Z", body: lab(" ", " ", " ") },
    ]);

    expect(await nameTickers([A, B], readPage)).toEqual([
      { named: false, reason: "entry-without-body" },
      { named: false, reason: "entry-without-body" },
    ]);
  });

  // What a deleted entry looks like through the API was never observed (issue
  // 27, item 7). A dashboard body is never empty, so an empty one counts as
  // deleted too.
  test("an entry with an empty body breaks the stretch like one without", async () => {
    const { readPage } = history([
      { editor: person("admin"), editedAt: "2026-09-21T09:00:00Z", body: lab("x", " ", " ") },
      { editor: person("mallory"), editedAt: "2026-09-21T08:59:00Z", body: "" },
      { editor: BOT, editedAt: "2026-09-21T08:40:03Z", body: lab(" ", " ", " ") },
    ]);

    expect(await nameTickers([A], readPage)).toEqual([
      { named: false, reason: "entry-without-body" },
    ]);
  });

  test("an entry without a body that lies before the stretch changes nothing", async () => {
    const { readPage } = history([
      { editor: person("alice"), editedAt: "2026-09-21T09:00:00Z", body: lab("x", " ", " ") },
      { editor: BOT, editedAt: "2026-09-21T08:59:00Z", body: lab(" ", " ", " ") },
      { editor: person("mallory"), editedAt: "2026-09-21T08:58:00Z", body: null },
    ]);

    expect(await nameTickers([A], readPage)).toEqual([
      { named: true, editor: person("alice"), editedAt: "2026-09-21T09:00:00Z" },
    ]);
  });

  test("a stretch that reaches the end of the history, with no entry in which the row was not ticked", async () => {
    const { readPage } = history([
      { editor: BOT, editedAt: "2026-09-21T09:00:00Z", body: lab("x", " ", " ") },
      { editor: person("alice"), editedAt: "2026-09-21T08:59:00Z", body: lab("x", " ", " ") },
    ]);

    expect(await nameTickers([A], readPage)).toEqual([{ named: false, reason: "end-of-history" }]);
  });

  // The body and the history come from one query, so this is a body that moved
  // between two reads. The caller reads again.
  test("a tick that the newest entry does not hold", async () => {
    const { readPage } = history([
      { editor: BOT, editedAt: "2026-09-21T09:00:00Z", body: lab(" ", " ", " ") },
      { editor: person("alice"), editedAt: "2026-09-21T08:59:00Z", body: lab("x", " ", " ") },
      { editor: BOT, editedAt: "2026-09-21T08:40:03Z", body: lab(" ", " ", " ") },
    ]);

    expect(await nameTickers([A], readPage)).toEqual([
      { named: false, reason: "not-in-newest-entry" },
    ]);
  });

  // An issue that was never edited has no entries at all, not even its
  // original body (seen on real GitHub).
  test("a history without entries", async () => {
    const { readPage } = history([]);

    expect(await nameTickers([A], readPage)).toEqual([
      { named: false, reason: "not-in-newest-entry" },
    ]);
  });
});

// GitHub keeps 100 entries: the original body and the newest 99 edits (issue
// 28). Between those two lies a gap, and the edit that made the tick may be in
// it.
describe("the 100 entry cap", () => {
  const at = (minute: number) => `2026-09-21T10:${String(minute % 60).padStart(2, "0")}:00Z`;

  // The newest `edits` edits all hold the tick, by the bot except the oldest,
  // and the original body does not.
  function ticked(edits: number): HistoryEntry[] {
    return [
      ...Array.from({ length: edits - 1 }, (_, index) => ({
        editor: BOT,
        editedAt: at(index),
        body: lab("x", " ", " "),
      })),
      { editor: person("alice"), editedAt: "2026-09-21T09:00:00Z", body: lab("x", " ", " ") },
      { editor: BOT, editedAt: "2026-09-20T20:18:24Z", body: lab(" ", " ", " ") },
    ];
  }

  test("a walk that reaches the gap names nobody, though the original body has no tick", async () => {
    const { readPage } = history(ticked(99));

    expect(await nameTickers([A], readPage)).toEqual([{ named: false, reason: "end-of-history" }]);
  });

  test("one entry under the cap nothing is lost, and the oldest edit made the tick", async () => {
    const { readPage } = history(ticked(98));

    expect(await nameTickers([A], readPage)).toEqual([
      { named: true, editor: person("alice"), editedAt: "2026-09-21T09:00:00Z" },
    ]);
  });

  test("a stretch that ends before the gap is not touched by it", async () => {
    const entries = ticked(99);
    entries[50] = { editor: BOT, editedAt: at(50), body: lab(" ", " ", " ") };
    entries[49] = { editor: person("bob"), editedAt: at(49), body: lab("x", " ", " ") };
    const { readPage } = history(entries);

    expect(await nameTickers([A], readPage)).toEqual([
      { named: true, editor: person("bob"), editedAt: at(49) },
    ]);
  });
});

// Every entry carries a whole body of up to 262,144 bytes.
describe("paging stops early", () => {
  const entries: HistoryEntry[] = [
    { editor: person("bob"), editedAt: "2026-09-21T11:30:00Z", body: lab("x", "x", " ") },
    ...Array.from({ length: 13 }, (_, index) => ({
      editor: BOT,
      editedAt: `2026-09-21T11:${String(29 - index)}:00Z`,
      body: lab("x", " ", " "),
    })),
    { editor: person("alice"), editedAt: "2026-09-21T11:00:00Z", body: lab("x", " ", " ") },
    ...Array.from({ length: 15 }, (_, index) => ({
      editor: BOT,
      editedAt: `2026-09-21T10:${String(59 - index)}:00Z`,
      body: lab(" ", " ", " "),
    })),
  ];

  test("one page when the first page answers every tick", async () => {
    const { reads, readPage } = history(entries);

    expect(await nameTickers([B], readPage)).toEqual([
      { named: true, editor: person("bob"), editedAt: "2026-09-21T11:30:00Z" },
    ]);
    expect(reads).toEqual([undefined]);
  });

  test("a second page for the tick that needs it, and no third", async () => {
    const { reads, readPage } = history(entries);

    expect(await nameTickers([A, B], readPage)).toEqual([
      { named: true, editor: person("alice"), editedAt: "2026-09-21T11:00:00Z" },
      { named: true, editor: person("bob"), editedAt: "2026-09-21T11:30:00Z" },
    ]);
    expect(reads).toEqual([undefined, "10"]);
  });

  test("no tick, no read", async () => {
    const { reads, readPage } = history(entries);

    expect(await nameTickers([], readPage)).toEqual([]);
    expect(reads).toEqual([]);
  });
});

describe("what holds a tick", () => {
  const RESCAN = "- [x] Rescan every stack <!-- sluiceway:rescan -->";
  const NO_RESCAN = "- [ ] Rescan every stack <!-- sluiceway:rescan -->";

  test("the rescan box gets its ticker the same way", async () => {
    const { readPage } = history([
      {
        editor: BOT,
        editedAt: "2026-09-21T09:01:00Z",
        body: body(row("stack-a", "x", A.hash), RESCAN),
      },
      {
        editor: person("alice"),
        editedAt: "2026-09-21T09:00:00Z",
        body: body(row("stack-a", "x", A.hash), RESCAN),
      },
      {
        editor: person("bob"),
        editedAt: "2026-09-21T08:59:00Z",
        body: body(row("stack-a", "x", A.hash), NO_RESCAN),
      },
      {
        editor: BOT,
        editedAt: "2026-09-21T08:40:03Z",
        body: body(row("stack-a", " ", A.hash), NO_RESCAN),
      },
    ]);

    expect(await nameTickers([{ kind: "rescan" }, A], readPage)).toEqual([
      { named: true, editor: person("alice"), editedAt: "2026-09-21T09:00:00Z" },
      { named: true, editor: person("bob"), editedAt: "2026-09-21T08:59:00Z" },
    ]);
  });

  // Bob ticked what the row showed then. Alice ticked what it shows now.
  test("the same row ticked at another hash is another tick", async () => {
    const { readPage } = history([
      {
        editor: person("alice"),
        editedAt: "2026-09-21T09:00:00Z",
        body: body(row("stack-a", "x", A.hash)),
      },
      { editor: BOT, editedAt: "2026-09-21T08:59:00Z", body: body(row("stack-a", " ", A.hash)) },
      {
        editor: person("bob"),
        editedAt: "2026-09-21T08:58:00Z",
        body: body(row("stack-a", "x", "0000000000000000")),
      },
    ]);

    expect(await nameTickers([A], readPage)).toEqual([
      { named: true, editor: person("alice"), editedAt: "2026-09-21T09:00:00Z" },
    ]);
  });

  test("an entry that a scan wrote with a new hash under a tick ends the stretch", async () => {
    const { readPage } = history([
      { editor: BOT, editedAt: "2026-09-21T09:00:00Z", body: body(row("stack-a", "x", A.hash)) },
      {
        editor: person("bob"),
        editedAt: "2026-09-21T08:58:00Z",
        body: body(row("stack-a", "x", "0000000000000000")),
      },
      {
        editor: BOT,
        editedAt: "2026-09-21T08:40:03Z",
        body: body(row("stack-a", " ", "0000000000000000")),
      },
    ]);

    expect(await nameTickers([A], readPage)).toEqual([
      { named: true, editor: BOT, editedAt: "2026-09-21T09:00:00Z" },
    ]);
  });

  test("line endings and edits elsewhere in the body do not break a stretch", async () => {
    const crlf = `${lab("x", " ", " ").replaceAll("\n", "\r\n")}\r\nA note somebody typed.\r\n`;
    const { readPage } = history([
      { editor: person("carol"), editedAt: "2026-09-21T09:00:00Z", body: crlf },
      { editor: person("alice"), editedAt: "2026-09-21T08:59:00Z", body: lab("x", " ", " ") },
      { editor: BOT, editedAt: "2026-09-21T08:40:03Z", body: lab(" ", " ", " ") },
    ]);

    expect(await nameTickers([A], readPage)).toEqual([
      { named: true, editor: person("alice"), editedAt: "2026-09-21T08:59:00Z" },
    ]);
  });

  test("of two blocks for one stack the first counts, in an entry as in the live body", async () => {
    const twice = body(row("stack-a", " ", A.hash), row("stack-a", "x", A.hash));
    const { readPage } = history([
      {
        editor: person("alice"),
        editedAt: "2026-09-21T09:00:00Z",
        body: body(row("stack-a", "x", A.hash)),
      },
      { editor: person("mallory"), editedAt: "2026-09-21T08:59:00Z", body: twice },
    ]);

    expect(ticksIn(twice)).toEqual([]);
    expect(await nameTickers([A], readPage)).toEqual([
      { named: true, editor: person("alice"), editedAt: "2026-09-21T09:00:00Z" },
    ]);
  });
});

describe("the ticks in a body", () => {
  test("every ticked row with its hash, in body order, and the rescan box last", () => {
    const live = body(
      row("stack-a", "x", A.hash),
      row("stack-b", " ", B.hash),
      row("stack-c", "X", C.hash),
      "- [x] Rescan every stack <!-- sluiceway:rescan -->",
    );

    expect(ticksIn(live)).toEqual([A, C, { kind: "rescan" }]);
  });

  test("a row of a state this version does not know, a queued row and a row without a hash hold no tick", () => {
    const live = body(
      '- [x] **stack-a** <!-- sluiceway:row stack="stack-a" state="later" hash="aaaaaaaaaaaaaaaa" -->',
      '- [x] **stack-b** <!-- sluiceway:row stack="stack-b" state="pending" -->',
      '- [x] **stack-c** <!-- sluiceway:row stack="stack-c" state="queued" hash="aaaaaaaaaaaaaaaa" -->',
    );

    expect(ticksIn(live)).toEqual([]);
  });
});
