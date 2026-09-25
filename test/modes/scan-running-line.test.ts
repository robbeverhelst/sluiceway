import { describe, expect, test } from "bun:test";
import type { Adapter } from "../../src/adapters/adapter.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import type { FakeGitHub } from "../fake-github/fake-github.ts";
import {
  change,
  dashboardBody,
  harness,
  inSync,
  pending,
  REPO_URL,
  tableAdapter,
} from "./harness.ts";

// Record 0108: a scan says it is running, on the dashboard, as its first act,
// and takes the line away when it writes the body at the end. The harness's
// scan starts at 2026-09-21 06:00 UTC as run 4242.

const TABLE = {
  "app:prod": pending("app:prod", change("bucket")),
  "db:prod": inSync("db:prod"),
};

// The adapter of the table, and the dashboard body as it stood when each
// preview started.
function watching(github: FakeGitHub, table = TABLE) {
  const inner = tableAdapter(table);
  const bodies: string[] = [];
  const adapter: Adapter = {
    ...inner,
    preview: async (...args) => {
      bodies.push(github.issue(1).body);
      return inner.preview(...args);
    },
  };
  return { adapter, bodies };
}

function rowTexts(body: string): string[] {
  return parseDashboard(body).rows.map((row) => row.text);
}

describe("the line that says a scan is running", () => {
  test("is written before the first preview, with every row as it was and the rescan box unticked, and goes with the body at the end", async () => {
    const first = harness(tableAdapter(TABLE));
    await scan(first.context);
    const before = dashboardBody(first.github);
    expect(before).toContain("- [ ] Rescan all stacks");
    first.github.editBody(1, before.replace("- [ ] Rescan all stacks", "- [x] Rescan all stacks"));

    const { adapter, bodies } = watching(first.github);
    const { context, log } = harness(adapter, { github: first.github, runId: "4243" });
    await scan(context);

    expect(bodies).toHaveLength(2);
    const seen = bodies[0] ?? "";
    expect(bodies[1]).toBe(seen);
    expect(seen).toContain(
      `A scan is running since 2026-09-21 06:00 UTC · [run](${REPO_URL}/actions/runs/4243)`,
    );
    expect(parseDashboard(seen).root).toMatchObject({
      scanRun: "4242",
      scanRunning: { run: "4243", since: "2026-09-21T06:00:00.000Z" },
    });
    expect(rowTexts(seen)).toEqual(rowTexts(before));
    expect(seen).toContain("- [ ] Rescan all stacks");
    expect(log.lines).toContain(
      `The dashboard says a scan is running, under the scan line, until this scan writes the body (record 0108): ${REPO_URL}/actions/runs/4243`,
    );

    const after = dashboardBody(first.github);
    expect(after).not.toContain("A scan is running");
    expect(parseDashboard(after).root?.scanRunning).toBeUndefined();
    expect(parseDashboard(after).root?.scanRun).toBe("4243");
  });
});
