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

  // Slice 4.7 (record 0059): its drift is listed like a pending row's changes,
  // on a preview page of its own.
  test("with no change is a drift row whose preview link lands on its preview page", () => {
    const row = previewRow("network:dev", DRIFTED, LINKS, undefined, { pageUrl: "https://page" });
    expect(row.state).toBe("drift");
    expect(renderRow(row).split("\n")[0]).toContain("· [preview](https://page) ");
    expect(previewOutcome(DRIFTED)).toBe("drift");
  });

  test("without a preview page the drift row's preview link lands on the summary", () => {
    const row = previewRow("network:dev", DRIFTED, LINKS);
    expect(renderRow(row).split("\n")[0]).toContain(`· [preview](${LINKS.summary}) `);
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

// Record 0059: the stacks a preview read from the program's stack references
// ride on every row the preview gives, so `resolve`, which never previews,
// finds them in the body.
describe("a preview that read what its stack depends on", () => {
  const read = (result: PreviewResult): PreviewResult =>
    result.ok ? { ...result, dependencies: { stackIds: ["network:prod"], elsewhere: 1 } } : result;
  const marker = (result: PreviewResult) =>
    renderRow(previewRow("app:prod", result, LINKS)).split("\n")[0] ?? "";

  test("puts them on a pending row, a drift row and an in sync row", () => {
    if (!PENDING.ok) throw new Error("the fixture is a diff");
    const inSync: PreviewResult = {
      ok: true,
      diff: { stackId: "app:prod", changes: [] },
      toolLog: "",
    };
    const drifted: PreviewResult = {
      ok: true,
      diff: {
        stackId: "app:prod",
        changes: [],
        drift: [
          {
            address: "x",
            type: "local:index/file:File",
            name: "notes",
            op: "delete",
            changedKeys: [],
            replaceKeys: [],
          },
        ],
      },
      toolLog: "",
    };
    for (const result of [PENDING, inSync, drifted]) {
      expect(marker(read(result))).toContain(' depends-on="network:prod" -->');
    }
  });

  test("a preview that read none, or was not asked, adds nothing", () => {
    if (!PENDING.ok) throw new Error("the fixture is a diff");
    expect(marker(PENDING)).not.toContain("depends-on");
    expect(marker({ ...PENDING, dependencies: { stackIds: [], elsewhere: 2 } })).not.toContain(
      "depends-on",
    );
  });
});
