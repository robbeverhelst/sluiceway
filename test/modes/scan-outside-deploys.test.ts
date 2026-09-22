import { describe, expect, test } from "bun:test";
import type { Adapter, DeployHistoryResult, ToolDeploy } from "../../src/adapters/adapter.ts";
import { stackId } from "../../src/core/stack.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  change,
  dashboardBody,
  harness,
  inSync,
  pending,
  REPO_URL,
  SHA,
  tableAdapter,
} from "./harness.ts";

// Record 0073: a full scan reads the tool's own history of every stack whose
// tool keeps one, and every deploy there that no deployment record of the
// stack ran is an outside deploy on the trail.

const COMMIT = "59ff6e77e502bf395aae44f33ec3e94bc2897d02";
const OLD = "1111111111111111111111111111111111111111";

const TABLE = {
  "app:prod": pending("app:prod", change("motd")),
  "network:dev": inSync("network:dev"),
  "site:prod": inSync("site:prod"),
};

const laptop: ToolDeploy = {
  kind: "deploy",
  endedAt: new Date("2026-09-20T18:11:10.000Z"),
  commit: { sha: COMMIT, dirty: false },
};
const ours: ToolDeploy = {
  kind: "deploy",
  endedAt: new Date("2026-09-20T12:00:00.000Z"),
  runId: "77",
};

type Answers = Record<string, DeployHistoryResult | undefined>;

interface HistoryAdapter extends Adapter {
  read: { id: string; limit: number }[];
  previewed: string[];
}

// The table adapter of the harness, with a history per stack. A stack that
// is not in `answers` belongs to a tool that keeps none.
function withHistory(answers: Answers, table: Parameters<typeof tableAdapter>[0] = TABLE) {
  const base = tableAdapter(table);
  const adapter: HistoryAdapter = {
    ...base,
    previewed: base.previewed,
    read: [],
    deployHistory: async (stack, options) => {
      const id = stackId(stack);
      if (!Object.hasOwn(answers, id)) return undefined;
      adapter.read.push({ id, limit: options.limit });
      return answers[id];
    },
  };
  return adapter;
}

const ok = (...deploys: ToolDeploy[]): DeployHistoryResult => ({ ok: true, deploys, toolLog: "" });

function trail(body: string): string[] {
  const all = body.split("\n\n");
  const at = all.indexOf("## Recently deployed");
  return at === -1 ? [] : (all[at + 2]?.split("\n") ?? []);
}

function seedOwnDeploy(github: ReturnType<typeof harness>["github"], run: string) {
  github.seedDeployment({
    task: "sluiceway:network:dev",
    payload: { v: 1, hash: "2b44350653e84a11", ticker: "alice", run },
    status: { state: "success", createdAt: "2026-09-20T12:01:00Z" },
  });
}

describe("a full scan", () => {
  test("lists a deploy from outside and leaves out one that a record of the stack ran", async () => {
    const adapter = withHistory({ "network:dev": ok(laptop, ours), "site:prod": ok() });
    const { context, github } = harness(adapter);
    seedOwnDeploy(github, "77");
    github.seedRun("77", { completed: true });

    await scan(context);

    const lines = trail(dashboardBody(github));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      `- 🟢&nbsp;network:dev · deployed outside the dashboard, from [\`59ff6e7\`](${REPO_URL}/commit/${COMMIT}) · 09-20 18:11 <!-- sluiceway:outside stack="network:dev" kind="deploy" at="2026-09-20T18:11:10.000Z" commit="${COMMIT}" -->`,
    );
    expect(lines[1]).toContain("network:dev · alice · ");
  });

  test("reads as many entries as the trail lists, and none when it lists none", async () => {
    const adapter = withHistory({ "network:dev": ok(laptop) });
    await scan(harness(adapter, { config: "dashboard:\n  recentlyDeployed: 25\n" }).context);
    expect(adapter.read).toEqual([{ id: "network:dev", limit: 25 }]);

    const off = withHistory({ "network:dev": ok(laptop) });
    const { context, github } = harness(off, { config: "dashboard:\n  recentlyDeployed: 0\n" });
    await scan(context);
    expect(off.read).toEqual([]);
    expect(dashboardBody(github)).not.toContain("Recently deployed");
  });

  test("says which stacks it could not read because their tool keeps no history", async () => {
    const adapter = withHistory({ "network:dev": ok() });
    const { context, log } = harness(adapter);
    await scan(context);
    expect(log.lines).toContain(
      "2 stacks were not read for deploys made outside the dashboard: their tool keeps no history of its deploys (record 0073). app:prod, site:prod.",
    );
  });

  test("a history that cannot be read keeps the stack's lines, and the scan stays green", async () => {
    const first = harness(withHistory({ "network:dev": ok(laptop) }));
    await scan(first.context);

    const broken = withHistory({
      "network:dev": {
        ok: false,
        reason: { kind: "tool-error", exitCode: 255 },
        detail: [],
        toolLog: "error: the backend could not be reached\n",
      },
    });
    const { log } = harness(broken);
    await scan({ ...first.context, adapter: broken, log, runId: "4343" });

    expect(trail(dashboardBody(first.github))).toHaveLength(1);
    expect(log.warnings).toContainEqual({
      title: "History not read",
      message:
        "The history of network:dev could not be read: the tool exited with an error (exit code 255). Its deploys made outside the dashboard stay as the dashboard listed them.",
    });
    expect(log.groups.find((group) => group.title === "network:dev, its history")?.lines).toContain(
      "error: the backend could not be reached",
    );
  });

  test("a deploy that is gone from the history is gone from the trail", async () => {
    const first = harness(withHistory({ "network:dev": ok(laptop) }));
    await scan(first.context);
    const again = withHistory({ "network:dev": ok() });
    await scan({ ...first.context, adapter: again, runId: "4343" });
    expect(trail(dashboardBody(first.github))).toEqual([]);
  });
});

describe("a narrowed scan", () => {
  test("reads no history and carries the lines the body has", async () => {
    const first = harness(withHistory({ "network:dev": ok(laptop) }), { sha: OLD });
    await scan(first.context);
    const before = trail(dashboardBody(first.github));
    expect(before).toHaveLength(1);

    first.github.seedComparison(OLD, SHA, {
      status: "ahead",
      files: [{ path: "app/Pulumi.yaml" }],
    });
    const pushed = withHistory({ "network:dev": ok() });
    await scan({ ...first.context, adapter: pushed, sha: SHA, runId: "4343", event: "push" });

    expect(pushed.previewed).toEqual(["app:prod"]);
    expect(pushed.read).toEqual([]);
    expect(trail(dashboardBody(first.github))).toEqual(before);
    expect(parseDashboard(dashboardBody(first.github)).outside).toHaveLength(1);
  });
});
