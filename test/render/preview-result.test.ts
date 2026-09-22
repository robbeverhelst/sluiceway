import { describe, expect, test } from "bun:test";
import type { PreviewResult } from "../../src/adapters/adapter.ts";
import { previewOutcome, previewRow } from "../../src/render/preview-result.ts";
import { renderRow } from "../../src/render/row.ts";

const LINKS = {
  summary: "https://github.com/example-org/infra/actions/runs/4242/attempts/1",
  log: "https://github.com/example-org/infra/actions/runs/4242/job/777",
};

const PENDING: PreviewResult = {
  ok: true,
  diff: {
    stackId: "network:dev",
    changes: [
      {
        address: "random:index/randomPet:RandomPet::pet",
        type: "random:index/randomPet:RandomPet",
        name: "pet",
        op: "create",
        changedKeys: [],
        replaceKeys: [],
      },
    ],
  },
  toolLog: "",
};

describe("the links on a fresh row (record 0044)", () => {
  test("a pending row's preview link lands on the summary, where the stack's diff is", () => {
    expect(renderRow(previewRow("network:dev", PENDING, LINKS)).split("\n")[0]).toContain(
      `[preview](${LINKS.summary})`,
    );
  });

  test("a shortened pending row's summary link lands on the summary too", () => {
    const row = renderRow(previewRow("network:dev", PENDING, LINKS), { level: 3 });
    expect(row).toContain(`see the [summary](${LINKS.summary})`);
  });

  test("a preview failure's run link lands on the job log, where the tool's own words are", () => {
    const failed: PreviewResult = {
      ok: false,
      reason: { kind: "tool-error", exitCode: 255 },
      detail: [],
      toolLog: "",
    };
    expect(renderRow(previewRow("network:dev", failed, LINKS)).split("\n")[0]).toContain(
      `· [run](${LINKS.log})`,
    );
  });
});

// Record 0055: nothing to deploy from the code and drift found is a drift
// row, with a hash over the drift and a link to the summary, which lists it.
describe("a preview with drift", () => {
  const gone = {
    address: "local:index/file:File::notes",
    type: "local:index/file:File",
    name: "notes",
    op: "delete" as const,
    changedKeys: [],
    replaceKeys: [],
  };
  const DRIFTED: PreviewResult = {
    ok: true,
    diff: { stackId: "network:dev", changes: [], drift: [gone] },
    toolLog: "",
  };

  test("with no change is a drift row that links to the summary", () => {
    const row = previewRow("network:dev", DRIFTED, LINKS, undefined, { pageUrl: "https://page" });
    expect(row.state).toBe("drift");
    expect(renderRow(row).split("\n")[0]).toContain(`[summary](${LINKS.summary})`);
    expect(previewOutcome(DRIFTED)).toBe("drift");
  });

  test("with changes is a pending row that also shows the drift", () => {
    if (!PENDING.ok) throw new Error("the fixture is a diff");
    const both: PreviewResult = { ...PENDING, diff: { ...PENDING.diff, drift: [gone] } };
    const row = previewRow("network:dev", both, LINKS);
    expect(row.state).toBe("pending");
    expect(renderRow(row).split("\n")[0]).toContain('drift="true"');
    expect(previewOutcome(both)).toBe("pending, with drift");
  });

  test("an empty drift list is no drift", () => {
    const none: PreviewResult = {
      ok: true,
      diff: { stackId: "network:dev", changes: [], drift: [] },
      toolLog: "",
    };
    expect(previewRow("network:dev", none, LINKS).state).toBe("in-sync");
    expect(previewOutcome(none)).toBe("in sync");
  });
});
