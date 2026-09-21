import { describe, expect, test } from "bun:test";
import type { Comparison } from "../../src/github/port.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  change,
  dashboardBody,
  type Harness,
  harness,
  inSync,
  pending,
  SHA,
  type TableAdapter,
  tableAdapter,
} from "./harness.ts";

// The commit of the scan that wrote the dashboard a push then meets.
const OLD = "1111111111111111111111111111111111111111";
const OLD_RUN = "4000";

type Table = Parameters<typeof tableAdapter>[0];

// A repo whose dashboard an earlier full scan wrote at OLD. What comes back is
// the harness of the scan that follows a push to SHA, with a fresh adapter on
// the same table, so `previewed` holds only what that scan previews.
async function pushed(
  table: Table,
  comparison: Comparison | undefined,
  options: { config?: string; next?: Table } = {},
): Promise<Harness & { adapter: TableAdapter; before: string }> {
  const first = harness(tableAdapter(table), {
    sha: OLD,
    runId: OLD_RUN,
    ...(options.config === undefined ? {} : { config: options.config }),
  });
  await scan(first.context);
  const before = dashboardBody(first.github);

  const adapter = tableAdapter({ ...table, ...options.next });
  // Discovery follows the first table, so a stack that `next` adds is new.
  if (comparison) first.github.seedComparison(OLD, SHA, comparison);
  const log = harness(adapter).log;
  return {
    context: { ...first.context, adapter, log, sha: SHA, runId: "4242", event: "push" },
    github: first.github,
    log,
    adapter,
    before,
  };
}

function ahead(...paths: string[]): Comparison {
  return { status: "ahead", files: paths.map((path) => ({ path })) };
}

function rowTexts(body: string): Record<string, string> {
  return Object.fromEntries(parseDashboard(body).rows.map((row) => [row.stackId, row.text]));
}

const TABLE: Table = {
  "app:prod": pending("app:prod", change("motd")),
  "network:dev": pending("network:dev", change("logs"), change("old", "delete")),
  "network:prod": inSync("network:prod"),
  "site:prod": inSync("site:prod"),
};

describe("a scan that follows a push", () => {
  test("previews only the stacks that claim a changed file, and keeps every other row as it is", async () => {
    const { context, github, adapter, before } = await pushed(TABLE, ahead("site/index.ts"), {
      next: { "site:prod": pending("site:prod", change("page")) },
    });

    await scan(context);

    expect(adapter.previewed).toEqual(["site:prod"]);
    const rows = rowTexts(dashboardBody(github));
    expect(rows["site:prod"]).toContain("- [ ] **site:prod** · 1 update");
    expect(rows["site:prod"]).toContain("/actions/runs/4242");
    for (const carried of ["app:prod", "network:dev", "network:prod"]) {
      expect(rows[carried]).toBe(rowTexts(before)[carried] as string);
    }
    // A carried row keeps the link to the run that previewed it (record 0011).
    expect(rows["network:dev"]).toContain(`/actions/runs/${OLD_RUN}`);
  });
});
