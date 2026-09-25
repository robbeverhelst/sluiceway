import { describe, expect, test } from "bun:test";
import { type ParsedRow, parseDashboard } from "../../src/render/marker.ts";
import { type FailureLine, renderRow } from "../../src/render/row.ts";
import { settledRow } from "../../src/render/settled-row.ts";

// The row `settle` writes for a deploy it ended (record 0113): the live block
// of the deploy with its first line written again from facts, the failure line
// right under it, and every other line carried as it is.

const RUN = "https://github.com/acme/infra/actions/runs/5151";
const REF = "v0.1.0";

const FAILURE: FailureLine = {
  reason: "the run ended without a result",
  ticker: "alice",
  at: new Date("2026-09-25T08:09:06Z"),
  runUrl: RUN,
};

function parsed(block: string): ParsedRow {
  const [row] = parseDashboard(block).rows;
  if (!row) throw new Error("no row");
  return row;
}

// The row `apply` wrote before the deploy, with an attribution line and the
// fold of the changes outside the stack.
function deploying(): ParsedRow {
  return parsed(
    renderRow(
      {
        state: "deploying",
        stackId: "apps/api:prod",
        ticker: "alice",
        runUrl: RUN,
        destroys: 1,
        deletes: 1,
        attribution: {
          full: "from #433 by alice · [compare](https://x/compare)",
          counted: "from 1 pull request · [compare](https://x/compare)",
          outside: [
            "<details><summary>1 change outside this stack</summary>",
            "#12 by bob<br>",
            "</details>",
          ],
        },
      },
      { actionRef: REF },
    ),
  );
}

describe("the row of a deploy settle ended", () => {
  test("says there is no preview since the deploy ended, with the failure line under it and the rest carried", () => {
    const row = deploying();

    const settled = settledRow(row, FAILURE);

    const [, ...rest] = row.text.split("\n");
    expect(settled.text).toBe(
      [
        '- **apps/api:prod** · no preview since its deploy ended, the next scan previews it <!-- sluiceway:row stack="apps/api:prod" state="preview-failed" failed="true" -->',
        `  :x: last deploy failed: the run ended without a result · ticked by alice · 2026-09-25 08:09 UTC · [run](${RUN})`,
        ...rest,
      ].join("\n"),
    );
    expect(settled).toMatchObject({
      known: true,
      stackId: "apps/api:prod",
      state: "preview-failed",
      failed: true,
      hash: undefined,
      ticked: false,
      destroys: 0,
    });
  });

  test("a queued row loses its spinner and what it waited behind", () => {
    const row = parsed(
      renderRow(
        {
          state: "deploying",
          stackId: "apps/web:prod",
          ticker: "alice",
          runUrl: RUN,
          waiting: true,
          behind: ["apps/api:prod"],
        },
        { actionRef: REF },
      ),
    );

    const settled = settledRow(row, {
      ...FAILURE,
      reason: "a stack it depends on did not deploy",
    });

    expect(settled.text).toBe(
      [
        '- **apps/web:prod** · no preview since its deploy ended, the next scan previews it <!-- sluiceway:row stack="apps/web:prod" state="preview-failed" failed="true" -->',
        `  :x: last deploy failed: a stack it depends on did not deploy · ticked by alice · 2026-09-25 08:09 UTC · [run](${RUN})`,
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
    expect(settled.known && settled.behind).toBeUndefined();
  });

  test("the failure line is in the dashboard zone and says merged for a deploy on merge", () => {
    const settled = settledRow(
      deploying(),
      { ...FAILURE, onMerge: true },
      { timeZone: "Europe/Brussels" },
    );

    expect(settled.text.split("\n")[1]).toBe(
      `  :x: last deploy failed: the run ended without a result · merged by alice · 2026-09-25 10:09 UTC+2 · [run](${RUN})`,
    );
  });

  test("the stack id and the ticker are escaped as on every row", () => {
    const row = parsed(
      renderRow({ state: "deploying", stackId: "a_b*c:prod", ticker: "alice", runUrl: RUN }),
    );

    const settled = settledRow(row, { ...FAILURE, ticker: "<b>" });

    expect(settled.text).toStartWith("- **a&#95;b&#42;c:prod** · no preview");
    expect(settled.text).toContain("ticked by &lt;b&gt;");
  });
});
