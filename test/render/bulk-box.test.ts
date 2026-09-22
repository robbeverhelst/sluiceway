import { describe, expect, test } from "bun:test";
import { renderBody } from "../../src/render/body.ts";
import { renderBulkLine } from "../../src/render/bulk-box.ts";
import {
  type ParsedRow,
  parseDashboard,
  ROW_CLOSE_MARKER,
  type RowFacts,
  rowMarker,
} from "../../src/render/marker.ts";

// Slice 5.18, record 0083: a box under the pending rows and one under the
// drifted rows that deploy the whole section, each behind a confirm box.

const H1 = "1111111111111111";
const H2 = "2222222222222222";

describe("the bulk box", () => {
  test("under the pending rows says how many stacks it deploys", () => {
    expect(renderBulkLine({ kind: "box", section: "pending", count: 3, ticked: false })).toBe(
      '- [ ] Deploy all 3 pending stacks <!-- sluiceway:bulk section="pending" -->',
    );
  });

  test("under the drifted rows repairs them", () => {
    expect(renderBulkLine({ kind: "box", section: "drift", count: 2, ticked: false })).toBe(
      '- [ ] Repair all 2 drifted stacks <!-- sluiceway:bulk section="drift" -->',
    );
  });

  test("reads back with its section and its tick", () => {
    const text = renderBulkLine({ kind: "box", section: "pending", count: 3, ticked: true });
    expect(text).toStartWith("- [x] Deploy all 3");
    expect(parseDashboard(text).bulk).toEqual([
      { kind: "box", section: "pending", ticked: true, text },
    ]);
  });

  test("a box ticked by hand in any case reads as ticked", () => {
    const text = '- [X] Deploy all 3 pending stacks <!-- sluiceway:bulk section="pending" -->';
    expect(parseDashboard(text).bulk[0]?.ticked).toBe(true);
  });

  test("carries a note that says what changed under a confirm box, and reads it back", () => {
    const text = renderBulkLine({
      kind: "box",
      section: "pending",
      count: 2,
      ticked: false,
      note: { kind: "changed", added: ["app:prod"], gone: ["db:prod"], moved: ["net:prod"] },
    });
    expect(text).toBe(
      [
        '- [ ] Deploy all 2 pending stacks <!-- sluiceway:bulk section="pending" note="changed" added="app:prod" gone="db:prod" moved="net:prod" -->',
        "  :information_source: the rows changed before the confirm box was ticked: **app:prod** is new, **db:prod** is not pending any more, **net:prod** has a new diff. Tick again to confirm the stacks as they are now.",
      ].join("\n"),
    );
    expect(parseDashboard(text).bulk[0]).toEqual({
      kind: "box",
      section: "pending",
      ticked: false,
      note: { kind: "changed", added: ["app:prod"], gone: ["db:prod"], moved: ["net:prod"] },
      text,
    });
  });

  test("the note of a drifted section says a stack is not drifted any more", () => {
    const text = renderBulkLine({
      kind: "box",
      section: "drift",
      count: 2,
      ticked: false,
      note: { kind: "changed", added: [], gone: ["db:prod"], moved: [] },
    });
    expect(text).toContain("**db:prod** is not drifted any more.");
  });

  test("names at most ten stacks in a note, then counts the rest", () => {
    const added = Array.from({ length: 12 }, (_, i) => `s${String(i).padStart(2, "0")}`);
    const text = renderBulkLine({
      kind: "box",
      section: "pending",
      count: 14,
      ticked: false,
      note: { kind: "changed", added, gone: [], moved: [] },
    });
    expect(text).toContain("**s09** and 2 more are new.");
    expect(text).not.toContain("**s10**");
  });

  test("the orphan and the expired notes", () => {
    const orphan = renderBulkLine({
      kind: "box",
      section: "pending",
      count: 2,
      ticked: false,
      note: { kind: "orphan" },
    });
    expect(orphan.split("\n")[1]).toBe(
      "  :information_source: a tick on this box was not picked up. Tick again to ask once more.",
    );
    const expired = renderBulkLine({
      kind: "box",
      section: "pending",
      count: 2,
      ticked: false,
      note: { kind: "expired" },
    });
    expect(expired.split("\n")[1]).toBe(
      "  :information_source: the confirm box was not ticked before the next scan, so it was taken back. Tick again for a fresh one.",
    );
    expect(parseDashboard(expired).bulk[0]).toMatchObject({ note: { kind: "expired" } });
  });
});

describe("the confirm box", () => {
  const confirm = {
    kind: "confirm" as const,
    section: "pending" as const,
    ticked: false,
    by: "alice",
    stacks: [
      { stackId: "app:prod", hash: H1 },
      { stackId: "net:prod", hash: H2 },
    ],
    scanRun: "4242",
  };

  test("names the count, the stacks, who asked, and what ticking it does", () => {
    expect(renderBulkLine(confirm)).toBe(
      [
        `- [ ] **Confirm:** deploy all 2 pending stacks: **app:prod**, **net:prod** · asked by alice <!-- sluiceway:bulk section="pending" confirm="alice" stacks="app:prod,net:prod" hashes="${H1},${H2}" scan-run="4242" -->`,
        "  Ticking this deploys each stack as its row shows it, in dependency order. A change to these rows first takes it back.",
      ].join("\n"),
    );
  });

  test("of the drifted rows repairs them", () => {
    expect(renderBulkLine({ ...confirm, section: "drift" })).toStartWith(
      "- [ ] **Confirm:** repair all 2 drifted stacks: **app:prod**, **net:prod** · asked by alice",
    );
  });

  test("names ten stacks and counts the rest", () => {
    const stacks = Array.from({ length: 13 }, (_, i) => ({
      stackId: `s${String(i).padStart(2, "0")}`,
      hash: H1,
    }));
    const line = renderBulkLine({ ...confirm, stacks }).split("\n")[0] ?? "";
    expect(line).toContain("deploy all 13 pending stacks: **s00**, ");
    expect(line).toContain("**s09** and 3 more · asked by alice");
    expect(line).not.toContain("**s10**");
    // The marker holds every stack, so the confirmation covers all of them.
    expect(parseDashboard(line).bulk[0]).toMatchObject({ stacks });
  });

  test("escapes the ids and the login", () => {
    const line = renderBulkLine({
      ...confirm,
      by: "a*b",
      stacks: [
        { stackId: "a_*b", hash: H1 },
        { stackId: "c", hash: H2 },
      ],
    });
    expect(line).toContain("**a&#95;&#42;b**");
    expect(line).toContain("asked by a&#42;b");
  });

  test("reads back with its stacks, their hashes, who asked and the scan it was drawn after", () => {
    const text = renderBulkLine({ ...confirm, ticked: true });
    expect(parseDashboard(text).bulk).toEqual([{ ...confirm, ticked: true, text }]);
  });

  test("a confirm marker without stacks, with a hash missing, or of an unknown section is not one", () => {
    const bad = [
      '- [x] x <!-- sluiceway:bulk section="pending" confirm="alice" stacks="" hashes="" scan-run="1" -->',
      `- [x] x <!-- sluiceway:bulk section="pending" confirm="alice" stacks="a,b" hashes="${H1}" scan-run="1" -->`,
      '- [x] x <!-- sluiceway:bulk section="in-sync" -->',
      '- x <!-- sluiceway:bulk section="pending" -->',
    ];
    for (const line of bad) expect(parseDashboard(line).bulk).toEqual([]);
  });

  test("is never read as a row, a merge row or the rescan box", () => {
    const parsed = parseDashboard(renderBulkLine({ ...confirm, ticked: true }));
    expect(parsed.rows).toEqual([]);
    expect(parsed.merges).toEqual([]);
    expect(parsed.rescanTicked).toBe(false);
  });
});

describe("the bulk lines on the dashboard", () => {
  const row = (facts: RowFacts): ParsedRow => {
    const [parsed] = parseDashboard(
      `- [ ] **${facts.stackId}** ${rowMarker(facts)}\n  ${ROW_CLOSE_MARKER}`,
    ).rows;
    if (!parsed) throw new Error("no row");
    return parsed;
  };
  const rows = [
    row({ stackId: "a", state: "pending", hash: H1 }),
    row({ stackId: "b", state: "pending", hash: H2 }),
    row({ stackId: "c", state: "drift", hash: H1, drift: true }),
    row({ stackId: "d", state: "drift", hash: H2, drift: true }),
    row({ stackId: "e", state: "in-sync" }),
  ];
  const base = {
    root: {
      scanSha: "0123456789abcdef0123456789abcdef01234567",
      scanRun: "7",
      scanAt: "2026-09-22T08:00:00.000Z",
    },
    rows,
    recentlyDeployed: [],
    repoUrl: "https://github.com/acme/infra",
    actionRef: "v0.4.0",
    personality: false,
  };

  test("a bulk box sits under the pending rows and one under the drifted rows", () => {
    const body = renderBody({ ...base, bulk: { on: true, live: [] } });
    const pending = body.slice(body.indexOf("## Pending"), body.indexOf("## Drifted"));
    expect(pending).toEndWith(
      `${rows[1]?.text}\n\n- [ ] Deploy all 2 pending stacks <!-- sluiceway:bulk section="pending" -->\n\n`,
    );
    const drifted = body.slice(body.indexOf("## Drifted"), body.indexOf("## In sync"));
    expect(drifted).toEndWith(
      `${rows[3]?.text}\n\n- [ ] Repair all 2 drifted stacks <!-- sluiceway:bulk section="drift" -->\n\n`,
    );
  });

  test("none when the writer says deploys are off or the dashboard is read only, or gives no bulk input", () => {
    expect(renderBody({ ...base, bulk: { on: false, live: [] } })).not.toContain("sluiceway:bulk");
    expect(renderBody(base)).not.toContain("sluiceway:bulk");
  });

  test("the confirm box is drawn in place of the bulk box and reads back", () => {
    const live = parseDashboard(
      renderBulkLine({ kind: "box", section: "pending", count: 2, ticked: true }),
    ).bulk;
    const body = renderBody({
      ...base,
      bulk: {
        on: true,
        live,
        acts: [
          {
            tick: { kind: "bulk", section: "pending" },
            outcome: "confirm",
            by: "alice",
            scanRun: "7",
          },
        ],
      },
    });
    const parsed = parseDashboard(body).bulk;
    expect(parsed.map(({ kind, section }) => `${kind} ${section}`)).toEqual([
      "confirm pending",
      "box drift",
    ]);
    expect(parsed[0]).toMatchObject({
      by: "alice",
      stacks: [
        { stackId: "a", hash: H1 },
        { stackId: "b", hash: H2 },
      ],
      ticked: false,
    });
  });
});
