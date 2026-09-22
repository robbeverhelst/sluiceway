import { describe, expect, test } from "bun:test";
import { type HistoryEntry, nameTickers, ticksIn } from "../../src/core/edit-history.ts";
import { renderBulkLine } from "../../src/render/bulk-box.ts";

// Slice 5.18, record 0083: the walk reads the bulk box and the confirm box
// like any other box, and names the person whose edit ticked them.

const STACKS = [
  { stackId: "a", hash: "aaaaaaaaaaaaaaaa" },
  { stackId: "b", hash: "bbbbbbbbbbbbbbbb" },
];
const ROOT =
  '<!-- sluiceway:dashboard v="1" scan-sha="x" scan-run="1" scan-at="2026-09-22T08:00:00Z" -->';
const body = (...lines: string[]) => [ROOT, ...lines].join("\n\n");
const confirm = (ticked: boolean, stacks = STACKS) =>
  renderBulkLine({
    kind: "confirm",
    section: "pending",
    by: "alice",
    stacks,
    scanRun: "1",
    ticked,
  });
const box = (ticked: boolean, section: "pending" | "drift" = "pending") =>
  renderBulkLine({ kind: "box", section, count: 2, ticked });

const BOT = { login: "github-actions", type: "Bot" };
const BOB = { login: "bob", type: "User" };
const entry = (editor: HistoryEntry["editor"], text: string): HistoryEntry => ({
  editor,
  editedAt: "2026-09-22T08:00:00Z",
  body: text,
});

describe("the ticks of the bulk lines", () => {
  test("a ticked bulk box and a ticked confirm box are ticks, the first line of a section counts", () => {
    expect(ticksIn(body(box(true, "drift"), confirm(true), box(true)))).toEqual([
      { kind: "bulk", section: "drift" },
      { kind: "confirm", section: "pending", stacks: STACKS },
    ]);
    expect(ticksIn(body(box(false), confirm(false)))).toEqual([]);
  });

  test("the ticker of a confirm box is the person whose edit ticked it, through a bot write that carried it", async () => {
    const [tick] = ticksIn(body(confirm(true)));
    if (!tick) throw new Error("no tick");
    const page = {
      entries: [
        entry(BOT, body(confirm(true))),
        entry(BOB, body(confirm(true))),
        entry(BOT, body(confirm(false))),
      ],
      total: 3,
      next: undefined,
    };
    expect(await nameTickers([tick], async () => page)).toEqual([
      { named: true, editor: BOB, editedAt: "2026-09-22T08:00:00Z" },
    ]);
  });

  test("a confirm box whose stacks changed under the tick is another tick", async () => {
    const [tick] = ticksIn(body(confirm(true)));
    if (!tick) throw new Error("no tick");
    const moved = [STACKS[0], { stackId: "b", hash: "0000000000000000" }] as typeof STACKS;
    const page = {
      entries: [entry(BOB, body(confirm(true))), entry(BOT, body(confirm(true, moved)))],
      total: 2,
      next: undefined,
    };
    expect(await nameTickers([tick], async () => page)).toEqual([
      { named: true, editor: BOB, editedAt: "2026-09-22T08:00:00Z" },
    ]);
  });
});
