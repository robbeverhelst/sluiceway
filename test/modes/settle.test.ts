import { describe, expect, test } from "bun:test";
import type { NewDeploymentStatus } from "../../src/github/port.ts";
import { type ScanContext, scan } from "../../src/modes/scan.ts";
import { type SettleContext, settle } from "../../src/modes/settle.ts";
import { ACTION_REF, change, harness, pending, SHA } from "./harness.ts";
import {
  ALICE,
  matrix,
  RESOLVE_RUN,
  RESOLVE_RUN_URL,
  type ResolveHarness,
  rowsOf,
  scanned,
  tick,
  WORKFLOW,
  wake,
} from "./resolve-harness.ts";

// `settle` (records 0003 and 0035): the job after `apply` that gives every
// open deployment record of its own run the result `error`, and leaves every
// other record alone.

const TABLE = {
  "a:prod": pending("a:prod", change("logs")),
  "b:prod": pending("b:prod", change("db")),
};

// The `settle` job of the run that `resolve` ran in: same run id, same event.
function settleContext(h: ResolveHarness): SettleContext {
  return {
    root: h.context.root,
    adapter: h.adapter,
    github: h.github,
    log: h.log,
    repoUrl: h.context.repoUrl,
    runId: h.context.runId,
    event: h.context.event,
    workflow: WORKFLOW,
    actionRef: ACTION_REF,
  };
}

// A tick that `resolve` turned into a deployment record, and an `apply` job
// that never reported: cancelled, or rejected by a reviewer.
async function started(stackIds: string[], config?: string): Promise<ResolveHarness> {
  const h = await scanned(TABLE, config === undefined ? {} : { config });
  tick(h, ALICE, stackIds);
  await wake(h);
  h.github.requests.length = 0;
  h.log.lines.length = 0;
  return h;
}

// Every status `settle` writes, as it was handed to the port. The fake keeps no
// `log_url`, so the call itself is looked at.
function statusesWritten(h: ResolveHarness): { id: number; status: NewDeploymentStatus }[] {
  const written: { id: number; status: NewDeploymentStatus }[] = [];
  const original = h.github.createDeploymentStatus.bind(h.github);
  h.github.createDeploymentStatus = (id, status) => {
    written.push({ id, status });
    return original(id, status);
  };
  return written;
}

// The scan that `settle` started, on the same fake, later.
function scanContext(h: ResolveHarness): ScanContext {
  const { context } = harness(h.adapter);
  return { ...context, root: h.context.root, github: h.github, log: h.log, runId: "8080" };
}

function deploymentOf(h: ResolveHarness, stack: string): number {
  const entries = matrix(h) as { stack: string; deployment: number }[];
  const entry = entries.find((one) => one.stack === stack);
  if (!entry) throw new Error(`resolve started no deploy of ${stack}`);
  return entry.deployment;
}

describe("settle", () => {
  test("gives the open record of its own run the result `error`, with the reason and the run", async () => {
    const h = await started(["a:prod"]);
    const written = statusesWritten(h);

    await settle(settleContext(h));

    const id = deploymentOf(h, "a:prod");
    expect(h.github.deployment(id).status).toMatchObject({
      state: "error",
      description: "the run ended without a result",
    });
    // The run of the deploy, which is this same run.
    expect(written).toEqual([
      {
        id,
        status: {
          state: "error",
          description: "the run ended without a result",
          logUrl: RESOLVE_RUN_URL,
        },
      },
    ]);
    expect(h.log.lines).toContain(
      `🔴 Ended the open deployment of a:prod (record ${id}): this run ended without a result for it.`,
    );
  });

  test("ends every open record of its run, in every environment its stacks use", async () => {
    const h = await started(
      ["a:prod", "b:prod"],
      "stacks:\n  - path: b\n    environment: production\n",
    );
    const a = deploymentOf(h, "a:prod");
    const b = deploymentOf(h, "b:prod");
    // `apply` took the one and never finished, the other waited on a reviewer.
    h.github.addDeploymentStatus(a, { state: "in_progress", autoInactive: false });

    await settle(settleContext(h));

    expect(h.github.deployment(a).status?.state).toBe("error");
    expect(h.github.deployment(b).status?.state).toBe("error");
    expect(h.github.deployment(b).environment).toBe("production");
  });

  test("leaves every record that is not an open record of its run alone", async () => {
    const h = await started(["a:prod"]);
    const mine = deploymentOf(h, "a:prod");
    // `apply` of this run reported a result of its own.
    h.github.addDeploymentStatus(mine, { state: "failure", autoInactive: false });
    // An open record of another run, whose run is over. The next render ends
    // that one, not `settle` (record 0003).
    h.github.seedRun("7000", { completed: true });
    const theirs = h.github.seedDeployment({
      task: "sluiceway:b:prod",
      payload: { v: 1, hash: "2b44350653e84a11", ticker: "bob", run: "7000" },
      status: { state: "queued" },
    }).id;
    // Not Sluiceway's, though its payload names this run.
    const foreign = h.github.seedDeployment({
      task: "deploy",
      payload: { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: RESOLVE_RUN },
      status: { state: "queued" },
    }).id;
    const before = [mine, theirs, foreign].map((id) => h.github.deploymentStatuses(id).length);

    await settle(settleContext(h));

    expect([mine, theirs, foreign].map((id) => h.github.deploymentStatuses(id).length)).toEqual(
      before,
    );
    expect(h.github.requests).not.toContain("createDeploymentStatus");
    expect(h.github.requests).not.toContain("getWorkflowRun");
  });

  test("starts a full scan once it ended a record, after it wrote their rows", async () => {
    const h = await started(["a:prod", "b:prod"]);

    await settle(settleContext(h));

    // One dispatch, after both records were ended and the body was written.
    expect(h.github.dispatches).toEqual([{ workflow: WORKFLOW.file, ref: WORKFLOW.ref }]);
    const asked = h.github.requests.filter((name) => name !== "listNewestDeployments");
    expect(asked.slice(0, 2)).toEqual(["createDeploymentStatus", "createDeploymentStatus"]);
    expect(asked.indexOf("updateIssueBody")).toBeGreaterThan(1);
    expect(asked.at(-1)).toBe("dispatchWorkflow");
    expect(h.log.lines.at(-1)).toBe(
      "Started a full scan, which previews these stacks again and writes their rows with the fresh diff.",
    );
  });

  // Record 0113, for issue 272: the line does not wait for the scan.
  test("writes the failure line on the row of the deploy it ended, before the scan", async () => {
    const h = await started(["a:prod"]);
    const before = rowsOf(h);
    const [, ...carried] = (before["a:prod"] ?? "").split("\n");

    await settle(settleContext(h));

    const row = rowsOf(h)["a:prod"] ?? "";
    const [first, failure, ...rest] = row.split("\n");
    expect(first).toBe(
      '- **a:prod** · no preview since its deploy ended, the next scan previews it <!-- sluiceway:row stack="a:prod" state="preview-failed" failed="true" -->',
    );
    expect(failure).toStartWith(
      "  :x: last deploy failed: the run ended without a result · ticked by alice · ",
    );
    expect(failure).toEndWith(` · [run](${RESOLVE_RUN_URL})`);
    // Every other line of the block, as `resolve` wrote it.
    expect(rest).toEqual(carried);
    // Every other row, byte for byte.
    expect(rowsOf(h)["b:prod"]).toBe(before["b:prod"]);
    const body = h.github.issue(h.number).body;
    expect(body).not.toContain('state="deploying"');
    expect(body).toContain("0 deploying");
    expect(body).toContain("1 failed deploy");
    expect(h.log.lines).toContain(
      "Wrote the failure line on the row of a:prod, before the full scan previews it again (record 0113).",
    );
  });

  test("the row of a deploy that apply had started says the same", async () => {
    const h = await started(["a:prod"]);
    // `apply` took the record and wrote its deploying row, then was cancelled.
    h.github.addDeploymentStatus(deploymentOf(h, "a:prod"), {
      state: "in_progress",
      autoInactive: false,
    });

    await settle(settleContext(h));

    expect(rowsOf(h)["a:prod"]).toContain('state="preview-failed" failed="true"');
  });

  test("a row that does not say deploying is left to the scan", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod"]);
    // The body write of `resolve` failed, so the row is still ticked.
    const updateIssueBody = h.github.updateIssueBody.bind(h.github);
    h.github.updateIssueBody = async () => {
      throw new Error("Server Error");
    };
    await expect(wake(h)).rejects.toThrow("Server Error");
    h.github.updateIssueBody = updateIssueBody;
    const before = rowsOf(h)["a:prod"];

    await settle(settleContext(h));

    // Carried byte for byte, tick included. The trail already lists the
    // failed deploy, as it does after every swap.
    expect(rowsOf(h)["a:prod"]).toBe(before);
    expect(h.github.dispatches).toHaveLength(1);
  });

  test("a stack a newer record took over keeps its row", async () => {
    const h = await started(["a:prod"]);
    // A new tick opened a record of another run, right after this one ended.
    const createDeploymentStatus = h.github.createDeploymentStatus.bind(h.github);
    h.github.createDeploymentStatus = async (id, status) => {
      const written = await createDeploymentStatus(id, status);
      h.github.seedRun("7000", { completed: false });
      h.github.seedDeployment({
        task: "sluiceway:a:prod",
        payload: { v: 1, hash: "2b44350653e84a11", ticker: "bob", run: "7000" },
        status: { state: "queued" },
      });
      return written;
    };
    const before = rowsOf(h)["a:prod"];

    await settle(settleContext(h));

    expect(rowsOf(h)["a:prod"]).toBe(before);
    expect(h.github.dispatches).toHaveLength(1);
  });

  test("a body write GitHub refuses is a line of the job log, and the scan still follows", async () => {
    const h = await started(["a:prod"]);
    h.github.updateIssueBody = async () => {
      throw new Error("Resource not accessible by integration");
    };

    await settle(settleContext(h));

    expect(h.github.deployment(deploymentOf(h, "a:prod")).status?.state).toBe("error");
    expect(h.github.dispatches).toHaveLength(1);
    expect(h.log.lines).toContain(
      "The failure line could not be written on the row: Resource not accessible by integration. The full scan writes the row.",
    );
  });

  test("with no open dashboard it writes nothing and the scan still follows", async () => {
    const h = await started(["a:prod"]);
    await h.github.closeIssue(h.number);
    h.github.requests.length = 0;

    await settle(settleContext(h));

    expect(h.github.requests).not.toContain("updateIssueBody");
    expect(h.github.dispatches).toHaveLength(1);
    expect(h.log.lines).toContain(
      "There is no open dashboard to write. The full scan writes the row.",
    );
  });

  test("a narrowed scan previews the row even when the full scan never came", async () => {
    const h = await started(["a:prod"]);
    await settle(settleContext(h));
    // A push that only `b:prod` claims.
    const NEXT = "2222222222222222222222222222222222222222";
    h.github.seedComparison(SHA, NEXT, { status: "ahead", files: [{ path: "b/index.ts" }] });
    h.adapter.previewed.length = 0;

    await scan({ ...scanContext(h), sha: NEXT, event: "push" });

    expect([...h.adapter.previewed].sort()).toEqual(["a:prod", "b:prod"]);
    const row = rowsOf(h)["a:prod"] ?? "";
    expect(row).toContain('state="pending"');
    expect(row).toContain(
      ":x: last deploy failed: the run ended without a result · ticked by alice",
    );
  });

  test("the scan it starts shows the stack with its failure line, and nothing deploying", async () => {
    const h = await started(["a:prod"]);
    expect(rowsOf(h)["a:prod"]).toContain('state="deploying"');

    await settle(settleContext(h));
    await scan(scanContext(h));

    const row = rowsOf(h)["a:prod"] ?? "";
    expect(row).toContain('state="pending"');
    expect(row).toContain('failed="true"');
    expect(row).toContain(
      `:x: last deploy failed: the run ended without a result · ticked by alice · `,
    );
    expect(row).toContain(`[run](${RESOLVE_RUN_URL})`);
    expect(h.github.issue(h.number).body).not.toContain('state="deploying"');
  });

  test("a scan it may not start turns the job red after the records were ended", async () => {
    const h = await started(["a:prod"]);
    h.github.withoutActionsWrite();

    const result = settle(settleContext(h));

    await expect(result).rejects.toThrow(
      "A full scan could not be started: Resource not accessible by integration. The settle job needs the permission `actions: write`",
    );
    expect(h.github.deployment(deploymentOf(h, "a:prod")).status?.state).toBe("error");
  });

  test("a job that does not know its workflow ends the records and says why no scan started", async () => {
    const h = await started(["a:prod"]);

    const result = settle({ ...settleContext(h), workflow: undefined });

    await expect(result).rejects.toThrow("GITHUB_WORKFLOW_REF is not set");
    expect(h.github.deployment(deploymentOf(h, "a:prod")).status?.state).toBe("error");
  });

  test("finds its record through the deploying row when the environment holds more than a page", async () => {
    const h = await started(["a:prod"]);
    const mine = deploymentOf(h, "a:prod");
    // A reviewer took days, and a hundred deploys of other stacks went out in
    // the same environment meanwhile.
    for (let n = 0; n < 100; n++) {
      h.github.seedDeployment({ task: `sluiceway:other-${n}:prod`, status: { state: "success" } });
    }

    await settle(settleContext(h));

    expect(h.github.deployment(mine).status?.state).toBe("error");
    // The page, the live body for its deploying rows, then the REST fall back
    // for the one stack that is not on the page (record 0003).
    expect(h.github.requests.slice(0, 4)).toEqual([
      "listNewestDeployments",
      "getIssue",
      "newestDeploymentOfTask",
      "latestDeploymentStatus",
    ]);
  });

  test("the fall back also looks at a ticked row, for a `resolve` whose body write failed", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod"]);
    const updateIssueBody = h.github.updateIssueBody.bind(h.github);
    h.github.updateIssueBody = async () => {
      throw new Error("Server Error");
    };
    await expect(wake(h)).rejects.toThrow("Server Error");
    h.github.updateIssueBody = updateIssueBody;
    expect(rowsOf(h)["a:prod"]).toStartWith("- [x] ");
    for (let n = 0; n < 100; n++) {
      h.github.seedDeployment({ task: `sluiceway:other-${n}:prod`, status: { state: "success" } });
    }

    await settle(settleContext(h));

    expect(h.github.deployment(deploymentOf(h, "a:prod")).status?.state).toBe("error");
  });

  test("a status it cannot write stops it, and the job goes red naming the permission", async () => {
    const h = await started(["a:prod", "b:prod"]);
    let tries = 0;
    h.github.createDeploymentStatus = async () => {
      tries++;
      throw new Error("Resource not accessible by integration");
    };

    const result = settle(settleContext(h));

    await expect(result).rejects.toThrow(
      "The deployment record of a:prod could not be given its result: Resource not accessible by integration. The settle job needs the permission `deployments: write` (record 0003).",
    );
    // A missing permission costs one request, not one per record.
    expect(tries).toBe(1);
    expect(h.github.dispatches).toEqual([]);
  });

  test("records it cannot read turn the job red naming the permissions", async () => {
    const h = await started(["a:prod"]);
    h.github.listNewestDeployments = async () => {
      throw new Error("Resource not accessible by integration");
    };

    await expect(settle(settleContext(h))).rejects.toThrow(
      "The deployment records could not be read: Resource not accessible by integration. The settle job needs the permission `deployments: write` (record 0003).",
    );
  });

  test("a run with nothing open does nothing: no status, no scan, no body write", async () => {
    const h = await started(["a:prod"]);
    h.github.addDeploymentStatus(deploymentOf(h, "a:prod"), {
      state: "success",
      autoInactive: false,
    });
    const body = h.github.issue(h.number).body;

    await settle(settleContext(h));

    expect(h.github.requests).toEqual(["listNewestDeployments"]);
    expect(h.github.dispatches).toEqual([]);
    expect(h.github.issue(h.number).body).toBe(body);
    expect(h.log.lines).toEqual([
      "⚪ No deployment record of this run is open. Every deploy it started reported a result.",
    ]);
  });
});
