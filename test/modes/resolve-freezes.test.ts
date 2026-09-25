import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { HANDED_ON_DESCRIPTION } from "../../src/core/deployment.ts";
import { type ScanContext, scan } from "../../src/modes/scan.ts";
import { change, harness, pending, QUEUED_SPINNER } from "./harness.ts";
import {
  ALICE,
  matrix,
  RESOLVE_RUN,
  RESOLVE_RUN_URL,
  type ResolveHarness,
  rowsOf,
  scanned,
  tick,
  wake,
} from "./resolve-harness.ts";

// Deploy freezes (record 0115) on the fake: a tick during a freeze opens a
// record that waits for the end, as a tick outside a deploy window does
// (record 0104), the row and the line under the scan line name the freeze,
// nothing passes it, a destroy included, and the first run after the end
// starts what waited, at the first moment the freeze and a window allow.

const TABLE = {
  "app:prod": pending("app:prod", change("web")),
  "network:prod": pending("network:prod", change("vpc", "delete")),
  "site:prod": pending("site:prod", change("cdn")),
};

const FROZEN = `dashboard:
  timeZone: Europe/Brussels
freezes:
  - from: 2026-12-20T00:00
    to: 2027-01-05T00:00
    reason: Year-end freeze
`;

const OFFICE_HOURS = `deployWindows:
  - days: [monday, tuesday, wednesday, thursday]
    from: "09:00"
    to: "17:00"
`;

const CHRISTMAS = new Date("2026-12-24T12:00:00Z");
const ENDS = "2027-01-05 00:00 UTC+1";
// Tuesday 2027-01-05, 00:30 and 10:00 in Brussels.
const JUST_AFTER = new Date("2027-01-04T23:30:00Z");
const TUESDAY_TEN = new Date("2027-01-05T09:00:00Z");
const NEXT_RUN = "6161";
const DISPATCH = { ref: "refs/heads/main", workflow: ".github/workflows/sluiceway.yml" };

const firstLine = (row: string | undefined) => row?.split("\n")[0] ?? "";
const stacksOf = (h: ResolveHarness) =>
  (matrix(h) as { stack: string }[]).map(({ stack }) => stack);

function recordOf(h: ResolveHarness, stack: string, run = RESOLVE_RUN) {
  return h.github
    .deploymentsOf("sluiceway")
    .find(
      ({ task, payload }) =>
        task === `sluiceway:${stack}` && (payload as { run: string }).run === run,
    );
}

async function ticked(config = FROZEN, at = CHRISTMAS, stacks = ["app:prod"]) {
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

describe("a tick during a deploy freeze", () => {
  test("opens a record that waits for the end, hands nothing on, and the row names the freeze", async () => {
    const h = await ticked();

    expect(matrix(h)).toEqual([]);
    expect(recordOf(h, "app:prod")?.payload).toEqual({
      v: 1,
      hash: expect.any(String),
      ticker: "alice",
      run: RESOLVE_RUN,
      window: true,
    });
    expect(firstLine(rowsOf(h)["app:prod"])).toBe(
      `- ${QUEUED_SPINNER}**app:prod** · queued for the end of the deploy freeze (Year-end freeze) at ${ENDS} · ticked by alice · [run](${RESOLVE_RUN_URL}) <!-- sluiceway:row stack="app:prod" state="queued" -->`,
    );
    expect(h.log.lines).toContain(
      `app:prod is ticked during a deploy freeze. Its deployment record waits for the end of the deploy freeze (Year-end freeze) at ${ENDS}, and the first run after that starts it.`,
    );
    expect(h.github.comments(h.number)).toEqual([]);
  });

  test("the body names the freeze once, under the scan line", async () => {
    const h = await ticked();
    const body = h.github.issue(h.number).body;
    const line = `Deploy freeze until ${ENDS} (Year-end freeze): every deploy waits for it to end.`;
    expect(body.split(line)).toHaveLength(2);
    expect(body.indexOf(line)).toBeGreaterThan(body.indexOf("Scanned"));
    expect(body.indexOf(line)).toBeLessThan(body.indexOf("## "));
  });

  test("a destroy waits too: nothing passes a freeze", async () => {
    const h = await ticked(FROZEN, CHRISTMAS, ["network:prod"]);

    expect(matrix(h)).toEqual([]);
    expect(recordOf(h, "network:prod")?.payload).toMatchObject({ window: true });
  });

  test("an entry that lifts the windows of its stacks does not lift a freeze", async () => {
    const h = await ticked(
      `${FROZEN}${OFFICE_HOURS}stacks:\n  - path: app\n    deployWindows: []\n`,
    );

    expect(matrix(h)).toEqual([]);
    expect(recordOf(h, "app:prod")?.payload).toMatchObject({ window: true });
  });

  test("after the freeze the tick deploys as it always did, and the body names no freeze", async () => {
    const h = await ticked(FROZEN, TUESDAY_TEN);

    expect(stacksOf(h)).toEqual(["app:prod"]);
    expect(recordOf(h, "app:prod")?.payload).not.toHaveProperty("window");
    expect(h.github.issue(h.number).body).not.toContain("Deploy freeze");
  });
});

describe("the run after the freeze", () => {
  test("a dispatch during the freeze starts nothing and says when it ends", async () => {
    const h = await ticked();
    later(h, new Date("2026-12-28T10:00:00Z"));

    await wake(h, DISPATCH);

    expect(matrix(h)).toEqual([]);
    expect(recordOf(h, "app:prod")?.status?.state).toBe("queued");
    expect(h.log.lines).toContain(
      `app:prod waits for the end of the deploy freeze (Year-end freeze) at ${ENDS}. Nothing starts it before then.`,
    );
  });

  test("a dispatch after the end starts it under a record of its own run", async () => {
    const h = await ticked();
    later(h, JUST_AFTER);

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
    expect(h.log.lines).toContain(
      `app:prod: no deploy window or freeze holds it now, so it starts now. Deployment record ${started.id} is queued and takes over from record ${recordOf(h, "app:prod")?.id}.`,
    );
  });

  test("with a window, it goes at the first moment both allow: not at midnight, at nine", async () => {
    const h = await ticked(`${FROZEN}${OFFICE_HOURS}`);
    expect(firstLine(rowsOf(h)["app:prod"])).toContain(
      `· queued for the end of the deploy freeze (Year-end freeze) at ${ENDS}, and then for the deploy window, which opens 2027-01-05 09:00 UTC+1 · ticked by alice ·`,
    );

    later(h, JUST_AFTER);
    await wake(h, DISPATCH);
    expect(matrix(h)).toEqual([]);

    later(h, TUESDAY_TEN);
    await wake(h, DISPATCH);
    expect(stacksOf(h)).toEqual(["app:prod"]);
  });

  test("a freeze the repo took out of the file lets what waited go with the next run", async () => {
    const h = await ticked();
    writeFileSync(
      join(h.context.root, "sluiceway.yaml"),
      "dashboard:\n  timeZone: Europe/Brussels\n",
    );
    later(h, new Date("2026-12-28T10:00:00Z"));

    await wake(h, DISPATCH);

    expect(stacksOf(h)).toEqual(["app:prod"]);
  });

  test("a chain's next layer is held to the freeze when what it waited behind went out", async () => {
    const h = await ticked(
      `${FROZEN}stacks:\n  - path: app\n    dependsOn: [site:prod]\n`,
      new Date("2026-12-10T10:00:00Z"),
      ["app:prod", "site:prod"],
    );
    const [first] = matrix(h) as { deployment: number }[];
    h.github.addDeploymentStatus(first?.deployment ?? 0, { state: "success", autoInactive: false });

    later(h, CHRISTMAS);
    await wake(h, DISPATCH);
    expect(matrix(h)).toEqual([]);
    expect(h.log.lines).toContain(
      `app:prod: what it waited behind went out, and it waits for the end of the deploy freeze (Year-end freeze) at ${ENDS}. Nothing starts it before then.`,
    );

    later(h, JUST_AFTER);
    await wake(h, DISPATCH);
    expect(stacksOf(h)).toEqual(["app:prod"]);
  });
});

describe("a scan during the freeze", () => {
  test("draws the waiting row from the record, and the freeze line by its own clock", async () => {
    const h = await ticked();
    h.github.seedRun("8080", { completed: false });
    const body = h.github.issue(h.number).body;
    h.github.editBody(
      h.number,
      body.replace(/^- .*\*\*app:prod\*\*.*\n(?: {2}.*\n)*?/m, ""),
      ALICE,
    );
    const { context } = harness(h.adapter);
    const at: ScanContext = {
      ...context,
      root: h.context.root,
      github: h.github,
      log: h.log,
      runId: "8080",
      now: () => new Date("2026-12-26T10:00:00Z"),
    };

    await scan(at);

    expect(firstLine(rowsOf(h)["app:prod"])).toContain(
      `· queued for the end of the deploy freeze (Year-end freeze) at ${ENDS} · ticked by alice ·`,
    );
    expect(h.github.issue(h.number).body).toContain(
      `Deploy freeze until ${ENDS} (Year-end freeze): every deploy waits for it to end.`,
    );
  });
});
