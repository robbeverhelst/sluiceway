import { describe, expect, test } from "bun:test";
import type { MatrixEntry } from "../../src/core/resolve.ts";
import type { OutputName } from "../../src/github/outputs.ts";
import { apply } from "../../src/modes/apply.ts";
import { type AutoContext, type AutoStep, auto } from "../../src/modes/auto.ts";
import { resolve } from "../../src/modes/resolve.ts";
import { scan } from "../../src/modes/scan.ts";
import { settle } from "../../src/modes/settle.ts";
import { parseDashboard, parseDashboard as parseRows } from "../../src/render/marker.ts";
import {
  ACTION_REF,
  change,
  failing,
  harness,
  pending,
  rememberingLog,
  SHA,
  steppingClock,
} from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";
import {
  ALICE,
  RESOLVE_RUN,
  type ResolveHarness,
  scanned,
  tick,
  WORKFLOW,
} from "./resolve-harness.ts";

// Auto mode (slice 5.12, record 0077): one step with no mode runs what the
// event asks for. An edit of the dashboard resolves, deploys every stack it
// handed on and settles, in that one step, which the workflow used to spread
// over three jobs joined by if: and needs:.

const TABLE = {
  "a:prod": pending("a:prod", change("logs")),
  "b:prod": pending("b:prod", change("db")),
};

interface Wired {
  context: AutoContext;
  notices: string[];
  outputs: ReturnType<typeof rememberingOutputs>;
  log: ReturnType<typeof rememberingLog>;
  // What auto started, in order.
  ran: string[];
  // Set when auto says a deploy was handed on, and when it settled.
  marks: string[];
}

// Auto on the fake, with the real modes behind it, in the run of the event.
function wired(h: ResolveHarness, eventName: string, event: unknown): Wired {
  const notices: string[] = [];
  const ran: string[] = [];
  const marks: string[] = [];
  const outputs = rememberingOutputs();
  const log = rememberingLog();
  const context: AutoContext = {
    root: h.context.root,
    eventName,
    event,
    log,
    notice: (line) => void notices.push(line),
    outputs,
    handedOn: () => void marks.push("handed on"),
    settled: () => void marks.push("settled"),
    run: {
      scan: async (step) => {
        ran.push("scan");
        const { context: scanContext } = harness(h.adapter);
        await scan({
          ...scanContext,
          root: h.context.root,
          github: h.github,
          runId: RESOLVE_RUN,
          event: eventName,
          log: step.log,
          outputs: step.outputs,
        });
      },
      resolve: async (step) => {
        ran.push("resolve");
        return await resolve({
          ...h.context,
          event,
          log: step.log,
          setOutput: (name, value) => step.outputs.set(name as OutputName, value),
        });
      },
      apply: async (deploymentId, step) => {
        ran.push(`apply ${deploymentId}`);
        await apply({
          root: h.context.root,
          env: { PATH: "/usr/bin" },
          mask: () => {},
          adapter: h.adapter,
          run: async () => {
            throw new Error("The table adapter starts no process.");
          },
          github: h.github,
          log: step.log,
          previewTimeoutMinutes: 10,
          now: steppingClock(),
          repoUrl: h.context.repoUrl,
          runId: RESOLVE_RUN,
          runAttempt: "1",
          sha: SHA,
          actionRef: ACTION_REF,
          deploymentId,
          event,
          outputs: step.outputs,
        });
      },
      settle: async (step) => {
        ran.push("settle");
        await settle({
          root: h.context.root,
          adapter: h.adapter,
          github: h.github,
          log: step.log,
          repoUrl: h.context.repoUrl,
          runId: RESOLVE_RUN,
          event,
          workflow: WORKFLOW,
          actionRef: ACTION_REF,
          outputs: step.outputs,
        });
      },
      check: async () => {
        ran.push("check");
      },
    },
  };
  return { context, notices, outputs, log, ran, marks };
}

function rows(h: ResolveHarness): Record<string, string> {
  return Object.fromEntries(
    parseDashboard(h.github.issue(h.number).body).rows.map((row) => [row.stackId, row.state]),
  );
}

describe("auto mode on an edit of the dashboard", () => {
  test("resolves, deploys every ticked stack and settles, in one step", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod", "b:prod"]);
    const w = wired(h, "issues", h.github.deliverEvent());
    await auto(w.context);

    expect(w.ran).toEqual(["resolve", "apply 1", "apply 2", "settle"]);
    expect(h.adapter.applied).toEqual(["a:prod", "b:prod"]);
    expect(h.github.deploymentStatuses(1).at(-1)?.state).toBe("success");
    expect(h.github.deploymentStatuses(2).at(-1)?.state).toBe("success");
    expect(rows(h)).toEqual({ "a:prod": "in-sync", "b:prod": "in-sync" });
    expect(w.notices).toEqual([]);
    expect(w.marks).toEqual(["handed on", "settled"]);
    // Every deploy the step started, for a step after it.
    const matrix = JSON.parse(w.outputs.values.matrix ?? "") as MatrixEntry[];
    expect(matrix.map(({ stack, deployment }) => [stack, deployment])).toEqual([
      ["a:prod", 1],
      ["b:prod", 2],
    ]);
  });

  test("a deploy that fails does not stop the next one, settle still runs, and the step ends red", async () => {
    const h = await scanned(TABLE, {
      deploys: {
        "a:prod": { ok: false, reason: { kind: "tool-error", exitCode: 1 }, toolLog: "" },
      },
    });
    tick(h, ALICE, ["a:prod", "b:prod"]);
    const w = wired(h, "issues", h.github.deliverEvent());

    await expect(auto(w.context)).rejects.toThrow("a:prod");
    expect(w.ran).toEqual(["resolve", "apply 1", "apply 2", "settle"]);
    expect(h.adapter.applied).toEqual(["a:prod", "b:prod"]);
    expect(h.github.deploymentStatuses(2).at(-1)?.state).toBe("success");
    expect(w.marks).toEqual(["handed on", "settled"]);
  });

  test("a tick nobody may make hands nothing on, so nothing deploys and nothing settles", async () => {
    const h = await scanned(TABLE);
    tick(h, { login: "mallory", type: "User" }, ["a:prod"]);
    h.github.seedPermission("mallory", { push: false, maintain: false, admin: false });
    const w = wired(h, "issues", h.github.deliverEvent());
    await auto(w.context);

    expect(w.ran).toEqual(["resolve"]);
    expect(h.adapter.applied).toEqual([]);
    expect(w.marks).toEqual([]);
    expect(w.outputs.values.matrix).toBe("[]");
  });

  // Every mode writes the summary of its own part; one step keeps them all.
  test("the step's summary holds the summary of every mode it ran", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod"]);
    const w = wired(h, "issues", h.github.deliverEvent());
    await auto(w.context);

    const last = w.log.summaries.at(-1) ?? "";
    expect(last).toContain("a:prod");
    // resolve's summary, then apply's, in the order they ran.
    expect(w.log.summaries.length).toBeGreaterThan(1);
    expect(last.startsWith(w.log.summaries[0] ?? "-")).toBe(true);
  });
});

describe("auto mode on an event that is not its own", () => {
  test("an edit of another issue ends with one notice, green, and asks GitHub nothing", async () => {
    const h = await scanned(TABLE);
    const other = h.github.seedIssue({
      title: "A bug",
      body: "It is broken.",
      labels: [],
      author: ALICE,
    }).number;
    h.github.editBody(other, "It is still broken.", ALICE);
    const w = wired(h, "issues", h.github.deliverEvent());
    h.github.requests.length = 0;
    await auto(w.context);

    expect(w.ran).toEqual([]);
    expect(w.notices).toEqual([`Issue #${other} is not the open dashboard. Nothing to do.`]);
    expect(h.github.requests).toEqual([]);
  });

  test("a push to a branch that is not the default ends with one notice", async () => {
    const h = await scanned(TABLE);
    const w = wired(h, "push", {
      ref: "refs/heads/feature",
      repository: { default_branch: "main" },
    });
    await auto(w.context);
    expect(w.ran).toEqual([]);
    expect(w.notices.length).toBe(1);
  });
});

describe("auto mode on its other events", () => {
  test("a push to the default branch scans and nothing else", async () => {
    const h = await scanned(TABLE);
    const w = wired(h, "push", { ref: "refs/heads/main", repository: { default_branch: "main" } });
    await auto(w.context);
    expect(w.ran).toEqual(["scan"]);
    expect(w.outputs.values.pending).toBe("2");
  });

  test("a dispatch resolves, then scans", async () => {
    const h = await scanned(TABLE);
    const w = wired(h, "workflow_dispatch", { ref: "refs/heads/main" });
    await auto(w.context);
    expect(w.ran).toEqual(["resolve", "scan"]);
  });

  test("a read-only dashboard's dispatch only scans", async () => {
    const h = await scanned(TABLE, { config: "dashboard:\n  readOnly: true\n" });
    const w = wired(h, "workflow_dispatch", { ref: "refs/heads/main" });
    await auto(w.context);
    expect(w.ran).toEqual(["scan"]);
  });

  test("a pull request runs the check", async () => {
    const h = await scanned(TABLE);
    const w = wired(h, "pull_request", { number: 3 });
    await auto(w.context);
    expect(w.ran).toEqual(["check"]);
  });

  test("a scan that fails still ends the step red, after it ran", async () => {
    const h = await scanned({ "a:prod": failing() });
    const w = wired(h, "schedule", {});
    const strict: AutoContext = {
      ...w.context,
      run: {
        ...w.context.run,
        scan: async (step: AutoStep) => {
          await w.context.run.scan(step);
          throw new Error("A preview failed, and strict is on.");
        },
      },
    };
    await expect(auto(strict)).rejects.toThrow("A preview failed");
  });
});

// Outside records (slice 5.44, record 0109): a writer other than Sluiceway
// opens a record naming the run of a dispatch it made. The one step resolves,
// which hands the record on, deploys it through the fresh preview and the
// hash check, settles, and skips its scan: the deploy wrote its own row.
describe("auto mode on a dispatch with a record another writer opened for the run", () => {
  function hashOf(h: ResolveHarness, stack: string): string {
    const row = parseRows(h.github.issue(h.number).body).rows.find(
      ({ stackId }) => stackId === stack,
    );
    if (!row?.known || !row.hash) throw new Error(`no hash on the row of ${stack}`);
    return row.hash;
  }

  const WRITERS = "recordWriters:\n  - deploy-bot[bot]\n";

  function outsideRecord(h: ResolveHarness, stack: string, hash = hashOf(h, stack)) {
    return h.github.seedDeployment({
      task: `sluiceway:${stack}`,
      environment: "sluiceway",
      sha: SHA,
      creator: "deploy-bot[bot]",
      payload: { v: 1, hash, ticker: "dave", run: RESOLVE_RUN },
      status: { state: "queued" },
    });
  }

  test("deploys the record, settles, and skips the scan with a line that says why", async () => {
    const h = await scanned(TABLE, { config: WRITERS });
    const record = outsideRecord(h, "a:prod");
    const w = wired(h, "workflow_dispatch", { ref: "refs/heads/main", inputs: {} });
    await auto(w.context);

    expect(w.ran).toEqual(["resolve", `apply ${record.id}`, "settle"]);
    expect(h.adapter.applied).toEqual(["a:prod"]);
    expect(h.github.deploymentStatuses(record.id).at(-1)?.state).toBe("success");
    expect(rows(h)).toEqual({ "a:prod": "in-sync", "b:prod": "pending" });
    expect(w.marks).toEqual(["handed on", "settled"]);
    expect(w.log.lines).toContain(
      "The scan of this run is skipped: resolve handed on 1 deployment record that another writer opened for this run, and the dispatch named no merged pull requests, so there is nothing to scan for. The deploy writes its own row, and the next push, schedule or dispatch scans (record 0109).",
    );
    const matrix = JSON.parse(w.outputs.values.matrix ?? "") as MatrixEntry[];
    expect(matrix).toEqual([{ stack: "a:prod", environment: "sluiceway", deployment: record.id }]);
  });

  test("a record with a hash the fresh preview does not give deploys nothing, and the step is red", async () => {
    const h = await scanned(TABLE, { config: WRITERS });
    const record = outsideRecord(h, "a:prod", "0000000000000000");
    const w = wired(h, "workflow_dispatch", { ref: "refs/heads/main" });

    await expect(auto(w.context)).rejects.toThrow("a:prod");
    expect(w.ran).toEqual(["resolve", `apply ${record.id}`, "settle"]);
    expect(h.adapter.applied).toEqual([]);
    expect(h.github.deploymentStatuses(record.id).at(-1)).toMatchObject({
      state: "error",
      description: "the change moved since the tick",
    });
    expect(w.outputs.values.outcome).toBe("refused");
  });

  test("a dispatch that names the merged pull requests scans as before", async () => {
    const h = await scanned(TABLE, { config: WRITERS });
    const record = outsideRecord(h, "a:prod");
    const w = wired(h, "workflow_dispatch", {
      ref: "refs/heads/main",
      inputs: { "sluiceway-merged": "" },
    });
    await auto(w.context);

    expect(w.ran).toEqual(["resolve", `apply ${record.id}`, "scan", "settle"]);
  });

  test("the schedule deploys the record and scans as before", async () => {
    const h = await scanned(TABLE, { config: WRITERS });
    const record = outsideRecord(h, "a:prod");
    const w = wired(h, "schedule", { schedule: "0 9 * * 1-5" });
    await auto(w.context);

    expect(w.ran).toEqual(["resolve", `apply ${record.id}`, "scan", "settle"]);
  });

  test("a dispatch that also starts a queued stack scans, as the next layer always did", async () => {
    const h = await scanned(
      { ...TABLE, "c:prod": pending("c:prod", change("cache")) },
      { config: `${WRITERS}stacks:\n  - path: b\n    dependsOn: [a:prod]\n` },
    );
    tick(h, ALICE, ["a:prod", "b:prod"]);
    await resolve({ ...h.context, event: h.github.deliverEvent() });
    const first = h.github
      .deploymentsOf("sluiceway")
      .find(({ task }) => task === "sluiceway:a:prod");
    h.github.addDeploymentStatus(first?.id ?? 0, { state: "success", autoInactive: false });
    const record = outsideRecord(h, "c:prod");
    const w = wired(h, "workflow_dispatch", { ref: "refs/heads/main" });
    await auto(w.context);

    expect(w.ran.filter((one) => !one.startsWith("apply"))).toEqual(["resolve", "scan", "settle"]);
    expect(h.adapter.applied.sort()).toEqual(["b:prod", "c:prod"]);
    expect(h.github.deploymentStatuses(record.id).at(-1)?.state).toBe("success");
  });
});
