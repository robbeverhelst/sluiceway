import { describe, expect, test } from "bun:test";
import { diffHash } from "../../src/core/diff-hash.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  change,
  dashboardBody,
  harness,
  inSync,
  pending,
  RUN_ID,
  SHA,
  tableAdapter,
} from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";

// Slice 5.31 (record 0095): a stack set to on-merge whose row would be pending
// after the scan of a merge is handed to `apply` by that scan, under a record
// of its own, as the scan after a merge from the dashboard hands one on
// (record 0054). Every other stack, and every stack whose change waits for a
// tick after all, gets its row as before, with a note that says why.

const CONFIG = `stacks:
  - path: app
    deploy: on-merge
`;

function rows(body: string): Record<string, { state: string; text: string; ticked: boolean }> {
  return Object.fromEntries(
    parseDashboard(body).rows.map((row) => [
      row.stackId,
      { state: row.state, text: row.text, ticked: row.known && row.ticked },
    ]),
  );
}

async function scanned(
  table: Parameters<typeof tableAdapter>[0],
  options: { config?: string; mergedBy?: string | undefined; event?: string } = {},
) {
  const outputs = rememberingOutputs();
  const { context, github, log } = harness(tableAdapter(table), {
    config: options.config ?? CONFIG,
    event: options.event ?? "push",
    outputs,
    ...("mergedBy" in options ? { mergedBy: options.mergedBy } : { mergedBy: "alice" }),
  });
  // The run of this scan is in progress, so the records it opens stay open.
  github.seedRun(RUN_ID, { completed: false });
  await scan(context);
  const matrix = JSON.parse(outputs.values.matrix ?? "[]") as {
    stack: string;
    environment: string;
    deployment: number;
  }[];
  return { github, log, matrix, body: dashboardBody(github) };
}

describe("the scan of a merge", () => {
  test("hands a pending stack set to on-merge to apply, attributed to whoever merged", async () => {
    const { github, matrix, body, log } = await scanned({
      "app:prod": pending("app:prod", change("motd")),
      "site:prod": pending("site:prod", change("index")),
    });

    expect(matrix).toEqual([{ stack: "app:prod", environment: "sluiceway", deployment: 1 }]);
    expect(github.deployment(1)).toMatchObject({
      task: "sluiceway:app:prod",
      sha: SHA,
      payload: {
        v: 1,
        hash: diffHash({ stackId: "app:prod", changes: [change("motd")] }),
        ticker: "alice",
        run: RUN_ID,
        onMerge: true,
      },
    });
    const found = rows(body);
    expect(found["app:prod"]?.state).toBe("deploying");
    expect(found["app:prod"]?.text).toContain("waiting to start on merge · merged by alice");
    // A stack left at the default waits for its tick, as always.
    expect(found["site:prod"]?.state).toBe("pending");
    expect(found["site:prod"]?.text).not.toContain("on merge");
    expect(log.lines).toContain(
      `app:prod deploys on merge: deployment record 1 is queued with diff hash ${diffHash({ stackId: "app:prod", changes: [change("motd")] })}, merged by alice, and handed to apply.`,
    );
  });

  test("a stack in sync is handed nothing", async () => {
    const { matrix, github } = await scanned({ "app:prod": inSync("app:prod") });
    expect(matrix).toEqual([]);
    expect(github.deploymentsOf("sluiceway")).toEqual([]);
  });

  test("a destroy waits for a tick, and the row says why", async () => {
    const { matrix, body } = await scanned({
      "app:prod": pending("app:prod", change("old", "delete")),
    });
    expect(matrix).toEqual([]);
    const row = rows(body)["app:prod"];
    expect(row?.state).toBe("pending");
    expect(row?.text).toContain(
      ":information_source: this stack deploys on merge, and this change waits for a tick: it deletes or replaces a resource.",
    );
  });

  test("a chain of two stacks set to on-merge: the first goes, the second is queued behind it", async () => {
    const { matrix, body, github } = await scanned(
      {
        "app:prod": pending("app:prod", change("motd")),
        "network:prod": pending("network:prod", change("vpc")),
      },
      {
        config: `stacks:
  - path: app
    deploy: on-merge
    dependsOn: [network:prod]
  - path: network
    deploy: on-merge
`,
      },
    );
    expect(matrix.map(({ stack }) => stack)).toEqual(["network:prod"]);
    const queued = github
      .deploymentsOf("sluiceway")
      .find(({ task }) => task === "sluiceway:app:prod");
    expect(queued?.payload).toMatchObject({
      behind: ["network:prod"],
      onMerge: true,
      ticker: "alice",
    });
    expect(rows(body)["app:prod"]?.state).toBe("queued");
  });

  test("a stack that depends on one waiting for a tick waits too, and names it", async () => {
    const { matrix, body } = await scanned(
      {
        "app:prod": pending("app:prod", change("motd")),
        "network:prod": pending("network:prod", change("vpc")),
      },
      {
        config: `stacks:
  - path: app
    deploy: on-merge
    dependsOn: [network:prod]
`,
      },
    );
    expect(matrix).toEqual([]);
    expect(rows(body)["app:prod"]?.text).toContain(
      "this change waits for a tick: it depends on **network:prod**, which has a change waiting.",
    );
  });

  test("deploys: false stops it, and the row says so", async () => {
    const { matrix, body, github } = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      { config: `deploys: false\n${CONFIG}` },
    );
    expect(matrix).toEqual([]);
    expect(github.deploymentsOf("sluiceway")).toEqual([]);
    expect(rows(body)["app:prod"]?.text).toContain(
      "this stack deploys on merge, and deploys are turned off in `sluiceway.yaml`.",
    );
  });

  test("a read-only dashboard deploys nothing and adds no note", async () => {
    const { matrix, body, github } = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      { config: `dashboard:\n  readOnly: true\n${CONFIG}` },
    );
    expect(matrix).toEqual([]);
    expect(github.deploymentsOf("sluiceway")).toEqual([]);
    expect(rows(body)["app:prod"]?.text).not.toContain("on merge");
  });
});

describe("a scan no merge started", () => {
  test("hands nothing on, and the row says the change waits for a tick", async () => {
    const { matrix, body } = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      { mergedBy: undefined, event: "schedule" },
    );
    expect(matrix).toEqual([]);
    expect(rows(body)["app:prod"]?.text).toContain(
      "this change waits for a tick: the scan that found it did not follow a merge.",
    );
  });

  // Deploy windows (record 0104): the scan's clock is Monday 06:00 UTC, which
  // is 08:00 in Brussels, before office hours open at 09:00.
  test("outside the deploy window the record waits for it, and the row says when it opens", async () => {
    const { github, matrix, body, log } = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      {
        config: `dashboard:
  timeZone: Europe/Brussels
deployWindows:
  - days: [monday, tuesday, wednesday, thursday]
    from: "09:00"
    to: "17:00"
stacks:
  - path: app
    deploy: on-merge
`,
      },
    );

    expect(matrix).toEqual([]);
    expect(github.deployment(1).payload).toMatchObject({
      ticker: "alice",
      onMerge: true,
      window: true,
    });
    expect(github.deployment(1).status?.state).toBe("queued");
    const row = rows(body)["app:prod"];
    expect(row?.state).toBe("queued");
    expect(row?.text.split("\n")[0]).toContain(
      "· queued for the deploy window, which opens 2026-09-21 09:00 UTC+2 · merged by alice ·",
    );
    expect(log.lines).toContain(
      `app:prod deploys on merge: deployment record 1 with diff hash ${diffHash({ stackId: "app:prod", changes: [change("motd")] })}, merged by alice, waits for the deploy window, and a run inside the window starts it.`,
    );
  });

  // Deploy freezes (record 0115): the scan's clock, Monday 06:00 UTC, falls
  // in a freeze, so the deploy on merge waits for its end, and the body
  // names the freeze under the scan line.
  test("during a deploy freeze the record waits for its end, and the row and the body name it", async () => {
    const { github, matrix, body, log } = await scanned(
      { "app:prod": pending("app:prod", change("motd")) },
      {
        config: `freezes:
  - from: 2026-09-20T00:00
    to: 2026-09-23T00:00
    reason: Launch week
stacks:
  - path: app
    deploy: on-merge
`,
      },
    );

    expect(matrix).toEqual([]);
    expect(github.deployment(1).payload).toMatchObject({ onMerge: true, window: true });
    expect(rows(body)["app:prod"]?.text.split("\n")[0]).toContain(
      "· queued for the end of the deploy freeze (Launch week) at 2026-09-23 00:00 UTC · merged by alice ·",
    );
    expect(body).toContain(
      "Deploy freeze until 2026-09-23 00:00 UTC (Launch week): every deploy waits for it to end.",
    );
    expect(log.lines).toContain(
      `app:prod deploys on merge: deployment record 1 with diff hash ${diffHash({ stackId: "app:prod", changes: [change("motd")] })}, merged by alice, waits for the deploy window or the end of a deploy freeze, and the first run when both allow starts it.`,
    );
  });
});
