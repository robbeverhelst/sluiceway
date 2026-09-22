import { describe, expect, test } from "bun:test";
import type { Adapter, DeployHistoryResult, ToolDeploy } from "../../src/adapters/adapter.ts";
import { stackId } from "../../src/core/stack.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  change,
  dashboardBody,
  drifted,
  failing,
  harness,
  inSync,
  pending,
  SHA,
  tableAdapter,
} from "./harness.ts";

// Record 0076: a row shows the failure line only while no deploy of its stack,
// from the dashboard or outside it, ended after the failure. A deploy outside
// the dashboard is one a full scan found in the tool's history (record 0073),
// or one whose line the body carries. The trail keeps the failed deploy.

const OLD = "1111111111111111111111111111111111111111";
const COMMIT = "59ff6e77e502bf395aae44f33ec3e94bc2897d02";

const TABLE = {
  "app:prod": pending("app:prod", change("motd")),
  "network:dev": inSync("network:dev"),
  "site:prod": inSync("site:prod"),
  "web:prod": failing(),
};
const DRIFTS = { "site:prod": drifted("site:prod", change("assets")) };
const STACKS = Object.keys(TABLE);

// Failed at 05:52, from the dashboard.
function seedFailure(github: ReturnType<typeof harness>["github"], stack: string, run: string) {
  github.seedDeployment({
    task: `sluiceway:${stack}`,
    payload: { v: 1, hash: "2b44350653e84a11", ticker: "alice", run },
    createdAt: "2026-09-21T05:50:00Z",
    status: {
      state: "failure",
      description: "the tool exited with an error (exit code 255)",
      createdAt: "2026-09-21T05:52:10Z",
    },
  });
  github.seedRun(run, { completed: true });
}

const after: ToolDeploy = {
  kind: "deploy",
  endedAt: new Date("2026-09-21T05:55:00.000Z"),
  commit: { sha: COMMIT, dirty: false },
};
const before: ToolDeploy = { ...after, endedAt: new Date("2026-09-21T05:40:00.000Z") };

const ok = (...deploys: ToolDeploy[]): DeployHistoryResult => ({ ok: true, deploys, toolLog: "" });

// The table adapter of the harness, with a history per stack.
function withHistory(answers: Record<string, DeployHistoryResult>): Adapter & {
  previewed: string[];
} {
  const base = tableAdapter(TABLE, {}, {}, DRIFTS);
  return {
    ...base,
    previewed: base.previewed,
    deployHistory: async (stack) => answers[stackId(stack)],
  };
}

function rowText(body: string, stack: string): string {
  return parseDashboard(body).rows.find((row) => row.stackId === stack)?.text ?? "";
}

function trail(body: string): string[] {
  const all = body.split("\n\n");
  const at = all.indexOf("## Recently deployed");
  return at === -1 ? [] : (all[at + 2]?.split("\n") ?? []);
}

const DRIFT_ON = "drift:\n  enabled: true\n";

describe("a full scan", () => {
  test("drops the failure line of every row whose stack was deployed outside the dashboard after the failure", async () => {
    const adapter = withHistory(Object.fromEntries(STACKS.map((id) => [id, ok(after)])));
    const { context, github } = harness(adapter, { config: DRIFT_ON, event: "schedule" });
    STACKS.forEach((stack, i) => {
      seedFailure(github, stack, String(70 + i));
    });

    await scan(context);

    const body = dashboardBody(github);
    const states = Object.fromEntries(
      parseDashboard(body).rows.map((row) => [row.stackId, row.known ? row.state : ""]),
    );
    expect(states).toEqual({
      "app:prod": "pending",
      "network:dev": "in-sync",
      "site:prod": "drift",
      "web:prod": "preview-failed",
    });
    for (const stack of STACKS) {
      expect(rowText(body, stack)).not.toContain("last deploy failed");
      expect(rowText(body, stack)).not.toContain('failed="true"');
    }
    expect(body).not.toContain("failed deploy");
    expect(body).toMatchSnapshot();
    // The trail keeps every failed deploy, and lists the outside ones.
    const lines = trail(body);
    for (const stack of STACKS) {
      expect(lines.some((line) => line.includes(`${stack} · failed · alice`))).toBe(true);
      expect(lines.some((line) => line.includes(`${stack} · deployed outside the dashboard`))).toBe(
        true,
      );
    }
  });

  test("keeps the failure line when the outside deploy ended before the failure", async () => {
    const adapter = withHistory(Object.fromEntries(STACKS.map((id) => [id, ok(before)])));
    const { context, github } = harness(adapter, { config: DRIFT_ON, event: "schedule" });
    STACKS.forEach((stack, i) => {
      seedFailure(github, stack, String(70 + i));
    });

    await scan(context);

    const body = dashboardBody(github);
    for (const stack of STACKS) {
      expect(rowText(body, stack)).toContain(
        ":x: last deploy failed: the tool exited with an error (exit code 255) · ticked by alice",
      );
    }
    expect(body).toContain("4 failed deploys");
  });
});

describe("a narrowed scan", () => {
  test("drops the failure line of a stack it previews from the outside lines the body carries", async () => {
    // The first scan runs before the failure, and finds the outside deploy.
    const first = harness(withHistory({ "app:prod": ok(after) }), { sha: OLD });
    await scan(first.context);
    seedFailure(first.github, "app:prod", "70");
    // The outside deploy ended after the failure: the failure is at 05:52 and
    // the outside deploy at 05:55.
    first.github.seedComparison(OLD, SHA, {
      status: "ahead",
      files: [{ path: "app/Pulumi.yaml" }],
    });
    const pushed = withHistory({});
    await scan({ ...first.context, adapter: pushed, sha: SHA, runId: "4343", event: "push" });

    // Narrowed: app:prod is previewed, network:dev is carried.
    expect(pushed.previewed).toContain("app:prod");
    expect(pushed.previewed).not.toContain("network:dev");
    const body = dashboardBody(first.github);
    expect(rowText(body, "app:prod")).not.toContain("last deploy failed");
    expect(trail(body).some((line) => line.includes("app:prod · failed · alice"))).toBe(true);
  });
});
