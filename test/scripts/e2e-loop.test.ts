import { describe, expect, test } from "bun:test";
import {
  checkApply,
  checkHandOff,
  checkMergeTick,
  checkNothingLeaks,
  checkQueued,
  checkRefusedTick,
  checkRehearsal,
  checkRerun,
  checkResolve,
  checkRowFacts,
  checkSettle,
  type LoopRecord,
  type LoopStep,
  mergeRows,
  tickMerge,
  tickRow,
} from "../../scripts/e2e/loop.ts";

// The checks of the loop are code too, and a check that cannot fail proves
// nothing. Each test here hands them something wrong and wants it named.

const PENDING =
  '- [ ] **network:dev** · 4 creates · [preview](https://github.com/acme/infra/actions/runs/2) <!-- sluiceway:row stack="network:dev" state="pending" hash="05bf4ba5424cef76" -->';
const IN_SYNC =
  '- **network:prod** · in sync · [preview](https://github.com/acme/infra/actions/runs/2) <!-- sluiceway:row stack="network:prod" state="in-sync" -->';

describe("a person ticks a box", () => {
  test("the box on the row of that stack is checked, and nothing else changes", () => {
    const body = ["# Dashboard", PENDING, "  <!-- /sluiceway:row -->", IN_SYNC].join("\n");
    expect(tickRow(body, "network:dev")).toBe(
      [
        "# Dashboard",
        PENDING.replace("- [ ] ", "- [x] "),
        "  <!-- /sluiceway:row -->",
        IN_SYNC,
      ].join("\n"),
    );
  });

  test("a stack without a row cannot be ticked", () => {
    expect(() => tickRow(PENDING, "site:prod")).toThrow("The dashboard has no row for site:prod.");
  });

  test("a row without a box cannot be ticked", () => {
    expect(() => tickRow(IN_SYNC, "network:prod")).toThrow(
      "The row of network:prod has no box to tick.",
    );
  });
});

function row(stack: string, state: string, more = "", box = true): string {
  const first =
    state === "pending"
      ? `- [${box ? " " : "x"}] **${stack}** · 5 creates <!-- sluiceway:row stack="${stack}" state="${state}" hash="8187831c2eaecc13"${more} -->`
      : `- **${stack}** · ${state} <!-- sluiceway:row stack="${stack}" state="${state}"${more} -->`;
  return `${first}\n  <!-- /sluiceway:row -->`;
}

function dashboard(...rows: string[]): string {
  return [
    '<!-- sluiceway:dashboard v="1" scan-sha="2222222222222222222222222222222222222222" -->',
    "## Pending",
    ...rows,
    "---",
    "- [ ] Rescan all stacks <!-- sluiceway:rescan -->",
  ].join("\n");
}

const PAYLOAD = { v: 1, hash: "8187831c2eaecc13", ticker: "alice", run: "4" };

function record(states: string[], over: Partial<LoopRecord> = {}): LoopRecord {
  return {
    id: 1,
    task: "sluiceway:network:dev",
    environment: "network",
    payload: PAYLOAD,
    states,
    description: "",
    ...over,
  };
}

function stepped(over: Partial<LoopStep> = {}): LoopStep {
  return {
    exitCode: 0,
    log: "",
    summary: "",
    outputs: {},
    body: dashboard(row("network:dev", "pending")),
    newComments: [],
    records: [],
    requests: [],
    newDispatches: 0,
    ...over,
  };
}

describe("the checks of a refused tick", () => {
  const refused = stepped({
    log: "network:dev was ticked by carol, who may not tick it (no-write-access). The box is cleared.",
    outputs: { matrix: "[]" },
    newComments: [
      "@carol ticked **network:dev**. The tick was refused: ticking needs write access to this repository. Nothing was started and the box is cleared.",
    ],
  });
  const expected = { stack: "network:dev", ticker: "carol" };

  test("a tick that was refused, cleared and told has no problems", () => {
    expect(checkRefusedTick(refused, expected)).toEqual([]);
  });

  test("a deploy that started anyway is a problem", () => {
    expect(
      checkRefusedTick(
        {
          ...refused,
          outputs: { matrix: '[{"stack":"network:dev","environment":"network","deployment":1}]' },
          records: [record(["queued"])],
        },
        expected,
      ),
    ).toEqual([
      'The matrix output is [{"stack":"network:dev","environment":"network","deployment":1}], expected [].',
      "A deployment record exists for network:dev.",
    ]);
  });

  test("a box left ticked, a red job and no comment are problems", () => {
    expect(
      checkRefusedTick(
        {
          ...refused,
          exitCode: 1,
          body: dashboard(row("network:dev", "pending", "", false)),
          newComments: [],
        },
        expected,
      ),
    ).toEqual([
      "The step ended with exit code 1, expected 0.",
      "The box of network:dev is still ticked.",
      "Expected one comment that names carol and network:dev, found 0.",
    ]);
  });

  test("a job log that does not name the refusal is a problem", () => {
    expect(checkRefusedTick({ ...refused, log: "" }, expected)).toEqual([
      'The job log has no line that starts with "network:dev was ticked by carol, who may not tick it".',
    ]);
  });
});

describe("the checks of resolve", () => {
  const resolved = stepped({
    outputs: { matrix: '[{"stack":"network:dev","environment":"network","deployment":1}]' },
    records: [record(["queued"])],
    body: dashboard(row("network:dev", "deploying")),
  });
  const expected = { stack: "network:dev", environment: "network", ticker: "alice", runId: "4" };

  test("one queued record handed on, and a deploying row, has no problems", () => {
    expect(checkResolve(resolved, expected)).toEqual([]);
  });

  test("a matrix that names another stack or nothing is a problem", () => {
    expect(checkResolve({ ...resolved, outputs: { matrix: "[]" } }, expected)).toEqual([
      "The matrix output is [], expected one entry for network:dev.",
    ]);
    expect(checkResolve({ ...resolved, outputs: {} }, expected)).toEqual([
      "The step set no matrix output.",
    ]);
  });

  test("a record with the wrong facts is a problem", () => {
    const wrong = record(["queued", "in_progress"], {
      environment: "sluiceway",
      payload: { ...PAYLOAD, ticker: "carol", run: "3" },
    });
    expect(checkResolve({ ...resolved, records: [wrong] }, expected)).toEqual([
      "Deployment record 1 is in the environment sluiceway, expected network.",
      "Deployment record 1 names the ticker carol, expected alice.",
      "Deployment record 1 belongs to run 3, expected 4.",
      "Deployment record 1 has the statuses queued, in_progress, expected queued.",
    ]);
  });

  test("a record that does not exist is a problem", () => {
    expect(checkResolve({ ...resolved, records: [] }, expected)).toEqual([
      "The matrix hands on deployment record 1, which does not exist.",
    ]);
  });

  test("a row that does not say deploying is a problem", () => {
    expect(
      checkResolve({ ...resolved, body: dashboard(row("network:dev", "pending")) }, expected),
    ).toEqual(["The row of network:dev is in state pending, expected deploying."]);
  });
});

// Record 0051.
describe("the check of a rehearsal", () => {
  const trail =
    "## Recently deployed\n\n- 🟣&nbsp;site:prod · ticked by alice · rehearsed, nothing was deployed · 2026-09-22 10:00 UTC · [run](x)";
  const rehearsed = stepped({
    summary: "## Sluiceway apply",
    outputs: { outcome: "rehearsed" },
    records: [
      record(["queued", "in_progress", "inactive"], {
        task: "sluiceway:site:prod",
        description: "rehearsed, nothing was deployed",
      }),
    ],
    body: `${dashboard(row("site:prod", "pending"))}\n\n${trail}`,
  });
  const expected = { stack: "site:prod", deployment: 1, ticker: "alice" };

  test("a rehearsal that deployed nothing has no problems", () => {
    expect(checkRehearsal(rehearsed, expected)).toEqual([]);
  });

  test("a rehearsal that deployed, or left no trail, is a problem", () => {
    expect(
      checkRehearsal(
        {
          ...rehearsed,
          outputs: { outcome: "deployed" },
          records: [record(["queued", "in_progress", "success"], { task: "sluiceway:site:prod" })],
          body: dashboard(row("site:prod", "in-sync")),
        },
        expected,
      ),
    ).toEqual([
      "Deployment record 1 has the statuses queued, in_progress, success, expected queued, in_progress, inactive.",
      'Deployment record 1 has the description "", expected "rehearsed, nothing was deployed".',
      "The outcome output is deployed, expected rehearsed.",
      "The row of site:prod is in state in-sync, expected pending.",
      "Recently deployed does not say that site:prod was rehearsed.",
    ]);
  });
});

describe("the checks of apply", () => {
  const deployed = stepped({
    summary: "## Sluiceway apply",
    outputs: { outcome: "deployed" },
    records: [record(["queued", "in_progress", "success"])],
    body: dashboard(row("network:dev", "in-sync")),
  });
  const expected = { stack: "network:dev", deployment: 1, outcome: "deployed" as const };

  test("a deploy that went out has no problems", () => {
    expect(checkApply(deployed, expected)).toEqual([]);
  });

  test("a red job, a record that did not end as success and a row that is not in sync are problems", () => {
    expect(
      checkApply(
        {
          ...deployed,
          exitCode: 1,
          records: [record(["queued", "in_progress", "failure"])],
          body: dashboard(row("network:dev", "pending", ' failed="true"')),
        },
        expected,
      ),
    ).toEqual([
      "The step ended with exit code 1, expected 0.",
      "Deployment record 1 has the statuses queued, in_progress, failure, expected queued, in_progress, success.",
      "The row of network:dev is in state pending, expected in-sync.",
      "The row of network:dev has a failure line, expected none.",
    ]);
  });

  test("an empty summary is a problem", () => {
    expect(checkApply({ ...deployed, summary: "" }, expected)).toEqual(["The summary is empty."]);
  });

  const moved = stepped({
    exitCode: 1,
    log: "::error::site:prod was not deployed: the change moved since the tick. The fresh preview gives diff hash 1830f0765b6562de and the tick approved 33038f69fca3a7e4.",
    summary: "## Sluiceway apply",
    outputs: { outcome: "refused" },
    records: [
      record(["queued", "in_progress", "error"], {
        task: "sluiceway:site:prod",
        description: "the change moved since the tick",
      }),
    ],
    body: dashboard(row("site:prod", "in-sync", ' failed="true"')),
  });
  const expectedMoved = {
    stack: "site:prod",
    deployment: 1,
    outcome: "moved" as const,
    rowState: "in-sync",
  };

  test("a moved change that ended as error with a fresh row has no problems", () => {
    expect(checkApply(moved, expectedMoved)).toEqual([]);
  });

  test("a moved change that went out anyway, or a green job, is a problem", () => {
    expect(
      checkApply(
        {
          ...moved,
          exitCode: 0,
          records: [record(["queued", "in_progress", "success"], { task: "sluiceway:site:prod" })],
          body: dashboard(row("site:prod", "in-sync")),
        },
        expectedMoved,
      ),
    ).toEqual([
      "The step ended with exit code 0, expected a red job.",
      "Deployment record 1 has the statuses queued, in_progress, success, expected queued, in_progress, error.",
      'Deployment record 1 has the description "", expected "the change moved since the tick".',
      "The row of site:prod has no failure line.",
    ]);
  });

  // Record 0051: a stack deployed by hand before its apply job started.
  const inSync = stepped({
    summary: "## Sluiceway apply",
    outputs: { outcome: "in-sync" },
    records: [
      record(["queued", "in_progress", "success"], {
        task: "sluiceway:site:prod",
        description: "nothing to deploy, already in sync",
      }),
    ],
    body: dashboard(row("site:prod", "in-sync")),
  });
  const expectedInSync = { stack: "site:prod", deployment: 1, outcome: "in-sync" as const };

  test("nothing to deploy that ended as success with its words and a green job has no problems", () => {
    expect(checkApply(inSync, expectedInSync)).toEqual([]);
  });

  test("nothing to deploy read as moved, or as deployed, is a problem", () => {
    expect(checkApply({ ...moved, outputs: { outcome: "refused" } }, expectedInSync)).toEqual([
      "The step ended with exit code 1, expected 0.",
      "Deployment record 1 has the statuses queued, in_progress, error, expected queued, in_progress, success.",
      'Deployment record 1 has the description "the change moved since the tick", expected "nothing to deploy, already in sync".',
      "The outcome output is refused, expected in-sync.",
      "The row of site:prod has a failure line, expected none.",
    ]);
    expect(checkApply({ ...inSync, outputs: { outcome: "deployed" } }, expectedInSync)).toEqual([
      "The outcome output is deployed, expected in-sync.",
    ]);
  });
});

describe("the checks of a re-run", () => {
  const before = [record(["queued", "in_progress", "success"])];
  const rerun = stepped({
    exitCode: 1,
    log: "Deployment record 1 already ended as success. Nothing is deployed.",
    requests: ["latestDeploymentStatus"],
    records: before,
  });

  test("a re-run that read one record and did nothing has no problems", () => {
    expect(checkRerun(rerun, { deployment: 1, before })).toEqual([]);
  });

  test("a re-run that previewed, deployed or wrote anything is a problem", () => {
    expect(
      checkRerun(
        {
          ...rerun,
          exitCode: 0,
          log: "Deployment record 1: network:dev, ticked by alice. It is in progress.",
          requests: ["latestDeploymentStatus", "getDeployment", "createDeploymentStatus"],
          records: [record(["queued", "in_progress", "success", "in_progress"])],
        },
        { deployment: 1, before },
      ),
    ).toEqual([
      "The step ended with exit code 0, expected a red job.",
      "The re-run made the requests latestDeploymentStatus, getDeployment, createDeploymentStatus, expected only latestDeploymentStatus.",
      "Deployment record 1 changed: queued, in_progress, success, in_progress, expected queued, in_progress, success.",
      'The job log has no line that starts with "Deployment record 1 already ended as success".',
    ]);
  });
});

describe("the checks of settle", () => {
  const before = [record(["queued", "in_progress", "success"])];

  test("a settle with nothing open that did nothing has no problems", () => {
    expect(checkSettle(stepped({ records: before }), { ended: undefined, before })).toEqual([]);
  });

  test("a settle with nothing open that wrote a status or started a scan is a problem", () => {
    expect(
      checkSettle(
        stepped({
          records: [record(["queued", "in_progress", "success", "error"])],
          newDispatches: 1,
        }),
        { ended: undefined, before },
      ),
    ).toEqual([
      "Deployment record 1 changed: queued, in_progress, success, error, expected queued, in_progress, success.",
      "The step started 1 scan, expected 0.",
    ]);
  });

  const open = [record(["queued"], { task: "sluiceway:site:prod" })];
  const ended = stepped({
    records: [
      record(["queued", "error"], {
        task: "sluiceway:site:prod",
        description: "the run ended without a result",
      }),
    ],
    newDispatches: 1,
  });

  test("a settle that ended the open record and started a scan has no problems", () => {
    expect(checkSettle(ended, { ended: 1, before: open })).toEqual([]);
  });

  test("a settle that left the record open or started no scan is a problem", () => {
    expect(
      checkSettle(
        { ...ended, exitCode: 1, records: open, newDispatches: 0 },
        { ended: 1, before: open },
      ),
    ).toEqual([
      "The step ended with exit code 1, expected 0.",
      "Deployment record 1 has the statuses queued, expected queued, error.",
      'Deployment record 1 has the description "", expected "the run ended without a result".',
      "The step started 0 scans, expected 1.",
    ]);
  });
});

describe("the facts on the rows", () => {
  const body = [
    dashboard(row("site:prod", "pending", ' failed="true"'), row("network:dev", "in-sync")),
    "## Recently deployed",
    "- 🟢&nbsp;network:dev · ticked by alice · 2026-01-01 00:00 UTC · [run](https://github.com/acme/infra/actions/runs/4)",
  ].join("\n");

  test("failure lines where expected and a stack in recently deployed have no problems", () => {
    expect(
      checkRowFacts(body, { failed: ["site:prod"], recentlyDeployed: ["network:dev"] }),
    ).toEqual([]);
  });

  test("a failure line too many or too few, and a missing recent deploy, are problems", () => {
    expect(
      checkRowFacts(body.replace(/## Recently deployed[\s\S]*/, ""), {
        failed: ["network:dev"],
        recentlyDeployed: ["network:dev"],
      }),
    ).toEqual([
      "The row of site:prod has a failure line, expected none.",
      "The row of network:dev has no failure line.",
      "Recently deployed does not list network:dev.",
    ]);
  });

  // Slice 4.5: a line without the dot of its result is not what the renderer writes.
  test("a recent deploy without its dot is a problem", () => {
    expect(
      checkRowFacts(body.replace("🟢&nbsp;", ""), {
        failed: ["site:prod"],
        recentlyDeployed: ["network:dev"],
      }),
    ).toEqual(["Recently deployed does not list network:dev."]);
  });
});

describe("nothing leaks from a step", () => {
  const secrets = ["CANARY-VALUE", "CANARY-SECRET"];

  test("a step that shows no value has no problems", () => {
    expect(checkNothingLeaks(stepped({ log: "  CANARY-VALUE in a group" }), secrets)).toEqual([]);
  });

  test("a value in the body, the summary, a comment, an output or an annotation is a problem", () => {
    expect(
      checkNothingLeaks(
        stepped({
          body: "CANARY-VALUE",
          summary: "CANARY-SECRET",
          newComments: ["CANARY-VALUE"],
          outputs: { matrix: "CANARY-SECRET" },
          log: "::error::CANARY-VALUE",
        }),
        secrets,
      ),
    ).toEqual([
      "The dashboard holds CANARY-VALUE.",
      "A comment holds CANARY-VALUE.",
      "An annotation holds CANARY-VALUE.",
      "The summary holds CANARY-SECRET.",
      "The output matrix holds CANARY-SECRET.",
    ]);
  });
});

// A chain of stacks (record 0056): the stacks after the first layer have a
// queued record behind the stack before them and a queued row.
describe("the queued stacks of a chain", () => {
  const queuedRecord = (over: Partial<LoopRecord> = {}) =>
    record(["queued"], {
      id: 2,
      task: "sluiceway:app:prod",
      environment: "sluiceway",
      payload: { ...PAYLOAD, behind: ["network:dev"] },
      ...over,
    });
  const queuedBody = dashboard(row("app:prod", "queued"));

  test("a queued record behind the right stack and a queued row are good", () => {
    expect(
      checkQueued(stepped({ body: queuedBody, records: [queuedRecord()] }), [
        { stack: "app:prod", behind: ["network:dev"] },
      ]),
    ).toEqual([]);
  });

  test("a record behind another stack, one that is not queued, and a row that is not queued are named", () => {
    expect(
      checkQueued(
        stepped({
          body: dashboard(row("app:prod", "deploying")),
          records: [queuedRecord({ states: ["queued", "in_progress"], payload: PAYLOAD })],
        }),
        [{ stack: "app:prod", behind: ["network:dev"] }],
      ),
    ).toEqual([
      "The newest record of app:prod waits behind nothing, expected network:dev.",
      "Deployment record 2 has the statuses queued, in_progress, expected queued.",
      "The row of app:prod is in state deploying, expected queued.",
    ]);
  });

  test("a stack with no record at all is named", () => {
    expect(
      checkQueued(stepped({ body: queuedBody, records: [] }), [
        { stack: "app:prod", behind: ["network:dev"] },
      ]),
    ).toEqual(["app:prod has no deployment record."]);
  });
});

// Slice 4.2 (record 0054): the checks of merge and deploy name what is wrong.
describe("merge and deploy", () => {
  const MERGE_ROW =
    '- [ ] **app:prod** · Update · #50 by renovate&#91;bot&#93; <!-- sluiceway:merge pr="50" stack="app:prod" head="4444444444444444444444444444444444444444" -->';
  const DEPLOYING = row("app:prod", "deploying");

  function step(over: Partial<LoopStep> = {}): LoopStep {
    return {
      exitCode: 0,
      log: "",
      summary: "",
      outputs: { matrix: "[]" },
      body: dashboard(DEPLOYING),
      newComments: [],
      records: [
        {
          id: 3,
          task: "sluiceway:app:prod",
          environment: "sluiceway",
          payload: { v: 1, ticker: "alice", run: "12", merge: 50 },
          states: ["queued"],
          description: "",
        },
      ],
      requests: [],
      newDispatches: 1,
      ...over,
    };
  }
  const expected = { pr: 50, stack: "app:prod", ticker: "alice", runId: "12" };

  test("a merge row is ticked by its pull request", () => {
    expect(mergeRows(tickMerge(MERGE_ROW, 50))).toEqual([
      { pr: "50", stack: "app:prod", ticked: true },
    ]);
    expect(() => tickMerge(MERGE_ROW, 51)).toThrow("The dashboard lists no #51 to merge.");
  });

  test("the merge tick is good as resolve leaves it, and each thing wrong is named", () => {
    expect(checkMergeTick(step(), expected)).toEqual([]);
    expect(checkMergeTick(step({ newDispatches: 0 }), expected)).toEqual([
      "The step started 0 runs, expected 1 scan.",
    ]);
    expect(checkMergeTick(step({ body: dashboard(DEPLOYING, MERGE_ROW) }), expected)).toEqual([
      "The dashboard still lists #50 to merge.",
    ]);
    expect(checkMergeTick(step({ records: [] }), expected)).toEqual([
      "No deployment record carries the merge of #50.",
    ]);
  });

  test("the hand-off is good as the scan leaves it, and a missing one is named", () => {
    const records: LoopRecord[] = [
      {
        ...step().records[0],
        states: ["queued", "inactive"],
        description: "merged, the deploy follows in a record of its own",
      } as LoopRecord,
      {
        id: 4,
        task: "sluiceway:app:prod",
        environment: "sluiceway",
        payload: { v: 1, hash: "05bf4ba5424cef76", ticker: "alice", run: "13" },
        states: ["queued"],
        description: "",
      },
    ];
    const good = step({
      records,
      outputs: { matrix: '[{"stack":"app:prod","environment":"sluiceway","deployment":4}]' },
    });
    const handOff = { stack: "app:prod", merge: 3, ticker: "alice", runId: "13" };
    expect(checkHandOff(good, handOff)).toEqual([]);
    expect(checkHandOff(step(), handOff)).toEqual([
      "Deployment record 3 has the statuses queued, expected queued, inactive.",
      'Deployment record 3 has the description "", expected "merged, the deploy follows in a record of its own".',
      "The matrix output is [], expected one entry for app:prod.",
    ]);
  });
});
