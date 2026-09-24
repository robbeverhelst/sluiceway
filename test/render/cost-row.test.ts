import { describe, expect, test } from "bun:test";
import type { Change } from "../../src/core/diff.ts";
import { type PendingRow, renderRow } from "../../src/render/row.ts";

// Record 0105: a pending row of an OpenTofu or Terraform stack carries what
// the change does to the monthly bill, as a delta, right under its first
// line, and a stack set to on-merge that the threshold holds back says why.
// Written out by hand from the record.

const RUN_URL = "https://github.com/example-org/infra/actions/runs/17034455121";

const update: Change = {
  address: "aws_instance.web",
  type: "aws_instance",
  name: "web",
  op: "update",
  changedKeys: ["instance_type"],
  replaceKeys: [],
};

const pending = (over: Partial<PendingRow> = {}): PendingRow => ({
  state: "pending",
  diff: { stackId: "compute", changes: [update] },
  hash: "2b44350653e84a11",
  runUrl: RUN_URL,
  ...over,
});

const lines = (row: PendingRow) => renderRow(row).split("\n");

describe("the cost line of a pending row", () => {
  test("says about how much more a month, right under the first line, and never the bill", () => {
    const row = lines(pending({ cost: { monthly: 31.2, currency: "USD" } }));
    expect(row[1]).toBe("  about **31.20 USD** more a month");
    expect(row[2]).toBe("  <details><summary>1 change</summary>");
  });

  test("says less a month for a change that saves money", () => {
    expect(lines(pending({ cost: { monthly: -1234.5, currency: "EUR" } }))[1]).toBe(
      "  about **1,234.50 EUR** less a month",
    );
  });

  test("says about the same for a change that costs nothing more", () => {
    expect(lines(pending({ cost: { monthly: 0, currency: "USD" } }))[1]).toBe(
      "  about the same cost a month",
    );
  });

  test("comes before the attribution line and the notes", () => {
    const row = lines(
      pending({
        cost: { monthly: 2, currency: "USD" },
        attribution: { full: "#12 by alice", counted: "1 pull request" },
        waitsOnMerge: { kind: "destroy" },
      }),
    );
    expect(row[1]).toBe("  about **2.00 USD** more a month");
    expect(row[2]).toBe("  #12 by alice");
    expect(row[3]).toContain("this stack deploys on merge");
  });

  test("stays on a redacted and on a shortened row: it names nothing", () => {
    expect(
      renderRow(pending({ cost: { monthly: 2, currency: "USD" } }), { redact: true, level: 3 }),
    ).toContain("\n  about **2.00 USD** more a month\n");
  });

  test("a row without an estimate is byte for byte what it was", () => {
    expect(renderRow(pending({ cost: undefined }))).toBe(renderRow(pending()));
    expect(renderRow(pending())).not.toContain("a month");
  });
});

describe("a stack set to on-merge that the cost threshold holds back", () => {
  const note = (waits: PendingRow["waitsOnMerge"]) => lines(pending({ waitsOnMerge: waits }))[1];

  test("names what the change costs and the threshold", () => {
    expect(note({ kind: "cost", monthly: 120.5, currency: "USD", threshold: 100 })).toBe(
      "  :information_source: this stack deploys on merge, and this change waits for a tick: it costs about **120.50 USD** more a month, above the threshold of 100.00 USD.",
    );
  });

  test("says when the cost could not be estimated and names the key", () => {
    expect(note({ kind: "cost-unknown", threshold: 100 })).toBe(
      "  :information_source: this stack deploys on merge, and this change waits for a tick: its cost could not be estimated, and `cost.threshold` is set to 100.00.",
    );
  });
});
