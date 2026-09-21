import { describe, expect, test } from "bun:test";
import { parseDashboard } from "../../src/render/marker.ts";
import { type PendingRow, renderRow } from "../../src/render/row.ts";

const ROW: PendingRow = {
  state: "pending",
  diff: {
    stackId: "apps/grafana:prod",
    changes: [
      {
        address: "urn:dashboards",
        type: "aws:s3/bucket:Bucket",
        name: "dashboards",
        op: "update",
        changedKeys: ["tags"],
        replaceKeys: [],
      },
    ],
  },
  hash: "2b44350653e84a11",
  runUrl: "https://github.com/example-org/infra/actions/runs/17034120077",
};

// A scan that meets a tick while a `resolve` run is on its way carries the
// tick through on its fresh row (record 0025).
describe("a pending row that carries a tick", () => {
  test("has a checked box, and is the same row in every other byte", () => {
    const plain = renderRow(ROW);
    const ticked = renderRow({ ...ROW, ticked: true });
    expect(plain).toStartWith("- [ ] **apps/grafana:prod**");
    expect(ticked).toStartWith("- [x] **apps/grafana:prod**");
    expect(ticked.slice(5)).toBe(plain.slice(5));
  });

  test("reads back as the same tick: ticked, at the same diff hash", () => {
    const [row] = parseDashboard(renderRow({ ...ROW, ticked: true })).rows;
    expect(row).toMatchObject({ stackId: "apps/grafana:prod", hash: ROW.hash, ticked: true });
  });

  test("keeps its tick when redacted and at every level of the size budget", () => {
    for (const level of [0, 1, 2, 3] as const) {
      expect(renderRow({ ...ROW, ticked: true }, { level, redact: level === 3 })).toStartWith(
        "- [x] ",
      );
    }
  });
});
