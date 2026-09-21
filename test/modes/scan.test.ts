import { describe, expect, test } from "bun:test";
import { ToolVersionError } from "../../src/adapters/adapter.ts";
import { ConfigError } from "../../src/core/config.ts";
import { DiscoveryError } from "../../src/core/discovery.ts";
import { DashboardWriteError } from "../../src/github/write-loop.ts";
import { ScanFailedError, scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { BOT, FakeGitHub } from "../fake-github/fake-github.ts";
import {
  change,
  dashboardBody,
  failing,
  harness,
  inSync,
  pending,
  RUN_URL,
  SHA,
  tableAdapter,
} from "./harness.ts";

function rowStates(body: string): Record<string, string> {
  return Object.fromEntries(parseDashboard(body).rows.map((row) => [row.stackId, row.state]));
}

describe("a full scan", () => {
  test("previews every stack and creates the dashboard with one row for each", async () => {
    const adapter = tableAdapter({
      "network:dev": pending("network:dev", change("logs"), change("old", "delete")),
      "network:prod": inSync("network:prod"),
    });
    const { context, github } = harness(adapter);

    await scan(context);

    const issue = github.issue(1);
    expect(issue.title).toBe("Sluiceway dashboard");
    expect(issue.labels).toEqual(["sluiceway"]);
    expect(rowStates(issue.body)).toEqual({ "network:dev": "pending", "network:prod": "in-sync" });
    expect(issue.body).toContain(
      `- [ ] **network:dev** · 1 update, **1 delete** · [preview](${RUN_URL})`,
    );
  });

  test("the root marker holds the commit, the run, the time, and the same for the full scan", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": inSync("a:prod") }));
    await scan(context);
    expect(parseDashboard(dashboardBody(github)).root).toEqual({
      version: 1,
      scanSha: SHA,
      scanRun: "4242",
      scanAt: "2026-09-21T06:00:00.000Z",
      fullScanAt: "2026-09-21T06:00:00.000Z",
      fullScanRun: "4242",
    });
  });

  test("a second scan rewrites the same issue", async () => {
    const adapter = tableAdapter({ "a:prod": pending("a:prod", change("logs")) });
    const first = harness(adapter);
    await scan(first.context);
    await scan({ ...first.context, adapter: tableAdapter({ "a:prod": inSync("a:prod") }) });
    expect(rowStates(dashboardBody(first.github))).toEqual({ "a:prod": "in-sync" });
    expect(first.github.requests.filter((request) => request === "createIssue")).toHaveLength(1);
  });

  test("a repo with no stacks gets the first-run dashboard, and the tool is never asked for", async () => {
    const adapter = tableAdapter({});
    const { context, github, log } = harness(adapter);
    await scan(context);
    expect(parseDashboard(dashboardBody(github)).rows).toEqual([]);
    expect(dashboardBody(github)).toContain("first-run-light.svg");
    expect(adapter.versionChecks).toBe(0);
    expect(log.lines).toContain("Found no stacks.");
  });
});

describe("the pool (record 0012)", () => {
  test("previews in stack id order, never more at once than the concurrency input", async () => {
    let running = 0;
    let most = 0;
    const slow = (id: string) => async () => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return inSync(id);
    };
    // Discovery hands them over in another order than the pool has to use.
    const ids = ["e:prod", "b:prod", "d:prod", "a:prod", "c:prod"];
    const adapter = tableAdapter(Object.fromEntries(ids.map((id) => [id, slow(id)])));
    const { context } = harness(adapter, { concurrency: 2 });

    await scan(context);

    expect(adapter.previewed).toEqual(["a:prod", "b:prod", "c:prod", "d:prod", "e:prod"]);
    expect(most).toBe(2);
  });

  test("the version check comes once, before any preview", async () => {
    const adapter = tableAdapter({ "a:prod": inSync("a:prod"), "b:prod": inSync("b:prod") });
    const order: string[] = [];
    const check = adapter.checkVersion;
    adapter.checkVersion = async (context) => {
      order.push(`check, ${adapter.previewed.length} previewed`);
      return check(context);
    };
    await scan(harness(adapter).context);
    expect(order).toEqual(["check, 0 previewed"]);
  });

  test("a stack's own previewTimeout wins over the input", async () => {
    const adapter = tableAdapter({ "a:prod": inSync("a:prod"), "b:prod": inSync("b:prod") });
    const { context } = harness(adapter, {
      previewTimeoutMinutes: 7,
      config: "stacks:\n  - path: b\n    previewTimeout: 30\n",
    });
    await scan(context);
    expect(adapter.timeouts).toEqual({ "a:prod": 7, "b:prod": 30 });
  });

  test("an ignored stack is never previewed and has no row", async () => {
    const adapter = tableAdapter({ "a:prod": inSync("a:prod"), "play:dev": inSync("play:dev") });
    const { context, github } = harness(adapter, { config: 'ignore: ["play:*"]\n' });
    await scan(context);
    expect(adapter.previewed).toEqual(["a:prod"]);
    expect(rowStates(dashboardBody(github))).toEqual({ "a:prod": "in-sync" });
  });

  test("the tool gets the root, the environment and the runner of the job", async () => {
    let seen: unknown;
    const adapter = tableAdapter({
      "a:prod": async (options) => {
        seen = { root: options.root, env: options.env, run: options.run };
        return inSync("a:prod");
      },
    });
    const { context } = harness(adapter);
    await scan(context);
    expect(seen).toEqual({ root: context.root, env: context.env, run: context.run });
  });
});

describe("the job result (record 0012)", () => {
  test("one broken stack never stops the others, and the job is green", async () => {
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("logs")),
      "b:prod": failing(),
      "c:prod": inSync("c:prod"),
    });
    const { context, github, log } = harness(adapter);

    await scan(context);

    expect(rowStates(dashboardBody(github))).toEqual({
      "a:prod": "pending",
      "b:prod": "preview-failed",
      "c:prod": "in-sync",
    });
    expect(dashboardBody(github)).toContain(
      `- **b:prod** · preview failed: the tool exited with an error (exit code 255) · [run](${RUN_URL})`,
    );
    expect(log.warnings).toEqual([
      {
        title: "Preview failed",
        message: "The preview of b:prod failed: the tool exited with an error (exit code 255).",
      },
    ]);
  });

  test("every preview failing turns the job red, after the dashboard was written", async () => {
    const adapter = tableAdapter({ "a:prod": failing(), "b:prod": failing() });
    const { context, github, log } = harness(adapter);

    const result = scan(context);

    await expect(result).rejects.toBeInstanceOf(ScanFailedError);
    await expect(result).rejects.toThrow(
      "Every preview failed (2 of 2). That nearly always means the environment is broken",
    );
    expect(rowStates(dashboardBody(github))).toEqual({
      "a:prod": "preview-failed",
      "b:prod": "preview-failed",
    });
    expect(log.warnings).toHaveLength(2);
    expect(log.summaries).toHaveLength(1);
  });

  test("the only stack of a repo failing leaves the job green", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": failing() }));
    await scan(context);
    expect(rowStates(dashboardBody(github))).toEqual({ "a:prod": "preview-failed" });
  });

  test("a config entry that matches no discovered stack fails the scan before anything runs", async () => {
    const adapter = tableAdapter({ "a:prod": inSync("a:prod") });
    const { context, github } = harness(adapter, { config: "stacks:\n  - path: nowhere\n" });

    const result = scan(context);

    await expect(result).rejects.toBeInstanceOf(ConfigError);
    await expect(result).rejects.toThrow(
      'sluiceway.yaml is not valid:\n- stacks[0]: no stack was found in "nowhere". An entry adds settings to a stack that exists, it never creates one.',
    );
    expect(adapter.versionChecks).toBe(0);
    expect(adapter.previewed).toEqual([]);
    expect(github.requests).toEqual([]);
  });

  test("a discovery error fails the scan before anything runs", async () => {
    const adapter = tableAdapter({});
    adapter.discover = async () => {
      throw new DiscoveryError(["a/Pulumi.yaml could not be read."]);
    };
    const { context, github } = harness(adapter);
    await expect(scan(context)).rejects.toBeInstanceOf(DiscoveryError);
    expect(github.requests).toEqual([]);
  });

  test("a tool below the floor fails the scan, and what it printed goes to the job log only", async () => {
    const adapter = tableAdapter({ "a:prod": inSync("a:prod") });
    adapter.checkVersion = async () => {
      throw new ToolVersionError("Found pulumi v3.100.0. Sluiceway needs more.", "warning: old\n");
    };
    const { context, github, log } = harness(adapter);

    await expect(scan(context)).rejects.toThrow("Found pulumi v3.100.0. Sluiceway needs more.");

    expect(adapter.previewed).toEqual([]);
    expect(github.requests).toEqual([]);
    expect(log.groups).toEqual([{ title: "The tool's own words", lines: ["warning: old"] }]);
  });

  test("a dashboard that does not fit fails the scan and leaves the old body", async () => {
    const adapter = tableAdapter({ "a:prod": pending("a:prod", change("logs")) });
    const { context, github } = harness(adapter);
    await scan(context);
    const before = dashboardBody(github);

    const result = scan({ ...context, limits: { body: { limit: 200 } } });

    await expect(result).rejects.toThrow("The dashboard does not fit in one issue.");
    expect(dashboardBody(github)).toBe(before);
  });

  test("a write that never sticks fails the scan after three tries", async () => {
    const github = new FakeGitHub({ updateLimitBytes: 10 });
    github.seedIssue({
      author: BOT,
      labels: ["sluiceway"],
      body: '<!-- sluiceway:dashboard v="1" -->\n',
    });
    const { context } = harness(tableAdapter({ "a:prod": inSync("a:prod") }), { github });
    await expect(scan(context)).rejects.toBeInstanceOf(DashboardWriteError);
    expect(github.requests.filter((request) => request === "updateIssueBody")).toHaveLength(3);
  });
});

describe("the summary (record 0037)", () => {
  test("shows every previewed stack", async () => {
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("logs")),
      "b:prod": failing(),
    });
    const { context, log } = harness(adapter);
    await scan(context);
    expect(log.summaries).toHaveLength(1);
    expect(log.summaries[0]).toContain("2 stacks previewed: 1 pending, 1 preview failed.");
    expect(log.summaries[0]).toContain(
      "- **b:prod** · the tool exited with an error (exit code 255)",
    );
  });

  test("a summary that cannot be written does not stop the scan", async () => {
    const adapter = tableAdapter({ "a:prod": pending("a:prod", change("logs")) });
    const { context, github, log } = harness(adapter);
    log.writeSummary = async () => {
      throw new Error("ENOSPC: no space left on device");
    };

    await scan(context);

    expect(rowStates(dashboardBody(github))).toEqual({ "a:prod": "pending" });
    expect(log.warnings).toEqual([
      {
        title: "Summary not written",
        message:
          "The summary of this run could not be written. The dashboard is still brought up to date, and the job log of this run holds every diff in full.",
      },
    ]);
    expect(log.lines).toContain("Writing the summary failed: ENOSPC: no space left on device");
  });

  test("a summary over its budget is not written, and the scan goes on", async () => {
    const adapter = tableAdapter({ "a:prod": pending("a:prod", change("logs")) });
    const { context, github, log } = harness(adapter, { limits: { summaryBudget: 50 } });

    await scan(context);

    expect(log.summaries).toEqual([]);
    expect(log.warnings.map((warning) => warning.title)).toEqual(["Summary not written"]);
    expect(rowStates(dashboardBody(github))).toEqual({ "a:prod": "pending" });
  });

  test("redact keeps names out of the issue and leaves the summary full", async () => {
    const adapter = tableAdapter({ "a:prod": pending("a:prod", change("customer-uploads")) });
    const { context, github, log } = harness(adapter, { config: "dashboard:\n  redact: true\n" });
    await scan(context);
    expect(dashboardBody(github)).not.toContain("customer-uploads");
    expect(log.summaries[0]).toContain("customer-uploads");
  });
});

describe("the job log", () => {
  test("says how long each preview took and the total, for reading the pool size and the time limit from", async () => {
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("logs")),
      "b:prod": failing(),
    });
    const { context, log } = harness(adapter, { concurrency: 1 });
    await scan(context);
    expect(log.lines.slice(0, 3)).toEqual([
      "Found 2 stacks.",
      "This is a full scan: the event is workflow_dispatch, and only a push gives a narrowed scan.",
      "Previewing 2 stacks with a pool of 1 and a time limit of 10 minutes for each preview.",
    ]);
    expect(log.lines).toContain("Previewed a:prod in 0.5 s: pending");
    expect(log.lines).toContain(
      "Previewed b:prod in 0.5 s: preview failed, the tool exited with an error (exit code 255)",
    );
    expect(log.lines).toContain(
      "Previewed 2 stacks in 2.5 s with a pool of 1. Added up, the previews took 1.0 s. The slowest was a:prod with 0.5 s.",
    );
  });

  test("holds one group per stack, with the diff in full and the tool's own words", async () => {
    const adapter = tableAdapter({
      "a:prod": {
        ...pending("a:prod", change("logs"), change("old", "delete")),
        toolLog: "warning: provider is deprecated\n",
      },
      "b:prod": {
        ok: false,
        reason: { kind: "unreadable-output" },
        detail: ["steps[3].op: expected a string."],
        toolLog: "",
      },
    });
    const { context, log } = harness(adapter);
    await scan(context);
    expect(log.groups).toEqual([
      {
        title: "a:prod",
        lines: [
          "1 update, 1 delete",
          "DELETE aws:s3/bucket:Bucket old",
          "update aws:s3/bucket:Bucket logs · tags",
          "The tool's own words:",
          "warning: provider is deprecated",
        ],
      },
      {
        title: "b:prod",
        lines: [
          "preview failed: the tool's output could not be read",
          "steps[3].op: expected a string.",
        ],
      },
    ]);
  });

  test("says which dashboard it wrote", async () => {
    const { context, log } = harness(tableAdapter({ "a:prod": inSync("a:prod") }));
    await scan(context);
    expect(log.lines.filter((line) => line.includes("dashboard"))).toEqual([
      expect.stringMatching(
        /^Created the dashboard: https:\/\/github\.com\/acme\/infra\/issues\/1 \([\d,]+ of 65,536 characters\)\.$/,
      ),
    ]);
  });

  test("a new dashboard that could not be pinned is a warning, not a failure", async () => {
    const github = new FakeGitHub();
    for (let pinned = 0; pinned < 3; pinned++) {
      await github.pinIssue(github.seedIssue().nodeId);
    }
    const { context, log } = harness(tableAdapter({ "a:prod": inSync("a:prod") }), { github });
    await scan(context);
    expect(log.warnings.map((warning) => warning.title)).toEqual(["Dashboard not pinned"]);
  });
});
