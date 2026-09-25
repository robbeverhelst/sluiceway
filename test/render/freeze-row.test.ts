import { describe, expect, test } from "bun:test";
import { type DeployingRow, renderRow } from "../../src/render/row.ts";

// A row that waits for a deploy freeze to end (record 0115): the queued row
// of a deploy window (record 0104), which names the freeze, its reason and
// its end in the dashboard zone (record 0089).

const REPO_URL = "https://github.com/example-org/infra";
const RUN_URL = `${REPO_URL}/actions/runs/17034455121`;
// 2027-01-05 00:00 in Brussels.
const ENDS = new Date("2027-01-04T23:00:00Z");
const FREEZE = { reason: "Year-end freeze", ends: ENDS };

const waiting = (overrides: Partial<DeployingRow> = {}): DeployingRow => ({
  state: "deploying",
  stackId: "site:prod",
  ticker: "alice",
  runUrl: RUN_URL,
  waiting: true,
  window: { opens: ENDS, freeze: FREEZE },
  ...overrides,
});

const first = (row: DeployingRow) => renderRow(row, { timeZone: "Europe/Brussels" }).split("\n")[0];

describe("a row that waits for a deploy freeze", () => {
  test("names the freeze and when it ends, with no box and a queued marker", () => {
    expect(first(waiting())).toBe(
      `- **site:prod** · queued for the end of the deploy freeze (Year-end freeze) at 2027-01-05 00:00 UTC+1 · ticked by alice · [run](${RUN_URL}) <!-- sluiceway:row stack="site:prod" state="queued" -->`,
    );
  });

  test("a freeze with no reason names none", () => {
    expect(first(waiting({ window: { opens: ENDS, freeze: { ends: ENDS } } }))).toContain(
      "· queued for the end of the deploy freeze at 2027-01-05 00:00 UTC+1 · ticked by alice ·",
    );
  });

  test("with a window after the freeze, says when the stack goes", () => {
    const opens = new Date("2027-01-05T08:00:00Z");
    expect(first(waiting({ window: { opens, freeze: FREEZE } }))).toContain(
      "· queued for the end of the deploy freeze (Year-end freeze) at 2027-01-05 00:00 UTC+1, and then for the deploy window, which opens 2027-01-05 09:00 UTC+1 · ticked by alice ·",
    );
  });

  test("behind a stack, it says both", () => {
    expect(first(waiting({ behind: ["app:prod"] }))).toContain(
      "· queued behind **app:prod**, and for the end of the deploy freeze (Year-end freeze) at 2027-01-05 00:00 UTC+1 · ticked by alice ·",
    );
  });

  test("the reason is plain text on one line: no mention, no reference, no markup", () => {
    const reason = "Sale by @alice, see #12\n**all** week";
    const line = first(waiting({ window: { opens: ENDS, freeze: { reason, ends: ENDS } } }));
    expect(line).not.toContain("@alice");
    expect(line).not.toContain("**all**");
    expect(line).not.toContain("\n");
  });

  test("once nothing holds a stack without windows, the next run starts it and no window is named", () => {
    expect(first(waiting({ window: { opens: undefined, anyTime: true } }))).toContain(
      "· queued for the next scheduled run, which starts it: nothing holds it now · ticked by alice ·",
    );
  });

  test("a deploy on merge says merged by", () => {
    expect(first(waiting({ onMerge: true }))).toContain("UTC+1 · merged by alice ·");
  });
});
