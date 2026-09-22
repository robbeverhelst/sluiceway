import { describe, expect, test } from "bun:test";
import { parseDashboard, rootMarker, rowMarker } from "../../src/render/marker.ts";

// The example body of record 0009, with the row formats of its day. The
// visible text is never parsed, so it still has to read the same.
const RECORD_BODY = [
  '<!-- sluiceway:dashboard v="1" scan-sha="294bbc0" scan-run="1234567890" scan-at="2026-09-20T06:00:12Z" -->',
  "",
  '- [ ] **apps/grafana:prod** · `+2 ~1 -0` · [preview](run-url) <!-- sluiceway:row stack="apps/grafana:prod" state="pending" hash="3fa9c1e2aabbccdd" -->',
  "  (attribution, details, failure line)",
  "  <!-- /sluiceway:row -->",
  '- **apps/loki:prod** · deploying · [run](run-url) <!-- sluiceway:row stack="apps/loki:prod" state="deploying" -->',
  "  <!-- /sluiceway:row -->",
  "",
  "- [ ] Rescan all stacks <!-- sluiceway:rescan -->",
  "",
].join("\n");

describe("reading a body", () => {
  test("the record's example gives the root facts and two row blocks", () => {
    expect(parseDashboard(RECORD_BODY)).toEqual({
      root: {
        version: 1,
        scanSha: "294bbc0",
        scanRun: "1234567890",
        scanAt: "2026-09-20T06:00:12Z",
      },
      rows: [
        {
          known: true,
          stackId: "apps/grafana:prod",
          state: "pending",
          hash: "3fa9c1e2aabbccdd",
          destroys: 0,
          failed: false,
          shortened: 0,
          ticked: false,
          text: [
            '- [ ] **apps/grafana:prod** · `+2 ~1 -0` · [preview](run-url) <!-- sluiceway:row stack="apps/grafana:prod" state="pending" hash="3fa9c1e2aabbccdd" -->',
            "  (attribution, details, failure line)",
            "  <!-- /sluiceway:row -->",
          ].join("\n"),
        },
        {
          known: true,
          stackId: "apps/loki:prod",
          state: "deploying",
          hash: undefined,
          destroys: 0,
          failed: false,
          shortened: 0,
          ticked: false,
          text: [
            '- **apps/loki:prod** · deploying · [run](run-url) <!-- sluiceway:row stack="apps/loki:prod" state="deploying" -->',
            "  <!-- /sluiceway:row -->",
          ].join("\n"),
        },
      ],
      merges: [],
      rescanTicked: false,
    });
  });

  test("a tick is the box at the start of the line that ends in the marker", () => {
    const ticked = RECORD_BODY.replace("- [ ] **apps/grafana", "- [x] **apps/grafana");
    expect(parseDashboard(ticked).rows.map((row) => row.known && row.ticked)).toEqual([
      true,
      false,
    ]);
    const upper = RECORD_BODY.replace("- [ ] **apps/grafana", "- [X] **apps/grafana");
    expect(parseDashboard(upper).rows.map((row) => row.known && row.ticked)).toEqual([true, false]);
  });

  test("the visible text between the box and the marker is never parsed", () => {
    const body = [
      '- [x] [x] <!-- sluiceway:row stack="fake" --> state="in-sync" whatever <!-- sluiceway:row stack="real" state="pending" hash="00" -->',
      "  <!-- /sluiceway:row -->",
    ].join("\n");
    const rows = parseDashboard(body).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stackId: "real", state: "pending", hash: "00", ticked: true });
  });

  test("a box that is not at the start of the line is no tick", () => {
    const body = [
      '- **a** [x] <!-- sluiceway:row stack="a" state="pending" hash="00" -->',
      "  <!-- /sluiceway:row -->",
    ].join("\n");
    expect(parseDashboard(body).rows[0]).toMatchObject({ ticked: false });
  });

  test("the rescan box is read the same way", () => {
    expect(parseDashboard(RECORD_BODY.replace("- [ ] Rescan", "- [x] Rescan")).rescanTicked).toBe(
      true,
    );
  });

  test("the display caches are read from the marker", () => {
    const body = [
      '- [ ] x <!-- sluiceway:row stack="a" state="pending" hash="00" destroys="12" failed="true" -->',
      "  <!-- /sluiceway:row -->",
    ].join("\n");
    expect(parseDashboard(body).rows[0]).toMatchObject({ destroys: 12, failed: true });
  });

  test("a cache that does not read as a number counts as nothing", () => {
    const body = [
      '- x <!-- sluiceway:row stack="a" state="in-sync" destroys="many" failed="yes" -->',
      "  <!-- /sluiceway:row -->",
    ].join("\n");
    expect(parseDashboard(body).rows[0]).toMatchObject({ destroys: 0, failed: false });
  });

  test("the level of a shortened row is read from the marker, and a row without one is in full", () => {
    const body = [
      '- [ ] x <!-- sluiceway:row stack="a" state="pending" hash="00" shortened="2" -->',
      "  <!-- /sluiceway:row -->",
      '- [ ] x <!-- sluiceway:row stack="b" state="pending" hash="00" -->',
      "  <!-- /sluiceway:row -->",
      '- [ ] x <!-- sluiceway:row stack="c" state="pending" hash="00" shortened="a lot" -->',
      "  <!-- /sluiceway:row -->",
    ].join("\n");
    expect(parseDashboard(body).rows.map((row) => row.known && row.shortened)).toEqual([2, 0, 0]);
  });
});

describe("what a writer does not know", () => {
  test("a row with an unknown state is carried byte for byte and has no tick to act on", () => {
    const text = [
      '- [x] **a:prod** · drifted · whatever comes later <!-- sluiceway:row stack="a:prod" state="drift" hash="00" drift="true" -->',
      "  :ocean: a line this version never wrote",
      "  <!-- /sluiceway:row -->",
    ].join("\n");
    const rows = parseDashboard(`intro\n${text}\noutro\n`).rows;
    expect(rows).toEqual([{ known: false, stackId: "a:prod", state: "drift", text }]);
  });

  test("unknown keys are ignored, and the order of keys does not matter", () => {
    const body = [
      '- [ ] x <!-- sluiceway:row behind="b:prod" hash="00" state="pending" stack="a:prod" -->',
      "  <!-- /sluiceway:row -->",
    ].join("\n");
    expect(parseDashboard(body).rows[0]).toMatchObject({
      known: true,
      stackId: "a:prod",
      state: "pending",
      hash: "00",
    });
  });

  test("unknown kinds are ignored", () => {
    const body = [
      '<!-- sluiceway:dashboard v="1" scan-sha="s" scan-run="r" scan-at="t" -->',
      '- [x] later <!-- sluiceway:section name="drift" -->',
      '- [x] later <!-- sluiceway:rowish stack="a" state="pending" -->',
    ].join("\n");
    expect(parseDashboard(body)).toMatchObject({ rows: [], rescanTicked: false });
  });

  test("a body of another version still gives its version", () => {
    const body = '<!-- sluiceway:dashboard v="2" scan="other" -->\n';
    expect(parseDashboard(body).root).toEqual({
      version: 2,
      scanSha: undefined,
      scanRun: undefined,
      scanAt: undefined,
    });
  });
});

describe("bodies that are not as a writer left them", () => {
  test("the root marker counts only on the first line", () => {
    expect(
      parseDashboard(`hello\n${rootMarker({ scanSha: "s", scanRun: "r", scanAt: "t" })}`).root,
    ).toBe(undefined);
    expect(parseDashboard("").root).toBe(undefined);
    expect(parseDashboard('<!-- sluiceway:dashboard v="one" -->').root).toBe(undefined);
  });

  test("line endings are normalized before parsing", () => {
    const parsed = parseDashboard(RECORD_BODY.replaceAll("\n", "\r\n"));
    expect(parsed).toEqual(parseDashboard(RECORD_BODY));
  });

  test("a marker without a stack id is no row", () => {
    expect(parseDashboard('- [x] x <!-- sluiceway:row state="pending" -->').rows).toEqual([]);
  });

  test("a row marker that does not end its line is no row", () => {
    const body =
      '- [x] <!-- sluiceway:row stack="a" state="pending" --> **a**\n  <!-- /sluiceway:row -->';
    expect(parseDashboard(body).rows).toEqual([]);
  });

  test("a block with no closing marker is its first line alone", () => {
    const first = '- [x] a <!-- sluiceway:row stack="a" state="pending" hash="00" -->';
    const second = '- b <!-- sluiceway:row stack="b" state="in-sync" -->';
    const body = [first, "  </details>", "## In sync", second, "  <!-- /sluiceway:row -->"].join(
      "\n",
    );
    const rows = parseDashboard(body).rows;
    expect(rows.map((row) => row.text)).toEqual([first, `${second}\n  <!-- /sluiceway:row -->`]);
    expect(rows[0]).toMatchObject({ stackId: "a", ticked: true });
  });
});

describe("round trips", () => {
  test("what rowMarker writes, parseDashboard reads", () => {
    const stackIds = [
      "apps/grafana:prod",
      ".:prod",
      'my dir/"x" <b>:prod',
      "日本/スタック:本番",
      "a%20b--c",
    ];
    for (const stackId of stackIds) {
      const facts = {
        stackId,
        state: "pending",
        hash: "3fa9c1e2aabbccdd",
        destroys: 3,
        failed: true,
      } as const;
      const body = `- [ ] x ${rowMarker(facts)}\n  <!-- /sluiceway:row -->`;
      expect(parseDashboard(body).rows[0]).toMatchObject(facts);
    }
  });

  test("what rootMarker writes, parseDashboard reads", () => {
    const facts = {
      scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
      scanRun: "17034455121",
      scanAt: "2026-09-21T10:02:41Z",
    };
    expect(parseDashboard(`${rootMarker(facts)}\n\nbody`).root).toEqual({ version: 1, ...facts });
  });
});
