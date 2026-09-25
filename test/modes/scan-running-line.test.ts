import { describe, expect, test } from "bun:test";
import type { Adapter } from "../../src/adapters/adapter.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";
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

  test("a first scan has no dashboard to say it on: it looks once, previews, and creates the dashboard without the line", async () => {
    const github = new FakeGitHub();
    const inner = tableAdapter(TABLE);
    let requestsAtPreview: string[] | undefined;
    const adapter: Adapter = {
      ...inner,
      preview: async (...args) => {
        requestsAtPreview ??= [...github.requests];
        return inner.preview(...args);
      },
    };
    const { context, log } = harness(adapter, { github });

    await scan(context);

    expect(requestsAtPreview).toEqual(["listIssues"]);
    expect(dashboardBody(github)).not.toContain("A scan is running");
    expect(log.lines.join("\n")).not.toContain("scan is running");
  });

  test("a ticked row keeps its tick through the first write, and the end of the scan judges it as before", async () => {
    const first = harness(tableAdapter(TABLE));
    await scan(first.context);
    const ticked = dashboardBody(first.github).replace("- [ ] **app:prod**", "- [x] **app:prod**");
    first.github.editBody(1, ticked);

    const { adapter, bodies } = watching(first.github);
    await scan(harness(adapter, { github: first.github, runId: "4243" }).context);

    const isTicked = (body: string) => {
      const row = parseDashboard(body).rows.find((one) => one.stackId === "app:prod");
      return row?.known ? row.ticked : undefined;
    };
    const seen = parseDashboard(bodies[0] ?? "");
    expect(isTicked(bodies[0] ?? "")).toBe(true);
    expect(seen.rescanTicked).toBe(false);
    // No run that an issue edit started is on its way, so the tick is an
    // orphan and the end of the scan clears it (record 0025).
    expect(isTicked(dashboardBody(first.github))).toBe(false);
    expect(parseDashboard(dashboardBody(first.github)).root?.scanRunning).toBeUndefined();
  });

  test("a scan that dies before its write at the end leaves the line, and the next scan replaces it with its own", async () => {
    const first = harness(tableAdapter(TABLE));
    await scan(first.context);
    const { github } = first;

    // The second read of the dashboard's issues is the write at the end.
    let finds = 0;
    github.onRequest = (request) => {
      if (request === "listIssues" && ++finds === 2) throw new Error("Server Error");
    };
    await expect(
      scan(harness(tableAdapter(TABLE), { github, runId: "4243" }).context),
    ).rejects.toThrow("Server Error");
    github.onRequest = undefined;
    const left = dashboardBody(github);
    expect(left).toContain(
      `A scan is running since 2026-09-21 06:00 UTC · [run](${REPO_URL}/actions/runs/4243)`,
    );
    expect(parseDashboard(left).root?.scanRun).toBe("4242");

    const { adapter, bodies } = watching(github);
    await scan(harness(adapter, { github, runId: "4244" }).context);

    expect(parseDashboard(bodies[0] ?? "").root?.scanRunning).toEqual({
      run: "4244",
      since: "2026-09-21T06:00:00.000Z",
    });
    expect(bodies[0]).not.toContain("actions/runs/4243)");
    expect(dashboardBody(github)).not.toContain("A scan is running");
  });

  test("a first write GitHub refuses is a line of the job log, and the scan goes on to its previews and its write at the end", async () => {
    const first = harness(tableAdapter(TABLE));
    await scan(first.context);
    const { github } = first;
    const before = dashboardBody(github);
    let writes = 0;
    github.onRequest = (request) => {
      if (request === "updateIssueBody" && ++writes === 1) throw new Error("Server Error");
    };

    const { adapter, bodies } = watching(github);
    const { context, log } = harness(adapter, { github, runId: "4243" });
    await scan(context);

    expect(bodies[0]).toBe(before);
    expect(log.lines).toContain(
      "The dashboard could not say a scan is running: Server Error. The scan goes on (record 0108).",
    );
    expect(log.warnings).toEqual([]);
    const after = parseDashboard(dashboardBody(github));
    expect(after.root?.scanRun).toBe("4243");
    expect(after.root?.scanRunning).toBeUndefined();
  });

  test("a body of another version is left alone by the first write", async () => {
    const first = harness(tableAdapter(TABLE));
    await scan(first.context);
    const { github } = first;
    const other = dashboardBody(github).replace(
      'sluiceway:dashboard v="1"',
      'sluiceway:dashboard v="2"',
    );
    github.editBody(1, other);

    const { adapter, bodies } = watching(github);
    await scan(harness(adapter, { github, runId: "4243" }).context);

    expect(bodies[0]).toBe(other);
    expect(dashboardBody(github)).toStartWith('<!-- sluiceway:dashboard v="1"');
    expect(dashboardBody(github)).not.toContain("A scan is running");
  });
});
