import { describe, expect, test } from "bun:test";
import { type SettleContext, settle } from "../../src/modes/settle.ts";
import { ACTION_REF, change, pending, REPO_URL } from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";
import { ALICE, type ResolveHarness, scanned, tick, WORKFLOW, wake } from "./resolve-harness.ts";

// `settle` has one output, `dashboard-url` (build plan, section 3). It comes
// from the edit of the dashboard that started the run, so it costs no request.

const TABLE = { "a:prod": pending("a:prod", change("logs")) };

function settleContext(h: ResolveHarness, outputs: SettleContext["outputs"]): SettleContext {
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
    outputs,
  };
}

async function started(): Promise<ResolveHarness> {
  const h = await scanned(TABLE);
  tick(h, ALICE, ["a:prod"]);
  await wake(h);
  h.github.requests.length = 0;
  return h;
}

describe("the outputs of settle", () => {
  test("the dashboard of the run, when a record was ended", async () => {
    const h = await started();
    const outputs = rememberingOutputs();

    await settle(settleContext(h, outputs));

    expect(outputs.values).toEqual({ "dashboard-url": `${REPO_URL}/issues/${h.number}` });
  });

  test("the dashboard of the run, with nothing open and no request of its own", async () => {
    const h = await started();
    const outputs = rememberingOutputs();

    // The records of the run are not this job's: nothing is open for it.
    await settle({ ...settleContext(h, outputs), runId: "another run" });

    expect(outputs.values).toEqual({ "dashboard-url": `${REPO_URL}/issues/${h.number}` });
    expect(h.github.requests).toEqual(["listNewestDeployments"]);
  });

  test("no dashboard for a run that an edit of another issue started", async () => {
    const h = await started();
    const outputs = rememberingOutputs();

    await settle({
      ...settleContext(h, outputs),
      event: { issue: { number: 9, user: { login: "someone", type: "User" }, body: "" } },
    });

    expect(outputs.values).toEqual({});
  });
});
