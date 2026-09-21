import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  change,
  dashboardBody,
  failing,
  harness,
  inSync,
  pending,
  REPO_URL,
  SHA,
  tableAdapter,
} from "./harness.ts";

// The scan and the deployment records (records 0003, 0004, 0027 and 0029):
// deploy facts live in GitHub and nowhere else, and the scan reads them at its
// late read.

const OLD = "1111111111111111111111111111111111111111";

function rows(body: string): Record<string, { state: string; text: string }> {
  return Object.fromEntries(
    parseDashboard(body).rows.map((row) => [row.stackId, { state: row.state, text: row.text }]),
  );
}

function payload(run: string, ticker = "alice") {
  return { v: 1, hash: "2b44350653e84a11", ticker, run };
}

function section(body: string, heading: string): string {
  const from = body.indexOf(`## ${heading}`);
  if (from < 0) return "";
  const rest = body.slice(from + heading.length + 3);
  const to = rest.search(/\n(## |---)/);
  return (to < 0 ? rest : rest.slice(0, to)).trim();
}

describe("a stack with an open deployment", () => {
  test("is deploying with no box, whatever the preview says", async () => {
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("logs"), change("old", "delete")),
      "b:prod": inSync("b:prod"),
    });
    const { context, github } = harness(adapter);
    github.seedDeployment({
      task: "sluiceway:a:prod",
      payload: payload("77", "carol"),
      status: { state: "queued" },
    });
    github.seedRun("77", { completed: false });

    await scan(context);

    const body = dashboardBody(github);
    // The row of record 0027. The count of destroys comes from the preview,
    // because the header and the counts line need it.
    expect(rows(body)["a:prod"]?.text).toBe(
      [
        `- **a:prod** · waiting to start · ticked by carol · [run](${REPO_URL}/actions/runs/77) <!-- sluiceway:row stack="a:prod" state="deploying" destroys="1" -->`,
        // No success of this stack is on record, so attribution has no commit
        // to start from (record 0026).
        "  not deployed from this dashboard yet",
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
    expect(body).toContain("**0 pending** · 1 deploying · 0 preview failed · 1 in sync");
    expect(body).not.toContain("- [ ] **a:prod**");
  });

  test("reads `deploying` once the record is in progress", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": inSync("a:prod") }));
    github.seedDeployment({ task: "sluiceway:a:prod", status: { state: "in_progress" } });
    github.seedRun("4242", { completed: false });

    await scan(context);
    expect(rows(dashboardBody(github))["a:prod"]?.text).toContain(
      "- **a:prod** · deploying · ticked by alice · ",
    );
  });

  test("keeps the live deploying row as `resolve` wrote it, byte for byte", async () => {
    const { context, github } = harness(
      tableAdapter({ "a:prod": pending("a:prod", change("logs")) }),
    );
    await scan(context);
    // What `resolve` writes holds a line a scan cannot make: attribution.
    const resolved = [
      `- **a:prod** · waiting to start · ticked by alice · [run](${REPO_URL}/actions/runs/77) <!-- sluiceway:row stack="a:prod" state="deploying" -->`,
      "  from #433 by alice",
      "  <!-- /sluiceway:row -->",
    ].join("\n");
    const live = dashboardBody(github);
    github.editBody(1, live.replace(rows(live)["a:prod"]?.text ?? "", resolved));
    github.seedDeployment({
      task: "sluiceway:a:prod",
      payload: payload("77"),
      status: { state: "in_progress" },
    });
    github.seedRun("77", { completed: false });

    await scan(context);
    expect(rows(dashboardBody(github))["a:prod"]?.text).toBe(resolved);
  });

  test("a narrowed scan that does not preview the stack makes its row from the record, with no preview", async () => {
    const table = {
      "a:prod": pending("a:prod", change("old", "delete")),
      "b:prod": inSync("b:prod"),
    };
    const first = harness(tableAdapter(table), { sha: OLD });
    await scan(first.context);
    first.github.seedComparison(OLD, SHA, { status: "ahead", files: [{ path: "b/index.ts" }] });
    first.github.seedDeployment({ task: "sluiceway:a:prod", status: { state: "queued" } });
    first.github.seedRun("4242", { completed: false });

    const adapter = tableAdapter(table);
    await scan({ ...first.context, adapter, sha: SHA, event: "push" });

    expect(adapter.previewed).toEqual(["b:prod"]);
    // The count of destroys is copied from the marker of the row it replaces.
    expect(rows(dashboardBody(first.github))["a:prod"]?.text).toContain(
      'state="deploying" destroys="1" -->',
    );
  });
});

describe("a deploying row that outlived its deployment", () => {
  test("is previewed by a narrowed scan that had no reason to, because nobody else will repair it", async () => {
    const table = { "a:prod": pending("a:prod", change("logs")), "b:prod": inSync("b:prod") };
    const first = harness(tableAdapter(table), { sha: OLD });
    await scan(first.context);
    const live = dashboardBody(first.github);
    first.github.editBody(
      1,
      live.replace(
        rows(live)["a:prod"]?.text ?? "",
        `- **a:prod** · deploying · ticked by alice · [run](${REPO_URL}/actions/runs/77) <!-- sluiceway:row stack="a:prod" state="deploying" -->\n  <!-- /sluiceway:row -->`,
      ),
    );
    first.github.seedComparison(OLD, SHA, { status: "ahead", files: [{ path: "b/index.ts" }] });
    first.github.seedDeployment({
      task: "sluiceway:a:prod",
      payload: payload("77"),
      createdAt: "2026-09-20T08:00:00Z",
      status: {
        state: "failure",
        description: "the tool exited with an error (exit code 255)",
        createdAt: "2026-09-20T08:52:10Z",
      },
    });

    const adapter = tableAdapter(table);
    const { log } = harness(adapter);
    await scan({ ...first.context, adapter, log, sha: SHA, event: "push" });

    expect(adapter.previewed).toEqual(["b:prod", "a:prod"]);
    expect(rows(dashboardBody(first.github))["a:prod"]?.state).toBe("pending");
    expect(log.lines).toContain(
      "a:prod is previewed now: its row says deploying and no deployment is open.",
    );
  });
});

describe("a stack whose last deploy failed", () => {
  const failed = {
    payload: payload("77", "alice"),
    createdAt: "2026-09-21T05:50:00Z",
    status: {
      state: "failure",
      description: "the tool exited with an error (exit code 255)",
      createdAt: "2026-09-21T05:52:10Z",
    },
  };
  const line = `  :x: last deploy failed: the tool exited with an error (exit code 255) · ticked by alice · 2026-09-21 05:52 UTC · [run](${REPO_URL}/actions/runs/77)`;

  test("carries the failure line on a pending, an in sync and a preview failure row", async () => {
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("logs")),
      "b:prod": inSync("b:prod"),
      "c:prod": failing(),
      "d:prod": inSync("d:prod"),
    });
    const { context, github } = harness(adapter);
    for (const stack of ["a:prod", "b:prod", "c:prod"]) {
      github.seedDeployment({ task: `sluiceway:${stack}`, ...failed });
    }

    await expect(scan(context)).resolves.toBeUndefined();

    const body = dashboardBody(github);
    for (const stack of ["a:prod", "b:prod", "c:prod"]) {
      expect(rows(body)[stack]?.text.split("\n")).toContain(line);
      expect(rows(body)[stack]?.text).toContain('failed="true"');
    }
    expect(rows(body)["d:prod"]?.text).not.toContain("last deploy failed");
    expect(body).toContain("3 failed deploys");
    // An in sync row with a failure line is listed open, above the fold.
    expect(section(body, "In sync")).toContain("1 more in sync");
  });

  test("loses the line once a newer deploy of it went out", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": inSync("a:prod") }));
    github.seedDeployment({ task: "sluiceway:a:prod", ...failed });
    github.seedDeployment({
      task: "sluiceway:a:prod",
      createdAt: "2026-09-21T05:55:00Z",
      status: { state: "success", createdAt: "2026-09-21T05:56:00Z" },
    });

    await scan(context);
    expect(dashboardBody(github)).not.toContain("last deploy failed");
  });
});

describe("recently deployed", () => {
  test("lists the newest ten deploys that went out, and a superseded one is still one", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": inSync("a:prod") }));
    for (let i = 1; i <= 11; i++) {
      const minute = String(i).padStart(2, "0");
      github.seedDeployment({
        task: `sluiceway:s${minute}:prod`,
        payload: payload(String(100 + i), "alice"),
        createdAt: `2026-09-21T05:${minute}:00Z`,
        status: {
          state: i === 11 ? "inactive" : "success",
          createdAt: `2026-09-21T05:${minute}:30Z`,
        },
      });
    }
    github.seedDeployment({
      task: "sluiceway:failed:prod",
      createdAt: "2026-09-21T05:30:00Z",
      status: { state: "failure", createdAt: "2026-09-21T05:31:00Z" },
    });
    github.seedDeployment({ task: "deploy", payload: {}, status: { state: "success" } });

    await scan(context);

    const list = section(dashboardBody(github), "Recently deployed").split("\n");
    expect(list).toHaveLength(10);
    expect(list[0]).toBe(
      `- s11:prod · ticked by alice · 2026-09-21 05:11 UTC · [run](${REPO_URL}/actions/runs/111)`,
    );
    expect(list.at(-1)).toContain("- s02:prod · ");
  });

  test("another writer's success with GitHub's default does not erase this stack's deploy", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": inSync("a:prod") }));
    github.seedDeployment({
      task: "sluiceway:a:prod",
      createdAt: "2026-09-21T05:10:00Z",
      status: { state: "success", createdAt: "2026-09-21T05:11:00Z" },
    });
    const outside = github.seedDeployment({ task: "deploy", payload: {} });
    github.addDeploymentStatus(outside.id, { state: "success" });

    await scan(context);
    await scan(context);

    expect(github.deployment(1).status?.state).toBe("inactive");
    const body = dashboardBody(github);
    expect(section(body, "Recently deployed")).toContain("- a:prod · ticked by alice · ");
    expect(body).not.toContain("last deploy failed");
  });
});

describe("an open deployment whose run is over", () => {
  test("becomes `error`, and the row shows why with a box to try again", async () => {
    const { context, github, log } = harness(
      tableAdapter({ "a:prod": pending("a:prod", change("logs")) }),
    );
    const open = github.seedDeployment({
      task: "sluiceway:a:prod",
      payload: payload("77", "carol"),
      status: { state: "in_progress" },
    });
    github.seedRun("77", { completed: true });

    await scan(context);

    expect(github.deployment(open.id).status).toMatchObject({
      state: "error",
      description: "the run ended without a result",
    });
    const row = rows(dashboardBody(github))["a:prod"];
    expect(row?.state).toBe("pending");
    expect(row?.text).toContain("- [ ] **a:prod** · 1 update");
    expect(row?.text).toContain(
      "  :x: last deploy failed: the run ended without a result · ticked by carol · ",
    );
    expect(log.lines).toContain(
      "Ended the open deployment of a:prod: run 77 is over and never reported a result.",
    );
    // One status, however often the body is built.
    expect(github.deploymentStatuses(open.id).map(({ state }) => state)).toEqual([
      "in_progress",
      "error",
    ]);
  });

  test("the row comes from this scan's preview at once: no writer comes after a record the scan ended", async () => {
    // GitHub's clock runs ahead of the runner's here, so the new status is
    // later than the preview. A deploy that `apply` ended would mean: keep the
    // live row, or preview again. This one has no `apply` behind it.
    let reads = 0;
    const adapter = tableAdapter({ "a:prod": pending("a:prod", change("logs")) });
    const { context, github } = harness(adapter, {
      now: () => new Date(Date.UTC(2025, 0, 1) + 500 * reads++),
    });
    github.seedDeployment({ task: "sluiceway:a:prod", status: { state: "in_progress" } });
    github.seedRun("4242", { completed: true });

    await scan(context);

    expect(adapter.previewed).toEqual(["a:prod"]);
    expect(rows(dashboardBody(github))["a:prod"]?.text).toContain(
      ":x: last deploy failed: the run ended without a result",
    );
  });

  test("a run that still waits keeps the stack deploying, with no time limit", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": inSync("a:prod") }));
    const open = github.seedDeployment({
      task: "sluiceway:a:prod",
      createdAt: "2026-01-01T00:00:00Z",
      status: { state: "queued", createdAt: "2026-01-01T00:00:01Z" },
    });
    github.seedRun("4242", { completed: false });

    await scan(context);
    expect(github.deployment(open.id).status?.state).toBe("queued");
    expect(rows(dashboardBody(github))["a:prod"]?.state).toBe("deploying");
  });
});

describe("a deploy that ended while the scan was previewing", () => {
  test("keeps the live row, because the scan's preview of the stack predates the deploy", async () => {
    const table = { "a:prod": pending("a:prod", change("logs")), "b:prod": inSync("b:prod") };
    const { context, github, log } = harness(tableAdapter(table));
    await scan(context);
    // `apply` deployed a:prod and swapped its row while this scan previewed.
    const live = dashboardBody(github);
    const applied = `- a:prod <!-- sluiceway:row stack="a:prod" state="in-sync" -->\n  <!-- /sluiceway:row -->`;
    github.editBody(1, live.replace(rows(live)["a:prod"]?.text ?? "", applied));
    github.seedDeployment({
      task: "sluiceway:a:prod",
      createdAt: "2026-09-21T05:59:00Z",
      // The harness clock starts at 06:00:00, so this is after the preview.
      status: { state: "success", createdAt: "2026-09-21T06:30:00Z" },
    });

    const adapter = tableAdapter(table);
    await scan({ ...context, adapter, log });

    expect(adapter.previewed).toEqual(["a:prod", "b:prod"]);
    expect(rows(dashboardBody(github))["a:prod"]?.text).toBe(applied);
    expect(log.lines).toContain(
      "Kept the live row of a:prod: a deploy of it ended after its preview started.",
    );
  });

  test("with no live row to keep, the stack is previewed once more and that row is taken", async () => {
    const adapter = tableAdapter({ "a:prod": pending("a:prod", change("logs")) });
    const { context, github, log } = harness(adapter);
    github.seedDeployment({
      task: "sluiceway:a:prod",
      createdAt: "2026-09-21T05:59:00Z",
      status: { state: "success", createdAt: "2026-09-21T06:30:00Z" },
    });

    await scan(context);

    expect(adapter.previewed).toEqual(["a:prod", "a:prod"]);
    expect(rows(dashboardBody(github))["a:prod"]?.state).toBe("pending");
    expect(log.lines).toContain(
      "a:prod is previewed again: a deploy of it ended after its preview started.",
    );
  });
});

describe("the reads are bounded", () => {
  test("a scan reads one page per environment name at each late read, and nothing per stack", async () => {
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("logs")),
      "b:prod": inSync("b:prod"),
      "c:prod": inSync("c:prod"),
    });
    const { context, github } = harness(adapter, {
      config: "stacks:\n  - path: c\n    environment: production\n",
    });
    await scan(context);
    github.requests.length = 0;

    await scan(context);
    expect(github.requests).toEqual([
      "listIssues",
      "getIssue",
      "listNewestDeployments",
      "listNewestDeployments",
      // The scan line moved, so the body is written and read back.
      "updateIssueBody",
      "getIssue",
    ]);
  });

  test("the fall back is only for a pending stack that is not on a full page", async () => {
    const adapter = tableAdapter({
      "a:prod": pending("a:prod", change("logs")),
      "b:prod": inSync("b:prod"),
    });
    const { context, github } = harness(adapter);
    github.seedDeployment({
      task: "sluiceway:a:prod",
      createdAt: "2026-09-01T00:00:00Z",
      status: { state: "queued", createdAt: "2026-09-01T00:00:01Z" },
    });
    github.seedRun("4242", { completed: false });
    for (let i = 0; i < 100; i++) {
      github.seedDeployment({ task: "deploy", payload: {}, createdAt: "2026-09-02T00:00:00Z" });
    }

    await scan(context);

    expect(rows(dashboardBody(github))["a:prod"]?.state).toBe("deploying");
    const asked = github.requests.filter((request) => /Deployment/.test(request));
    // The dashboard is new, so its body is built twice: for the create and
    // for the read back. In sync stacks need no lookup.
    expect(asked).toEqual([
      "listNewestDeployments",
      "newestDeploymentOfTask",
      "latestDeploymentStatus",
      "listNewestDeployments",
      "newestDeploymentOfTask",
      "latestDeploymentStatus",
    ]);
  });
});

describe("what the scan does not read", () => {
  test("a record with a payload of another version is left alone, and the log says so", async () => {
    const { context, github, log } = harness(
      tableAdapter({ "a:prod": pending("a:prod", change("logs")) }),
    );
    github.seedDeployment({
      task: "sluiceway:a:prod",
      payload: { v: 2, hash: "h", ticker: "alice", run: "77" },
      status: { state: "queued" },
    });

    await scan(context);

    expect(rows(dashboardBody(github))["a:prod"]?.state).toBe("pending");
    expect(github.requests).not.toContain("getWorkflowRun");
    expect(log.lines).toContain(
      "1 deployment record carries a payload this version of Sluiceway cannot read. It was left alone.",
    );
  });

  test("deployment records that cannot be read fail the scan, with the permissions it needs", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": inSync("a:prod") }));
    await scan(context);
    const before = dashboardBody(github);
    github.listNewestDeployments = async () => {
      throw new Error("Resource not accessible by integration");
    };

    await expect(scan({ ...context, sha: OLD })).rejects.toThrow(
      "The deployment records could not be read: Resource not accessible by integration. The scan job needs the permissions `deployments: write` and `actions: read`",
    );
    expect(dashboardBody(github)).toBe(before);
  });
});
