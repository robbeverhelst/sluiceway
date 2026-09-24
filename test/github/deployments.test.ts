import { describe, expect, test } from "bun:test";
import {
  deployFacts,
  HANDED_ON_DESCRIPTION,
  type RecordEnd,
  taskStackId,
} from "../../src/core/deployment.ts";
import type { NewDeploymentStatus } from "../../src/github/deployment-calls.ts";
import {
  type Claim,
  claimRecord,
  endRecord,
  openRecord,
  RecordNotEnded,
  type RecordWriter,
  readDeploymentRecords,
  settleEndedRuns,
  settleRun,
  startQueuedRecord,
} from "../../src/github/deployments.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";

// The bounded reads of record 0003 and the rule that ties an open deployment
// to its workflow run, against the fake GitHub.

const REPO_URL = "https://github.com/acme/infra";

function payload(run: string, ticker = "alice") {
  return { v: 1, hash: "2b44350653e84a11", ticker, run };
}

describe("reading the deployment records", () => {
  test("one request for one environment, whatever the number of stacks", async () => {
    const github = new FakeGitHub();
    github.seedDeployment({ task: "sluiceway:a", status: { state: "success" } });
    github.seedDeployment({ task: "sluiceway:b", status: { state: "queued" } });

    const records = await readDeploymentRecords(
      github,
      ["sluiceway"],
      [
        { stackId: "a", environment: "sluiceway" },
        { stackId: "c", environment: "sluiceway" },
      ],
    );

    expect(records.map(({ task, status }) => [task, status?.state])).toEqual([
      ["sluiceway:b", "queued"],
      ["sluiceway:a", "success"],
    ]);
    // The page is not full, so it holds every record there is: a stack that
    // is not on it has none, and no fall back is needed.
    expect(github.requests).toEqual(["listNewestDeployments"]);
  });

  test("one page per environment name, each name once", async () => {
    const github = new FakeGitHub();
    github.seedDeployment({ task: "sluiceway:a", environment: "production" });
    github.seedDeployment({ task: "sluiceway:b" });

    const records = await readDeploymentRecords(
      github,
      ["sluiceway", "production", "sluiceway"],
      [],
    );
    expect(records.map(({ task }) => task).sort()).toEqual(["sluiceway:a", "sluiceway:b"]);
    expect(github.requests).toEqual(["listNewestDeployments", "listNewestDeployments"]);
  });

  test("a full page and a stack that is not on it: the REST fall back, two requests", async () => {
    const github = new FakeGitHub();
    github.seedDeployment({ task: "sluiceway:old", status: { state: "failure" } });
    for (let i = 0; i < 100; i++) github.seedDeployment({ task: "sluiceway:busy" });

    const records = await readDeploymentRecords(
      github,
      ["sluiceway"],
      [
        { stackId: "old", environment: "sluiceway" },
        // On the page: no fall back.
        { stackId: "busy", environment: "sluiceway" },
      ],
    );

    expect(records).toHaveLength(101);
    expect(records.find(({ task }) => task === "sluiceway:old")?.status?.state).toBe("failure");
    expect(github.requests).toEqual([
      "listNewestDeployments",
      "newestDeploymentOfTask",
      "latestDeploymentStatus",
    ]);
  });

  test("a stack with no record at all costs one request of the fall back", async () => {
    const github = new FakeGitHub();
    for (let i = 0; i < 101; i++) github.seedDeployment({ task: "sluiceway:busy" });

    await readDeploymentRecords(
      github,
      ["sluiceway"],
      [{ stackId: "new", environment: "sluiceway" }],
    );
    expect(github.requests).toEqual(["listNewestDeployments", "newestDeploymentOfTask"]);
  });

  test("the fall back belongs to the page of the stack's own environment", async () => {
    const github = new FakeGitHub();
    for (let i = 0; i < 101; i++) github.seedDeployment({ task: "sluiceway:busy" });

    await readDeploymentRecords(
      github,
      ["sluiceway", "production"],
      [{ stackId: "calm", environment: "production" }],
    );
    expect(github.requests).toEqual(["listNewestDeployments", "listNewestDeployments"]);
  });
});

describe("an open deployment whose run is over", () => {
  test("becomes `error` with the fixed reason and the link to its run", async () => {
    const github = new FakeGitHub();
    const open = github.seedDeployment({
      task: "sluiceway:a",
      payload: payload("4242"),
      status: { state: "in_progress" },
    });
    github.seedRun("4242", { completed: true });

    const settled = await settleEndedRuns(github, [github.deployment(open.id)], REPO_URL);

    expect(settled.ended.map(({ stackId }) => stackId)).toEqual(["a"]);
    expect(settled.records[0]?.status).toMatchObject({
      state: "error",
      description: "the run ended without a result",
    });
    expect(github.deployment(open.id).status).toEqual(settled.records[0]?.status);
    expect(github.requests).toEqual(["getWorkflowRun", "createDeploymentStatus"]);
  });

  // Slice 4.2 (record 0054): a merge record outlives the run that opened it.
  // The scan after the merge ends it.
  test("a record that waits for the scan after a merge is never ended for its run", async () => {
    const github = new FakeGitHub();
    const open = github.seedDeployment({
      task: "sluiceway:a",
      payload: { v: 1, ticker: "alice", run: "4242", merge: 418 },
      status: { state: "queued" },
    });
    github.seedRun("4242", { completed: true });

    const settled = await settleEndedRuns(github, [github.deployment(open.id)], REPO_URL);
    expect(settled.ended).toEqual([]);
    expect(github.requests).toEqual([]);
  });

  // Deploy windows (record 0104): a record that waits for the window outlives
  // its run, as one behind a stack does. A run inside the window starts it.
  test("a record that waits for the deploy window is never ended for its run", async () => {
    const github = new FakeGitHub();
    const open = github.seedDeployment({
      task: "sluiceway:a",
      payload: { ...payload("4242"), window: true },
      status: { state: "queued" },
    });
    github.seedRun("4242", { completed: true });

    const settled = await settleEndedRuns(github, [github.deployment(open.id)], REPO_URL);
    expect(settled.ended).toEqual([]);
    expect(github.requests).toEqual([]);
  });

  test("a run that is still going leaves the record open, however long it waits", async () => {
    const github = new FakeGitHub();
    const open = github.seedDeployment({
      task: "sluiceway:a",
      createdAt: "2020-01-01T00:00:00Z",
      status: { state: "queued", createdAt: "2020-01-01T00:00:01Z" },
    });
    github.seedRun("4242", { completed: false });

    const settled = await settleEndedRuns(github, [github.deployment(open.id)], REPO_URL);
    expect(settled.ended).toEqual([]);
    expect(github.deployment(open.id).status?.state).toBe("queued");
    expect(github.requests).toEqual(["getWorkflowRun"]);
  });

  test("a run GitHub no longer has is over", async () => {
    const github = new FakeGitHub();
    const open = github.seedDeployment({ task: "sluiceway:a", payload: payload("77") });

    const settled = await settleEndedRuns(github, [github.deployment(open.id)], REPO_URL);
    expect(settled.ended.map(({ stackId }) => stackId)).toEqual(["a"]);
    expect(github.deployment(open.id).status?.state).toBe("error");
  });

  test("only the newest record of a stack is looked at, and only when it is open", async () => {
    const github = new FakeGitHub();
    github.seedDeployment({
      task: "sluiceway:a",
      createdAt: "2026-09-21T08:00:00Z",
      payload: payload("1"),
      status: { state: "queued" },
    });
    github.seedDeployment({
      task: "sluiceway:a",
      createdAt: "2026-09-21T09:00:00Z",
      status: { state: "success" },
    });
    github.seedDeployment({ task: "deploy", payload: {} });
    github.seedDeployment({ task: "sluiceway:b", payload: { v: 2 } });

    const records = [1, 2, 3, 4].map((id) => github.deployment(id));
    const settled = await settleEndedRuns(github, records, REPO_URL);
    expect(settled.ended).toEqual([]);
    expect(settled.records).toEqual(records);
    expect(github.requests).toEqual([]);
  });
});

// The rest of a record's life, at the module's interface: every status is
// written in the words core/deployment.ts reads back, so each test reads the
// record back with `deployFacts` rather than looking at a state word.

const RUN = "5151";

// Every status written, as it was handed to the port. The fake keeps no
// `log_url`, so the call itself is looked at.
function writing(github: FakeGitHub): { id: number; status: NewDeploymentStatus }[] {
  const written: { id: number; status: NewDeploymentStatus }[] = [];
  const original = github.createDeploymentStatus.bind(github);
  github.createDeploymentStatus = (id, status) => {
    written.push({ id, status });
    return original(id, status);
  };
  return written;
}

function writer(github: FakeGitHub): RecordWriter {
  return { github, repoUrl: REPO_URL, runId: RUN, runAttempt: "2" };
}

function factOf(github: FakeGitHub, id: number) {
  const record = github.deployment(id);
  return deployFacts([record]).byStack.get(taskStackId(record.task) ?? "");
}

describe("opening a record", () => {
  test("a tick: the payload of this run, then `queued` with the link to this attempt", async () => {
    const github = new FakeGitHub();
    const written = writing(github);

    const opened = await openRecord(writer(github), {
      stackId: "app:prod",
      environment: "production",
      sha: "abc1234",
      ticker: "alice",
      hash: "2b44350653e84a11",
      behind: ["network:prod"],
      drift: true,
    });

    expect(opened).toEqual({ deployment: 1 });
    const record = github.deployment(1);
    expect(record).toMatchObject({
      task: "sluiceway:app:prod",
      environment: "production",
      sha: "abc1234",
      payload: {
        v: 1,
        hash: "2b44350653e84a11",
        ticker: "alice",
        run: RUN,
        attempt: "2",
        behind: ["network:prod"],
        drift: true,
      },
    });
    expect(written).toEqual([
      { id: 1, status: { state: "queued", logUrl: `${REPO_URL}/actions/runs/${RUN}/attempts/2` } },
    ]);
    expect(factOf(github, 1)).toMatchObject({
      kind: "open",
      waiting: true,
      behind: ["network:prod"],
    });
  });

  test("a merge: no hash, and the pull request instead (record 0054)", async () => {
    const github = new FakeGitHub();
    await openRecord(
      { github, repoUrl: REPO_URL, runId: RUN },
      {
        stackId: "app:prod",
        environment: "sluiceway",
        sha: "abc1234",
        ticker: "alice",
        merge: 418,
      },
    );
    expect(github.deployment(1).payload).toEqual({ v: 1, ticker: "alice", run: RUN, merge: 418 });
    expect(factOf(github, 1)).toMatchObject({ kind: "open", merge: 418 });
  });

  test("a record whose `queued` status failed is still opened, and says why", async () => {
    const github = new FakeGitHub();
    const refused = new Error("Resource not accessible by integration");
    github.createDeploymentStatus = async () => {
      throw refused;
    };
    const opened = await openRecord(writer(github), {
      stackId: "app:prod",
      environment: "sluiceway",
      sha: "abc1234",
      ticker: "alice",
      hash: "2b44350653e84a11",
    });
    // A record with no status is an open deployment (record 0035, slice 2.4).
    expect(opened).toEqual({ deployment: 1, unfinished: refused });
    expect(factOf(github, 1)?.kind).toBe("open");
  });
});

describe("starting a record that waited for the deploy window (record 0104)", () => {
  test("the new record of this run carries what the tick approved and waits for nothing", async () => {
    const github = new FakeGitHub();
    const waiting = github.seedDeployment({
      task: "sluiceway:app:prod",
      payload: {
        v: 1,
        hash: "1111111111111111",
        ticker: "bob",
        run: "4242",
        drift: true,
        fingerprint: "f65a69fe79dd93c3",
        window: true,
      },
      status: { state: "queued" },
    });

    const started = await startQueuedRecord(writer(github), github.deployment(waiting.id), {
      sha: "def5678",
      environment: "sluiceway",
    });

    expect(started).toEqual({ deployment: 2, ticker: "bob" });
    expect(github.deployment(2).payload).toEqual({
      v: 1,
      hash: "1111111111111111",
      ticker: "bob",
      run: RUN,
      attempt: "2",
      drift: true,
      fingerprint: "f65a69fe79dd93c3",
    });
    expect(github.deployment(waiting.id).status).toMatchObject({
      state: "inactive",
      description: "started in a later run",
    });
  });
});

describe("starting a queued record in a later run (record 0056)", () => {
  test("a new record of this run with the old hash and ticker, and the old one handed on", async () => {
    const github = new FakeGitHub();
    const queued = github.seedDeployment({
      task: "sluiceway:app:prod",
      payload: {
        v: 1,
        hash: "1111111111111111",
        ticker: "bob",
        run: "4242",
        behind: ["network:prod"],
      },
      status: { state: "queued" },
    });

    const started = await startQueuedRecord(writer(github), github.deployment(queued.id), {
      sha: "def5678",
      environment: "sluiceway",
    });

    expect(started).toEqual({ deployment: 2, ticker: "bob" });
    expect(github.deployment(2)).toMatchObject({
      sha: "def5678",
      payload: { v: 1, hash: "1111111111111111", ticker: "bob", run: RUN, attempt: "2" },
    });
    // The handed-on record is no deploy fact: the new one is the stack's.
    const facts = deployFacts([github.deployment(1), github.deployment(2)]);
    expect(facts.byStack.get("app:prod")).toMatchObject({ kind: "open", deployment: 2 });
    expect(facts.trail).toEqual([]);
    expect(github.deployment(1).status?.description).toBe(HANDED_ON_DESCRIPTION);
  });

  test("a queued drift repair starts as a drift repair (record 0091)", async () => {
    const github = new FakeGitHub();
    const queued = github.seedDeployment({
      task: "sluiceway:app:prod",
      payload: {
        v: 1,
        hash: "1111111111111111",
        ticker: "bob",
        run: "4242",
        attempt: "3",
        behind: ["network:prod"],
        drift: true,
      },
      status: { state: "queued" },
    });

    await startQueuedRecord(writer(github), github.deployment(queued.id), {
      sha: "def5678",
      environment: "sluiceway",
    });

    // The attempt is this run's, not the queued record's.
    expect(github.deployment(2).payload).toEqual({
      v: 1,
      hash: "1111111111111111",
      ticker: "bob",
      run: RUN,
      attempt: "2",
      drift: true,
    });
  });

  test("a stack queued on merge starts on merge, with whoever merged (record 0095)", async () => {
    const github = new FakeGitHub();
    const queued = github.seedDeployment({
      task: "sluiceway:app:prod",
      payload: {
        v: 1,
        hash: "1111111111111111",
        ticker: "alice",
        run: "4242",
        behind: ["network:prod"],
        onMerge: true,
      },
      status: { state: "queued" },
    });

    await startQueuedRecord(writer(github), github.deployment(queued.id), {
      sha: "def5678",
      environment: "sluiceway",
    });

    expect(github.deployment(2).payload).toEqual({
      v: 1,
      hash: "1111111111111111",
      ticker: "alice",
      run: RUN,
      attempt: "2",
      onMerge: true,
    });
  });

  test("a record the scan of a merge opens says onMerge", async () => {
    const github = new FakeGitHub();
    await openRecord(writer(github), {
      stackId: "app:prod",
      environment: "sluiceway",
      sha: "abc1234",
      ticker: "alice",
      hash: "2b44350653e84a11",
      onMerge: true,
    });
    expect(github.deployment(1).payload).toMatchObject({ ticker: "alice", onMerge: true });
  });

  test("a queued record this version cannot read starts nothing and costs nothing", async () => {
    const github = new FakeGitHub();
    const queued = github.seedDeployment({ task: "sluiceway:app:prod", payload: { v: 2 } });
    expect(
      await startQueuedRecord(writer(github), github.deployment(queued.id), {
        sha: "def5678",
        environment: "sluiceway",
      }),
    ).toBeUndefined();
    expect(github.requests).toEqual([]);
  });
});

describe("claiming a record (records 0019, 0035 and 0056)", () => {
  function seed(github: FakeGitHub, payload: unknown, state?: string, task = "sluiceway:app:prod") {
    return github.seedDeployment({ task, payload, ...(state ? { status: { state } } : {}) }).id;
  }
  const mine = { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: RUN };

  test("an open record of this run becomes `in_progress`, and is the job's", async () => {
    const github = new FakeGitHub();
    const id = seed(github, mine, "queued");
    const written = writing(github);

    expect(await claimRecord(writer(github), id)).toEqual({
      kind: "claimed",
      stackId: "app:prod",
      payload: { hash: "2b44350653e84a11", ticker: "alice", run: RUN },
    });
    expect(written).toEqual([
      {
        id,
        status: { state: "in_progress", logUrl: `${REPO_URL}/actions/runs/${RUN}/attempts/2` },
      },
    ]);
    expect(factOf(github, id)).toMatchObject({ kind: "open", waiting: false });
  });

  test("a record that already ended costs one request and is left alone", async () => {
    const github = new FakeGitHub();
    const id = seed(github, mine, "failure");
    expect(await claimRecord(writer(github), id)).toEqual({ kind: "ended", state: "failure" });
    expect(github.requests).toEqual(["latestDeploymentStatus"]);
  });

  test.each([
    ["not Sluiceway's", "deploy", mine, { kind: "not-sluiceways" }],
    [
      "a payload this version cannot read",
      "sluiceway:app:prod",
      { v: 2 },
      { kind: "unreadable-payload", stackId: "app:prod" },
    ],
    [
      "of another run",
      "sluiceway:app:prod",
      { ...mine, run: "4242" },
      { kind: "other-run", stackId: "app:prod", run: "4242" },
    ],
    [
      "queued",
      "sluiceway:app:prod",
      { ...mine, behind: ["network:prod"] },
      { kind: "queued", stackId: "app:prod", behind: ["network:prod"], window: false },
    ],
  ])("a record that is %s is refused and gets no status", async (_, task, payload, claim) => {
    const github = new FakeGitHub();
    const id = seed(github, payload, "queued", task);
    expect(await claimRecord(writer(github), id)).toEqual(claim as Claim);
    expect(github.deploymentStatuses(id)).toHaveLength(1);
  });

  test("a read that fails is told, not thrown", async () => {
    const github = new FakeGitHub();
    const broken = new Error("Not Found");
    github.latestDeploymentStatus = async () => {
      throw broken;
    };
    expect(await claimRecord(writer(github), 7)).toEqual({ kind: "unread", error: broken });
  });
});

describe("ending a record", () => {
  test.each<[RecordEnd, Partial<ReturnType<typeof factOf>> | undefined]>([
    [{ kind: "deployed" }, { kind: "succeeded" }],
    [{ kind: "in-sync" }, { kind: "succeeded", inSync: true }],
    [
      { kind: "failed", reason: { kind: "moved" } },
      { kind: "failed", reason: "the change moved since the tick" },
    ],
    [
      { kind: "failed", reason: { kind: "deploys-off" } },
      { kind: "failed", reason: "deploys are turned off in sluiceway.yaml" },
    ],
    // No deploy fact: a rehearsal is only a line of the trail, and a record
    // that handed on says nothing about its stack.
    [{ kind: "rehearsed" }, undefined],
    [{ kind: "handed-on" }, undefined],
    [{ kind: "merged" }, undefined],
  ])("%o reads back as the fact it means", async (end, fact) => {
    const github = new FakeGitHub();
    const id = github.seedDeployment({
      task: "sluiceway:app:prod",
      payload: { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: RUN },
    }).id;
    await endRecord(writer(github), id, end);
    if (fact === undefined) expect(factOf(github, id)).toBeUndefined();
    else expect(factOf(github, id)).toMatchObject(fact);
  });

  test("a moved change and an ended run are `error`, every other reason `failure`", async () => {
    const github = new FakeGitHub();
    const written = writing(github);
    for (const kind of ["moved", "run-ended", "tool-missing", "dependency-failed"] as const) {
      const id = github.seedDeployment({ task: "sluiceway:a" }).id;
      await endRecord(writer(github), id, { kind: "failed", reason: { kind } });
    }
    expect(written.map(({ status }) => status.state)).toEqual([
      "error",
      "error",
      "failure",
      "failure",
    ]);
  });
});

describe("settling the open records of its own run (record 0035)", () => {
  function seed(github: FakeGitHub, task: string, payload: unknown, state = "queued") {
    return github.seedDeployment({ task, payload, status: { state } }).id;
  }
  const of = (run: string, extra: object = {}) => ({
    v: 1,
    hash: "2b44350653e84a11",
    ticker: "alice",
    run,
    ...extra,
  });

  test("ends every open record of the run as `error`, and asks nothing about the run", async () => {
    const github = new FakeGitHub();
    const a = seed(github, "sluiceway:a", of(RUN), "in_progress");
    seed(github, "sluiceway:b", of("4242"));
    const written = writing(github);

    const records = github.deploymentsOf("sluiceway");
    const settled = await settleRun(github, records, REPO_URL, RUN);

    expect(settled.open).toBe(1);
    expect(settled.ended).toEqual([{ deployment: a, stackId: "a", run: RUN, dead: false }]);
    expect(written).toEqual([
      {
        id: a,
        status: {
          state: "error",
          description: "the run ended without a result",
          logUrl: `${REPO_URL}/actions/runs/${RUN}`,
        },
      },
    ]);
    expect(github.requests).not.toContain("getWorkflowRun");
  });

  test("a queued chain of the run ends from its first stack on once one did not go out", async () => {
    const github = new FakeGitHub();
    github.seedDeployment({
      task: "sluiceway:network",
      payload: of("4242"),
      status: { state: "failure" },
    });
    const app = seed(github, "sluiceway:app", of(RUN, { behind: ["network"] }));
    const web = seed(github, "sluiceway:web", of(RUN, { behind: ["app"] }));

    const settled = await settleRun(github, github.deploymentsOf("sluiceway"), REPO_URL, RUN);

    expect(settled.ended).toEqual([
      { deployment: app, stackId: "app", run: RUN, dead: true },
      { deployment: web, stackId: "web", run: RUN, dead: true },
    ]);
    expect(factOf(github, web)).toMatchObject({
      kind: "failed",
      reason: "a stack it depends on did not deploy",
    });
  });

  test("a queued record whose dependencies still go out is left alone", async () => {
    const github = new FakeGitHub();
    seed(github, "sluiceway:network", of("4242"), "in_progress");
    seed(github, "sluiceway:app", of(RUN, { behind: ["network"] }));
    const settled = await settleRun(github, github.deploymentsOf("sluiceway"), REPO_URL, RUN);
    expect(settled).toMatchObject({ open: 1, ended: [] });
  });

  test("stops at the first status it cannot write, with what it ended before", async () => {
    const github = new FakeGitHub();
    const a = seed(github, "sluiceway:a", of(RUN));
    const b = seed(github, "sluiceway:b", of(RUN));
    const original = github.createDeploymentStatus.bind(github);
    github.createDeploymentStatus = async (id, status) => {
      if (id === b) throw new Error("Resource not accessible by integration");
      return original(id, status);
    };

    const failed = await settleRun(github, github.deploymentsOf("sluiceway"), REPO_URL, RUN).catch(
      (error: unknown) => error,
    );

    expect(failed).toBeInstanceOf(RecordNotEnded);
    const error = failed as RecordNotEnded;
    expect(error.message).toBe("Resource not accessible by integration");
    expect(error.stackId).toBe("b");
    expect(error.settled.ended.map(({ deployment }) => deployment)).toEqual([a]);
  });
});
