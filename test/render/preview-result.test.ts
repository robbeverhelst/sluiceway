import { describe, expect, test } from "bun:test";
import type { PreviewResult } from "../../src/adapters/adapter.ts";
import { previewRow } from "../../src/render/preview-result.ts";
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
