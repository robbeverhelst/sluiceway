import { describe, expect, test } from "bun:test";
import { rowBlock } from "../../src/render/body.ts";
import { clearTick } from "../../src/render/clear-tick.ts";
import { type ParsedRow, parseDashboard } from "../../src/render/marker.ts";

// A writer without a diff clears a box (records 0018 and 0025). The box is the
// one thing the tick regex reads at the start of the first line, and the note
// is the one line such a writer adds. Nothing else in the block moves.

const NOTE = "  :information_source: a tick on this row was not picked up. Tick again to deploy.";

function ticked(): ParsedRow {
  const block = [
    '- [x] **a:prod** · 1 update, **1 delete** · [preview](https://x/runs/1) <!-- sluiceway:row stack="a:prod" state="pending" hash="2b44350653e84a11" destroys="1" -->',
    "  from #433 by alice",
    "  :warning: <kbd>DELETE</kbd> <code>aws:s3/bucket:Bucket</code> <b>[x] old</b>",
    "  <details><summary>1 other change</summary>",
    "  <kbd>update</kbd> <code>aws:s3/bucket:Bucket</code> <b>logs</b> · <code>tags</code><br>",
    "  </details>",
    "  <!-- /sluiceway:row -->",
  ].join("\n");
  const [row] = parseDashboard(block).rows;
  if (!row) throw new Error("no row");
  return row;
}

describe("clearing a tick", () => {
  test("unticks the box and leaves every other byte of the block alone", () => {
    const row = ticked();

    const cleared = clearTick(row);

    expect(cleared.text).toBe(row.text.replace("- [x] ", "- [ ] "));
    expect(cleared).toMatchObject({ known: true, ticked: false, hash: "2b44350653e84a11" });
    expect(cleared.text).toContain("<b>[x] old</b>");
  });

  test("reads an upper case X as a tick too", () => {
    const row = ticked();
    const upper = parseDashboard(row.text.replace("- [x] ", "- [X] ")).rows[0] as ParsedRow;

    expect(clearTick(upper).text).toBe(row.text.replace("- [x] ", "- [ ] "));
  });

  test("with the note, puts the orphan tick note right under the first line", () => {
    const row = ticked();
    const [first, ...rest] = row.text.replace("- [x] ", "- [ ] ").split("\n");

    expect(clearTick(row, { note: true }).text).toBe([first, NOTE, ...rest].join("\n"));
  });

  test("the note is the one the row renderer writes", () => {
    const rendered = rowBlock({
      state: "pending",
      diff: { stackId: "a:prod", changes: [] },
      hash: "2b44350653e84a11",
      runUrl: "https://x/runs/1",
      orphanTick: true,
    });

    expect(rendered.text.split("\n")).toContain(NOTE);
  });

  test("a row that already carries the note does not get a second one", () => {
    const once = clearTick(ticked(), { note: true });
    const again = parseDashboard(once.text.replace("- [ ] ", "- [x] ")).rows[0] as ParsedRow;

    expect(clearTick(again, { note: true }).text).toBe(once.text);
  });

  test("a row that is not ticked, has no box, or is of an unknown state comes back as it is", () => {
    const unticked = clearTick(ticked());
    expect(clearTick(unticked)).toEqual(unticked);

    const deploying = rowBlock({
      state: "deploying",
      stackId: "a:prod",
      ticker: "alice",
      runUrl: "https://x/runs/1",
    });
    expect(clearTick(deploying, { note: true })).toEqual(deploying);

    const [unknown] = parseDashboard(
      '- [x] **a:prod** <!-- sluiceway:row stack="a:prod" state="someday" -->\n  <!-- /sluiceway:row -->',
    ).rows;
    expect(clearTick(unknown as ParsedRow, { note: true })).toEqual(unknown as ParsedRow);
  });
});
