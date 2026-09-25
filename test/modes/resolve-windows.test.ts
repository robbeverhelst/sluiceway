import { describe, expect, test } from "bun:test";
import { HANDED_ON_DESCRIPTION } from "../../src/core/deployment.ts";
import { type ScanContext, scan } from "../../src/modes/scan.ts";
import { type SettleContext, settle } from "../../src/modes/settle.ts";
import { ACTION_REF, change, harness, pending, QUEUED_SPINNER, REPO_URL } from "./harness.ts";
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

// Deploy windows (record 0104) on the fake: a tick outside the window opens a
// record that waits for it, the row says when it opens in the dashboard zone,
// a run inside the window starts it under a record of its own, a scan keeps
// the row, and `settle` leaves the record open at the end of its run.

const TABLE = {
  "app:prod": pending("app:prod", change("web")),
  "network:prod": pending("network:prod", change("vpc")),
  "site:prod": pending("site:prod", change("cdn")),
};

const OFFICE_HOURS = `dashboard:
  timeZone: Europe/Brussels
deployWindows:
  - days: [monday, tuesday, wednesday, thursday]
    from: "09:00"
    to: "17:00"
`;

// Friday 18:00 and Monday 10:00 in Brussels, and when the window opens.
const FRIDAY = new Date("2026-09-25T16:00:00Z");
const MONDAY = new Date("2026-09-28T08:00:00Z");
const OPENS = "2026-09-28 09:00 UTC+2";
const NEXT_RUN = "6161";

const firstLine = (row: string | undefined) => row?.split("\n")[0] ?? "";

function recordOf(h: ResolveHarness, stack: string, run = RESOLVE_RUN) {
  return h.github
    .deploymentsOf("sluiceway")
    .find(
      ({ task, payload }) =>
        task === `sluiceway:${stack}` && (payload as { run: string }).run === run,
    );
}

async function ticked(config = OFFICE_HOURS, at = FRIDAY, stacks = ["app:prod"]) {
  const h = await scanned(TABLE, { config });
  h.context.now = () => at;
  tick(h, ALICE, stacks);
  await wake(h);
  return h;
}

// The run a dispatch starts later, at `at`.
function later(h: ResolveHarness, at: Date): void {
  h.github.seedRun(RESOLVE_RUN, { completed: true });
  h.github.seedRun(NEXT_RUN, { completed: false });
  h.context.runId = NEXT_RUN;
  h.context.now = () => at;
  h.outputs.length = 0;
  h.log.lines.length = 0;
}

const DISPATCH = { ref: "refs/heads/main", workflow: ".github/workflows/sluiceway.yml" };

describe("a tick outside the deploy window", () => {
  test("opens a record that waits for the window, hands nothing on, and the row says when it opens", async () => {
    const h = await ticked();

    expect(matrix(h)).toEqual([]);
    const record = recordOf(h, "app:prod");
    expect(record?.payload).toEqual({
      v: 1,
      hash: expect.any(String),
      ticker: "alice",
      run: RESOLVE_RUN,
      window: true,
    });
    expect(record?.status?.state).toBe("queued");
    expect(firstLine(rowsOf(h)["app:prod"])).toBe(
      `- ${QUEUED_SPINNER}**app:prod** · queued for the deploy window, which opens ${OPENS} · ticked by alice · [run](${RESOLVE_RUN_URL}) <!-- sluiceway:row stack="app:prod" state="queued" -->`,
    );
    expect(h.log.lines).toContain(
      `app:prod is ticked outside its deploy window, which opens ${OPENS}. Its deployment record waits for the window, and a run inside the window starts it.`,
    );
    expect(h.github.comments(h.number)).toEqual([]);
  });

  test("inside the window the tick deploys as it always did", async () => {
    const h = await ticked(OFFICE_HOURS, MONDAY);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["app:prod"]);
    expect(recordOf(h, "app:prod")?.payload).not.toHaveProperty("window");
    expect(firstLine(rowsOf(h)["app:prod"])).toContain("· waiting to start · ticked by alice ·");
  });

  test("a stack whose entry lifts the windows goes out on a Friday evening", async () => {
    const h = await ticked(`${OFFICE_HOURS}stacks:\n  - path: app\n    deployWindows: []\n`);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["app:prod"]);
  });

  test("a chain: the first layer waits for the window, and the next says it waits behind it and for the window", async () => {
    const h = await ticked(
      `${OFFICE_HOURS}stacks:\n  - path: app\n    dependsOn: [network:prod]\n`,
      FRIDAY,
      ["app:prod", "network:prod"],
    );

    expect(matrix(h)).toEqual([]);
    expect(recordOf(h, "network:prod")?.payload).toMatchObject({ window: true });
    expect(recordOf(h, "app:prod")?.payload).toMatchObject({ behind: ["network:prod"] });
    expect(recordOf(h, "app:prod")?.payload).not.toHaveProperty("window");
    const rows = rowsOf(h);
    expect(firstLine(rows["network:prod"])).toContain(
      `· queued for the deploy window, which opens ${OPENS} · ticked by alice ·`,
    );
    expect(firstLine(rows["app:prod"])).toContain(
      `· queued behind **network:prod**, and for the deploy window, which opens ${OPENS} · ticked by alice ·`,
    );
  });
});

describe("a run inside the window", () => {
  test("started by a dispatch, starts the waiting stack under a record of its own run", async () => {
    const h = await ticked();
    later(h, MONDAY);

    await wake(h, DISPATCH);

    const entries = matrix(h) as { stack: string; deployment: number }[];
    expect(entries.map(({ stack }) => stack)).toEqual(["app:prod"]);
    const started = h.github.deployment(entries[0]?.deployment ?? 0);
    expect(started.payload).toEqual({
      v: 1,
      hash: (recordOf(h, "app:prod")?.payload as { hash?: string } | undefined)?.hash,
      ticker: "alice",
      run: NEXT_RUN,
    });
    expect(recordOf(h, "app:prod")?.status).toMatchObject({
      state: "inactive",
      description: HANDED_ON_DESCRIPTION,
    });
    expect(firstLine(rowsOf(h)["app:prod"])).toContain(
      `· waiting to start · ticked by alice · [run](${REPO_URL}/actions/runs/${NEXT_RUN})`,
    );
    expect(h.log.lines).toContain(
      `app:prod: its deploy window is open, so it starts now. Deployment record ${started.id} is queued and takes over from record ${recordOf(h, "app:prod")?.id}.`,
    );
  });

  test("a dispatch outside the window starts nothing and says when the window opens", async () => {
    const h = await ticked();
    later(h, new Date("2026-09-26T10:00:00Z"));

    await wake(h, DISPATCH);

    expect(matrix(h)).toEqual([]);
    expect(recordOf(h, "app:prod")?.status?.state).toBe("queued");
    expect(h.log.lines).toContain(
      `app:prod waits for its deploy window, which opens ${OPENS}. Nothing starts it before then.`,
    );
  });

  test("a chain whose first layer went out starts the next only inside the window", async () => {
    const h = await ticked(
      `${OFFICE_HOURS}stacks:\n  - path: app\n    dependsOn: [network:prod]\n`,
      MONDAY,
      ["app:prod", "network:prod"],
    );
    const [first] = matrix(h) as { deployment: number }[];
    h.github.addDeploymentStatus(first?.deployment ?? 0, { state: "success", autoInactive: false });

    later(h, FRIDAY);
    await wake(h, DISPATCH);
    expect(matrix(h)).toEqual([]);
    expect(h.log.lines).toContain(
      `app:prod: what it waited behind went out, and its deploy window opens ${OPENS}. It starts in a run inside the window.`,
    );

    later(h, MONDAY);
    await wake(h, DISPATCH);
    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["app:prod"]);
  });
});

function scanContext(h: ResolveHarness, at: Date): ScanContext {
  const { context } = harness(h.adapter);
  return {
    ...context,
    root: h.context.root,
    github: h.github,
    log: h.log,
    runId: "8080",
    now: () => at,
  };
}

describe("a scan while a stack waits for the window", () => {
  test("keeps the row from the record, with the time the window opens", async () => {
    const h = await ticked();
    h.github.seedRun("8080", { completed: false });
    h.github.seedRun(RESOLVE_RUN, { completed: true });

    await scan(scanContext(h, new Date("2026-09-26T10:00:00Z")));

    expect(firstLine(rowsOf(h)["app:prod"])).toBe(
      `- ${QUEUED_SPINNER}**app:prod** · queued for the deploy window, which opens ${OPENS} · ticked by alice · [run](${RESOLVE_RUN_URL}) <!-- sluiceway:row stack="app:prod" state="queued" -->`,
    );
    expect(recordOf(h, "app:prod")?.status?.state).toBe("queued");
  });

  test("carries the row as resolve wrote it while the record is the same, as it carries any queued row", async () => {
    const h = await ticked();
    h.github.seedRun("8080", { completed: false });
    const before = rowsOf(h)["app:prod"];

    await scan(scanContext(h, MONDAY));

    expect(rowsOf(h)["app:prod"]).toBe(before as string);
  });

  test("makes the row from the record when the live body lost it, and says the window is open", async () => {
    const h = await ticked();
    h.github.seedRun("8080", { completed: false });
    const body = h.github.issue(h.number).body;
    h.github.editBody(
      h.number,
      body.replace(/^- .*\*\*app:prod\*\*.*\n(?: {2}.*\n)*?/m, ""),
      ALICE,
    );

    await scan(scanContext(h, MONDAY));

    expect(firstLine(rowsOf(h)["app:prod"])).toBe(
      `- ${QUEUED_SPINNER}**app:prod** · queued for the deploy window, which is open: the next scheduled run starts it · ticked by alice · [run](${RESOLVE_RUN_URL}) <!-- sluiceway:row stack="app:prod" state="queued" -->`,
    );
  });
});

describe("settle at the end of the run that opened it", () => {
  test("leaves the record open and starts no scan for it", async () => {
    const h = await ticked();
    h.log.lines.length = 0;
    const context: SettleContext = {
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

    await settle(context);

    expect(recordOf(h, "app:prod")?.status?.state).toBe("queued");
    expect(h.github.requests).not.toContain("dispatchWorkflow");
    expect(h.log.lines.at(-1)).toContain("what is queued still waits");
  });
});
