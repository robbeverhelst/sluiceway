import { describe, expect, test } from "bun:test";
import type { Comparison } from "../../src/github/port.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  change,
  dashboardBody,
  failing,
  type Harness,
  harness,
  inSync,
  pending,
  SHA,
  type TableAdapter,
  tableAdapter,
} from "./harness.ts";

// The commit of the scan that wrote the dashboard a push then meets.
const OLD = "1111111111111111111111111111111111111111";
const OLD_RUN = "4000";

type Table = Parameters<typeof tableAdapter>[0];

// A repo whose dashboard an earlier full scan wrote at OLD. What comes back is
// the harness of the scan that follows a push to SHA, with a fresh adapter on
// the same table, so `previewed` holds only what that scan previews.
async function pushed(
  table: Table,
  comparison: Comparison | undefined,
  options: { config?: string; next?: Table } = {},
): Promise<Harness & { adapter: TableAdapter; before: string }> {
  const first = harness(tableAdapter(table), {
    sha: OLD,
    runId: OLD_RUN,
    ...(options.config === undefined ? {} : { config: options.config }),
  });
  await scan(first.context);
  const before = dashboardBody(first.github);

  const adapter = tableAdapter({ ...table, ...options.next });
  // Discovery follows the first table, so a stack that `next` adds is new.
  if (comparison) first.github.seedComparison(OLD, SHA, comparison);
  // A log and a clock of its own, so both start where a test expects them to.
  const fresh = harness(adapter);
  const { log } = fresh;
  const { now } = fresh.context;
  return {
    context: { ...first.context, adapter, log, now, sha: SHA, runId: "4242", event: "push" },
    github: first.github,
    log,
    adapter,
    before,
  };
}

function ahead(...paths: string[]): Comparison {
  return { status: "ahead", files: paths.map((path) => ({ path })) };
}

function rowTexts(body: string): Record<string, string> {
  return Object.fromEntries(parseDashboard(body).rows.map((row) => [row.stackId, row.text]));
}

const TABLE: Table = {
  "app:prod": pending("app:prod", change("motd")),
  "network:dev": pending("network:dev", change("logs"), change("old", "delete")),
  "network:prod": inSync("network:prod"),
  "site:prod": inSync("site:prod"),
};

describe("a scan that follows a push", () => {
  test("previews only the stacks that claim a changed file, and keeps every other row as it is", async () => {
    const { context, github, adapter, before } = await pushed(TABLE, ahead("site/index.ts"), {
      next: { "site:prod": pending("site:prod", change("page")) },
    });

    await scan(context);

    expect(adapter.previewed).toEqual(["site:prod"]);
    const rows = rowTexts(dashboardBody(github));
    expect(rows["site:prod"]).toContain("- [ ] **site:prod** · 1 update");
    // A fresh pending row links to the preview page this scan wrote (record
    // 0050).
    expect(rows["site:prod"]).toContain(`[preview](${github.checkRuns(SHA)[0]?.htmlUrl})`);
    for (const carried of ["app:prod", "network:dev", "network:prod"]) {
      expect(rows[carried]).toBe(rowTexts(before)[carried] as string);
    }
    // A carried row keeps the link to the page of the scan that previewed it
    // (records 0011 and 0050).
    const page = github.checkRuns(OLD).find(({ name }) => name === "sluiceway / network:dev");
    expect(rows["network:dev"]).toContain(`[preview](${page?.htmlUrl})`);
  });
});

function root(body: string) {
  return parseDashboard(body).root;
}

const FULL_AT_OLD = { fullScanAt: "2026-09-21T06:00:00.000Z", fullScanRun: OLD_RUN };
const ALL = ["app:prod", "network:dev", "network:prod", "site:prod"];

// Puts another first line on the dashboard, as a person or an older version
// could have left it.
function withRootLine(harnessed: Harness, line: string): void {
  const [, ...rest] = dashboardBody(harnessed.github).split("\n");
  harnessed.github.editBody(1, [line, ...rest].join("\n"));
}

describe("falling back to a full scan (record 0010)", () => {
  // Each case: every stack is previewed, the log says why, and the root marker
  // records a full scan.
  async function expectFull(pushedScan: Awaited<ReturnType<typeof pushed>>, why: string) {
    await scan(pushedScan.context);
    expect(pushedScan.adapter.previewed).toEqual(ALL);
    expect(pushedScan.log.lines).toContain(
      `This is a full scan. A push gives a narrowed scan, and this one fell back to a full scan: ${why}.`,
    );
    expect(root(dashboardBody(pushedScan.github))).toMatchObject({
      scanSha: SHA,
      fullScanRun: "4242",
    });
  }

  test("a scan that does not follow a push is a full scan, and asks GitHub for no comparison", async () => {
    for (const event of ["schedule", "workflow_dispatch"]) {
      const scanned = await pushed(TABLE, ahead("site/index.ts"));
      await scan({ ...scanned.context, event });
      expect(scanned.adapter.previewed).toEqual(ALL);
      expect(scanned.log.lines).toContain(
        `This is a full scan: the event is ${event}, and only a push, or the scan resolve starts after a merge, gives a narrowed scan.`,
      );
      expect(scanned.github.requests).not.toContain("compareCommits");
      expect(root(dashboardBody(scanned.github))?.fullScanRun).toBe("4242");
    }
  });

  test("there is no dashboard yet", async () => {
    const adapter = tableAdapter(TABLE);
    const { context, github, log } = harness(adapter, { event: "push" });
    await scan(context);
    expect(adapter.previewed).toEqual(ALL);
    expect(log.lines).toContain(
      "This is a full scan. A push gives a narrowed scan, and this one fell back to a full scan: there is no dashboard yet.",
    );
    expect(github.requests).not.toContain("compareCommits");
    expect(root(dashboardBody(github))?.fullScanRun).toBe("4242");
  });

  test("the root marker cannot be read", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"));
    withRootLine(scanned, `<!-- sluiceway:dashboard scan-sha="${OLD}" -->`);
    await expectFull(scanned, "the dashboard has no root marker that can be read");
  });

  test("the root marker is of another version", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"));
    withRootLine(scanned, `<!-- sluiceway:dashboard v="2" scan-sha="${OLD}" -->`);
    await expectFull(
      scanned,
      "the root marker of the dashboard has version 2, which this version of Sluiceway does not write",
    );
  });

  test("the root marker names no commit", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"));
    withRootLine(scanned, '<!-- sluiceway:dashboard v="1" scan-sha="main" -->');
    await expectFull(scanned, "the root marker of the dashboard names no commit to compare from");
    expect(scanned.github.requests).not.toContain("compareCommits");
  });

  test("the compare call fails, as it does for a commit that a force push took away", async () => {
    const scanned = await pushed(TABLE, undefined);
    await expectFull(
      scanned,
      "GitHub did not give the comparison from the commit of the last scan",
    );
    expect(scanned.log.lines).toContain("Comparing 1111111 with 0123456 failed: Not Found");
  });

  test.each(["diverged", "behind"])(
    "the comparison is %s, not a straight line: a force push, or a re-run of an old run",
    async (status) => {
      const scanned = await pushed(TABLE, { status, files: [{ path: "site/index.ts" }] });
      await expectFull(
        scanned,
        `the checked-out commit does not follow the commit of the last scan in a straight line (GitHub calls it "${status}"), as after a force push or a re-run of an older run`,
      );
    },
  );

  // Slice 5.9: past the cap the trees of the two commits are compared. Here
  // GitHub has no tree for them, so the scan falls back.
  test("the file list is at the cap of 300 files and the trees cannot be read", async () => {
    const paths = Array.from({ length: 300 }, (_, index) => `site/page${index}.ts`);
    await expectFull(
      await pushed(TABLE, ahead(...paths)),
      "the comparison lists 300 files, the most GitHub gives, and the trees of the two commits could not be compared, so files may be missing from it",
    );
  });

  test("the file list is at the cap of 300 files and a tree is truncated", async () => {
    const paths = Array.from({ length: 300 }, (_, index) => `site/page${index}.ts`);
    const scanned = await pushed(TABLE, ahead(...paths));
    scanned.github.seedTree(OLD, [], { truncated: true });
    scanned.github.seedTree(SHA, []);
    await expectFull(
      scanned,
      "the comparison lists 300 files, the most GitHub gives, and the trees of the two commits could not be compared, so files may be missing from it",
    );
  });

  test("a changed file has no claimant, and the log names every such file", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts", "package.json", "bun.lock"));
    await expectFull(scanned, "no stack claims package.json and 1 more changed file");
    expect(scanned.log.groups[0]).toEqual({
      title: "Changed files that no stack claims",
      lines: [
        "unclaimed: package.json",
        "unclaimed: bun.lock",
        "A file that some stacks read belongs under the inputs of those stacks in sluiceway.yaml. A file that no stack reads can be listed under scan.unrelated.",
      ],
    });
  });

  // Record 0010 needs no special case for them. The words say that the config
  // file changed, and only the other files are listed as unclaimed, since no
  // stack is meant to claim the config file (onboarding log, hurdle 14).
  test("sluiceway.yaml and a Makefile lie outside every stack, and the log says the config file changed", async () => {
    const scanned = await pushed(TABLE, ahead("sluiceway.yaml", "Makefile"));
    await expectFull(
      scanned,
      "sluiceway.yaml changed, so every stack is previewed, and no stack claims Makefile",
    );
    expect(scanned.log.groups[0]).toEqual({
      title: "Changed files that no stack claims",
      lines: [
        "unclaimed: Makefile",
        "A file that some stacks read belongs under the inputs of those stacks in sluiceway.yaml. A file that no stack reads can be listed under scan.unrelated.",
      ],
    });
  });

  test("a change to sluiceway.yaml alone lists no unclaimed files", async () => {
    const scanned = await pushed(TABLE, ahead("sluiceway.yaml"));
    await expectFull(scanned, "sluiceway.yaml changed, so every stack is previewed");
    expect(scanned.log.groups.map((group) => group.title)).not.toContain(
      "Changed files that no stack claims",
    );
  });

  test("a file in the directory of an ignored stack has no claimant either", async () => {
    const scanned = await pushed(
      { ...TABLE, "playground:dev": inSync("playground:dev") },
      ahead("playground/Pulumi.yaml"),
      { config: 'ignore: ["playground:*"]\n' },
    );
    await expectFull(scanned, "no stack claims playground/Pulumi.yaml");
  });

  test("a file name cannot start a line of its own in the job log", async () => {
    const scanned = await pushed(TABLE, ahead("evil\n::error::x"));
    await scan(scanned.context);
    expect(scanned.log.lines.join("\n")).not.toContain("\n::error::");
    expect(scanned.log.groups[0]?.lines[0]).toBe("unclaimed: evil ::error::x");
  });
});

// Slice 5.9: a push of more than 300 files is narrowed by the trees of the
// two commits, two requests whatever the number of files.
describe("a push of more than 300 files", () => {
  test("is narrowed by the paths the two trees differ by", async () => {
    const paths = Array.from({ length: 450 }, (_, index) => `site/page${index}.ts`);
    const scanned = await pushed(TABLE, ahead(...paths.slice(0, 300)), {
      next: { "site:prod": pending("site:prod", change("page")) },
    });
    const blob = (path: string, sha: string) => ({ path, sha, type: "blob" });
    scanned.github.seedTree(OLD, [
      blob("app/Pulumi.yaml", "a"),
      ...paths.map((path) => blob(path, "1")),
    ]);
    scanned.github.seedTree(SHA, [
      blob("app/Pulumi.yaml", "a"),
      ...paths.map((path) => blob(path, "2")),
    ]);

    await scan(scanned.context);

    expect(scanned.adapter.previewed).toEqual(["site:prod"]);
    expect(scanned.log.lines).toContain(
      "The comparison lists 300 files, the most GitHub gives, so the trees of the two commits were compared: 450 files changed.",
    );
    expect(scanned.github.requests.filter((request) => request === "readTree")).toHaveLength(2);
  });
});

describe("the claim rule in a scan", () => {
  test("a renamed file counts under its old and its new path", async () => {
    const { context, adapter } = await pushed(TABLE, {
      status: "ahead",
      files: [{ path: "site/motd.txt", previousPath: "app/motd.txt" }],
    });
    await scan(context);
    expect(adapter.previewed).toEqual(["app:prod", "site:prod"]);
  });

  test("both stacks of one directory claim a file in it", async () => {
    const { context, adapter } = await pushed(TABLE, ahead("network/Pulumi.yaml"));
    await scan(context);
    expect(adapter.previewed).toEqual(["network:dev", "network:prod"]);
  });

  test("when one stack directory contains another, a file in the inner one is claimed by both", async () => {
    const table: Table = {
      "apps/loki:prod": inSync("apps/loki:prod"),
      "platform:prod": inSync("platform:prod"),
      "platform/dns:prod": inSync("platform/dns:prod"),
    };
    const inner = await pushed(table, ahead("platform/dns/zone.ts"));
    await scan(inner.context);
    expect(inner.adapter.previewed).toEqual(["platform/dns:prod", "platform:prod"]);

    const outer = await pushed(table, ahead("platform/main.ts"));
    await scan(outer.context);
    expect(outer.adapter.previewed).toEqual(["platform:prod"]);
  });

  test("a stack at the repo root claims every file, so nothing is ever unclaimed", async () => {
    const table: Table = { ".:prod": inSync(".:prod"), "apps/loki:prod": inSync("apps/loki:prod") };
    const { context, adapter, log } = await pushed(table, ahead("package.json"));
    await scan(context);
    expect(adapter.previewed).toEqual([".:prod"]);
    expect(log.lines).toContain(".:prod is previewed: it claims package.json.");
  });

  test("an inputs glob adds a claim", async () => {
    const { context, adapter } = await pushed(TABLE, ahead("shared/motd.txt"), {
      config: 'stacks:\n  - path: app\n    inputs: ["shared/**"]\n',
    });
    await scan(context);
    expect(adapter.previewed).toEqual(["app:prod"]);
  });

  // Slice 5.9: docs and tooling files outside every stack force nothing
  // without any setting, and a stack still claims its own README.
  test("a push that changes only default unrelated files outside every stack previews nothing, and a stack's own README previews it", async () => {
    const outside = await pushed(
      TABLE,
      ahead("README.md", "docs/setup.md", ".github/workflows/deploy.yml", "LICENSE"),
    );
    await scan(outside.context);
    expect(outside.adapter.previewed).toEqual([]);

    const own = await pushed(TABLE, ahead("README.md", "site/README.md"));
    await scan(own.context);
    expect(own.adapter.previewed).toEqual(["site:prod"]);
  });

  test("a push that changes only unrelated files previews nothing, needs no tool, moves scan-sha and keeps every row", async () => {
    const { context, github, adapter, log, before } = await pushed(
      TABLE,
      ahead("README.md", "site/README.md"),
      { config: 'scan:\n  unrelated: ["**/*.md"]\n' },
    );
    await scan(context);

    expect(adapter.previewed).toEqual([]);
    expect(adapter.versionChecks).toBe(0);
    expect(rowTexts(dashboardBody(github))).toEqual(rowTexts(before));
    expect(root(dashboardBody(github))).toMatchObject({ scanSha: SHA, scanRun: "4242" });
    expect(log.lines).toContain(
      "This is a narrowed scan. No stack has to be previewed, so every row is kept as it is.",
    );
    expect(log.summaries).toEqual([expect.stringContaining("No stacks previewed.")]);
  });

  test("the same commit scanned again is a narrowed scan that previews nothing new", async () => {
    const scanned = await pushed(TABLE, undefined);
    scanned.github.seedComparison(OLD, OLD, { status: "identical", files: [] });
    await scan({ ...scanned.context, sha: OLD });
    expect(scanned.adapter.previewed).toEqual([]);
  });
});

describe("one row for every discovered stack (record 0011)", () => {
  test("a row deleted by hand comes back, although its stack claims nothing", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"));
    const gone = rowTexts(scanned.before)["network:dev"] as string;
    scanned.github.editBody(1, scanned.before.replace(`${gone}\n`, ""));
    expect(Object.keys(rowTexts(dashboardBody(scanned.github)))).not.toContain("network:dev");

    await scan(scanned.context);

    expect(scanned.adapter.previewed).toEqual(["network:dev", "site:prod"]);
    expect(scanned.log.lines).toContain(
      "network:dev is previewed: it has no row on the dashboard.",
    );
    expect(Object.keys(rowTexts(dashboardBody(scanned.github))).sort()).toEqual(ALL);
  });

  test("a row that goes missing between the first read and the late read is previewed then, and the scan returns to its late read", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"));
    const gone = rowTexts(scanned.before)["app:prod"] as string;
    let reads = 0;
    scanned.github.onRequest = (request) => {
      // The first read of the body is the list. The late read is the first
      // getIssue, and a person's edit lands just before it.
      if (request === "getIssue" && reads++ === 0) {
        scanned.github.editBody(1, scanned.before.replace(`${gone}\n`, ""));
      }
    };

    await scan(scanned.context);

    expect(scanned.adapter.previewed).toEqual(["site:prod", "app:prod"]);
    expect(scanned.log.lines).toContain(
      "app:prod is previewed now: the dashboard has no row for it any more.",
    );
    expect(Object.keys(rowTexts(dashboardBody(scanned.github))).sort()).toEqual(ALL);
    // The summary holds both stacks, and the second one took the place of the first.
    expect(scanned.log.summaries).toHaveLength(2);
    expect(scanned.log.summaries[1]).toContain("2 stacks previewed");
    expect(scanned.log.groups.map((group) => group.title)).toEqual(["site:prod", "app:prod"]);
    expect(scanned.adapter.versionChecks).toBe(1);
  });

  test("a body that loses its root marker before the late read turns the scan into a full one by itself", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"));
    let reads = 0;
    scanned.github.onRequest = (request) => {
      if (request === "getIssue" && reads++ === 0) {
        withRootLine(scanned, '<!-- sluiceway:dashboard v="2" -->');
      }
    };
    await scan(scanned.context);
    expect(scanned.adapter.previewed).toEqual([
      "site:prod",
      "app:prod",
      "network:dev",
      "network:prod",
    ]);
    expect(root(dashboardBody(scanned.github))).toMatchObject({ version: 1, fullScanRun: "4242" });
  });

  test("a new stack gets a row and a removed stack loses its row, on a narrowed scan too", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"));
    const { "network:dev": _removed, ...rest } = TABLE;
    const adapter = tableAdapter({ ...rest, "cache:prod": pending("cache:prod", change("redis")) });

    await scan({ ...scanned.context, adapter });

    expect(adapter.previewed).toEqual(["cache:prod", "site:prod"]);
    expect(Object.keys(rowTexts(dashboardBody(scanned.github))).sort()).toEqual([
      "app:prod",
      "cache:prod",
      "network:prod",
      "site:prod",
    ]);
    expect(scanned.log.lines).toContain(
      "Dropped the row of network:dev: discovery knows no such stack.",
    );
  });

  test("of two row blocks for one stack the first stays, so the dashboard ends with one row for it", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"));
    const first = rowTexts(scanned.before)["network:dev"] as string;
    const second = first.replace("- [ ]", "- [x]");
    scanned.github.editBody(1, scanned.before.replace(first, `${first}\n${second}`));
    await scan(scanned.context);
    const rows = parseDashboard(dashboardBody(scanned.github)).rows;
    expect(rows.map((row) => row.stackId).sort()).toEqual(ALL);
    expect(rowTexts(dashboardBody(scanned.github))["network:dev"]).toBe(first);
  });

  test("a stack whose row is a preview failure is previewed again, so a transient failure heals on the next push", async () => {
    const scanned = await pushed({ ...TABLE, "network:prod": failing() }, ahead("site/index.ts"), {
      next: { "network:prod": inSync("network:prod") },
    });
    await scan(scanned.context);
    expect(scanned.adapter.previewed).toEqual(["network:prod", "site:prod"]);
    expect(scanned.log.lines).toContain("network:prod is previewed: its row is a preview failure.");
    expect(parseDashboard(dashboardBody(scanned.github)).rows).toContainEqual(
      expect.objectContaining({ stackId: "network:prod", state: "in-sync" }),
    );
  });
});

describe("what a narrowed scan carries through (records 0009 and 0011)", () => {
  test("scan-sha, scan-run and scan-at move, and the full-scan keys stay as the last full scan wrote them", async () => {
    const { context, github } = await pushed(TABLE, ahead("site/index.ts"));
    await scan(context);
    expect(root(dashboardBody(github))).toEqual({
      version: 1,
      scanSha: SHA,
      scanRun: "4242",
      scanAt: "2026-09-21T06:00:00.000Z",
      ...FULL_AT_OLD,
    });
  });

  test("the full-scan keys are carried through as they stand, also when they are not what a scan writes", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"));
    withRootLine(
      scanned,
      `<!-- sluiceway:dashboard v="1" scan-sha="${OLD}" scan-run="1" scan-at="x" full-scan-at="2026-01-02T03:04:05Z" full-scan-run="77" later-key="kept%20out" -->`,
    );
    await scan(scanned.context);
    expect(dashboardBody(scanned.github).split("\n")[0]).toBe(
      `<!-- sluiceway:dashboard v="1" scan-sha="${SHA}" scan-run="4242" scan-at="2026-09-21T06:00:00.000Z" full-scan-at="2026-01-02T03:04:05Z" full-scan-run="77" -->`,
    );
    expect(dashboardBody(scanned.github)).toContain("last full scan 2026-01-02 03:04 UTC");
  });

  test("a dashboard without full-scan keys gets none from a narrowed scan", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"));
    withRootLine(scanned, `<!-- sluiceway:dashboard v="1" scan-sha="${OLD}" -->`);
    await scan(scanned.context);
    expect(dashboardBody(scanned.github).split("\n")[0]).toBe(
      `<!-- sluiceway:dashboard v="1" scan-sha="${SHA}" scan-run="4242" scan-at="2026-09-21T06:00:00.000Z" -->`,
    );
  });

  test("a narrowed scan in which every stack claims a file previews every stack, so it records a full scan", async () => {
    const { context, github, log } = await pushed(TABLE, ahead("app/a", "network/b", "site/c"));
    await scan(context);
    expect(root(dashboardBody(github))).toMatchObject({
      fullScanAt: "2026-09-21T06:00:00.000Z",
      fullScanRun: "4242",
    });
    expect(log.lines).toContain("This is a narrowed scan: it previews 4 of 4 stacks.");
  });

  test("the display cache keys, a tick, a failure line and a row of an unknown state ride along byte for byte, and the header counts them", async () => {
    const big = Array.from({ length: 40 }, (_, index) => change(`bucket-${index}`, "delete"));
    const table: Table = {
      ...TABLE,
      "app:prod": pending("app:prod", ...big),
      "later:prod": inSync("later:prod"),
    };
    // A small target, so the first scan shortens app:prod.
    const scanned = await pushed(table, ahead("site/index.ts"));
    const first = harness(tableAdapter(table), { sha: OLD, runId: OLD_RUN });
    first.context.limits = { body: { target: 3000 } };
    await scan({ ...first.context, github: scanned.github, root: scanned.context.root });
    let body = dashboardBody(scanned.github);
    expect(body).toMatch(
      /stack="app:prod" state="pending" hash="[0-9a-f]{16}" destroys="40" deletes="40" shortened="\d"/,
    );

    // What only later writers put on a row: a tick, a failure line with its
    // key, and a state this version does not know.
    body = body
      .replace("- [ ] **network:dev**", "- [x] **network:dev**")
      .replace(
        /(stack="network:dev" state="pending" hash="[0-9a-f]{16}" destroys="1" deletes="1")/,
        '$1 failed="true"',
      )
      .replace(
        'stack="later:prod" state="in-sync"',
        'stack="later:prod" state="drifted" drift="3"',
      );
    scanned.github.editBody(1, body);
    // The tick rides along because the run its edit started is still on its
    // way. Without one it is an orphan tick, and the scan sweeps it (0025).
    scanned.github.seedIssuesRun("sluiceway.yml", { id: "71", completed: false });
    const before = rowTexts(body);

    await scan(scanned.context);

    const after = dashboardBody(scanned.github);
    expect(scanned.adapter.previewed).toEqual(["site:prod"]);
    for (const carried of ["app:prod", "later:prod", "network:dev", "network:prod"]) {
      expect(rowTexts(after)[carried]).toBe(before[carried] as string);
    }
    expect(after).toContain("- [x] **network:dev**");
    expect(after).toContain(
      "🟡&nbsp;**2 pending** · ⚪&nbsp;0 deploying · ⚪&nbsp;0 preview failed · 🟢&nbsp;2 in sync · :warning: **2 pending stacks destroy resources** · 🔴&nbsp;1 failed deploy",
    );
    expect(after).toContain("so 1 of 2 pending rows is shortened");
  });

  test("the rows a narrowed scan writes are its own: a redacted dashboard stays redacted row by row", async () => {
    const { context, github } = await pushed(TABLE, ahead("site/index.ts"), {
      config: "dashboard:\n  redact: true\n",
      next: { "site:prod": pending("site:prod", change("page")) },
    });
    await scan(context);
    expect(dashboardBody(github)).not.toContain("page");
    expect(dashboardBody(github)).not.toContain("logs");
  });
});

describe("the size budget on a narrowed scan (record 0028)", () => {
  const many = (name: string, count: number) =>
    Array.from({ length: count }, (_, index) => change(`${name}-${index}`));

  test("it aims at the hard limit, not at the target, and shortens only its own rows", async () => {
    const table: Table = {
      "a:prod": pending("a:prod", ...many("x", 30)),
      "b:prod": inSync("b:prod"),
    };
    const scanned = await pushed(table, ahead("b/index.ts"), {
      next: { "b:prod": pending("b:prod", ...many("y", 30)) },
    });
    // Over the target with both rows in full, inside the limit.
    const limits = { body: { target: 3000, limit: 60_000 } };
    await scan({ ...scanned.context, limits });
    const rows = parseDashboard(dashboardBody(scanned.github)).rows;
    expect(rows).toContainEqual(expect.objectContaining({ stackId: "b:prod", shortened: 0 }));
    expect(rowTexts(dashboardBody(scanned.github))["a:prod"]).toBe(
      rowTexts(scanned.before)["a:prod"] as string,
    );
  });

  test("a body that does not fit with carried rows in it makes the scan a full one, which can shorten every row", async () => {
    const table: Table = {
      "a:prod": pending("a:prod", ...many("x", 60)),
      "b:prod": inSync("b:prod"),
    };
    const scanned = await pushed(table, ahead("b/index.ts"), {
      next: { "b:prod": pending("b:prod", ...many("y", 60)) },
    });
    const full = scanned.before.length;
    // The old body fits, and the old row of a:prod in full plus any row of
    // b:prod does not.
    const limits = { body: { target: full + 200, limit: full + 200 } };

    await scan({ ...scanned.context, limits });

    expect(scanned.adapter.previewed).toEqual(["b:prod", "a:prod"]);
    expect(scanned.log.lines).toContain(
      "This scan falls back to a full scan: the body does not fit in one issue with 1 row carried through, and only a fresh row can be shortened. Previewing the other 1 stack now.",
    );
    const body = dashboardBody(scanned.github);
    expect(body.length).toBeLessThanOrEqual(full + 200);
    expect(parseDashboard(body).rows.map((row) => row.known && row.shortened > 0)).toEqual([
      true,
      true,
    ]);
    expect(root(body)?.fullScanRun).toBe("4242");
  });

  test("a body that does not fit with every row fresh fails the scan and leaves the old body", async () => {
    const table: Table = {
      "a:prod": pending("a:prod", ...many("x", 60)),
      "b:prod": inSync("b:prod"),
    };
    const scanned = await pushed(table, ahead("b/index.ts"), {
      next: { "b:prod": pending("b:prod", ...many("y", 60)) },
    });
    await expect(
      scan({ ...scanned.context, limits: { body: { target: 500, limit: 500 } } }),
    ).rejects.toThrow("The dashboard does not fit in one issue.");
    expect(dashboardBody(scanned.github)).toBe(scanned.before);
  });
});

describe("the job of a narrowed scan", () => {
  test("says which stacks it previews and why, keeps the timing lines, and says what it carried", async () => {
    const { context, log, github } = await pushed(
      TABLE,
      ahead("network/Pulumi.yaml", "network/index.ts", "network/x.ts"),
    );
    await scan({ ...context, concurrency: 1 });
    const size = dashboardBody(github).length.toLocaleString("en-US");
    expect(log.lines).toEqual([
      "Found 4 stacks.",
      "3 files changed between 1111111, the commit of the last scan, and 0123456.",
      "This is a narrowed scan: it previews 2 of 4 stacks and keeps the rows of the other 2 as they are.",
      "network:dev is previewed: it claims network/Pulumi.yaml and 2 more changed files.",
      "network:prod is previewed: it claims network/Pulumi.yaml and 2 more changed files.",
      "Previewing 2 stacks with a pool of 1 and a time limit of 10 minutes for each preview.",
      "Previewed network:dev in 0.5 s: pending",
      "Previewed network:prod in 0.5 s: in sync",
      "Previewed 2 stacks in 2.5 s with a pool of 1. Added up, the previews took 1.0 s. The slowest was network:dev with 0.5 s.",
      "Wrote the preview pages of 1 stack on 0123456: 1 created, 0 updated.",
      `🟡 Wrote the dashboard: https://github.com/acme/infra/issues/1 (${size} of 65,536 characters).`,
      "Carried 2 rows through as they were, for the stacks this scan did not preview.",
    ]);
  });

  test("the summary and the groups of the log hold the previewed stacks only", async () => {
    const { context, log } = await pushed(TABLE, ahead("site/index.ts"));
    await scan(context);
    expect(log.groups.map((group) => group.title)).toEqual(["site:prod"]);
    expect(log.summaries).toEqual([expect.stringContaining("1 stack previewed")]);
    expect(log.summaries[0]).not.toContain("network:dev");
  });

  test("every preview of the scan failing turns the job red after the write, and the carried rows stay", async () => {
    const scanned = await pushed(TABLE, ahead("network/Pulumi.yaml"), {
      next: { "network:dev": failing(), "network:prod": failing() },
    });
    await expect(scan(scanned.context)).rejects.toThrow("Every preview failed (2 of 2).");
    const rows = parseDashboard(dashboardBody(scanned.github)).rows;
    expect(rows.map((row) => row.state)).toEqual([
      "pending",
      "preview-failed",
      "preview-failed",
      "in-sync",
    ]);
  });

  test("one failing preview of one leaves the job green", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"), {
      next: { "site:prod": failing() },
    });
    await scan(scanned.context);
    expect(scanned.log.warnings).toHaveLength(1);
  });

  test("costs ten requests: the first read, the comparison, the preview page of its pending stack, the write loop with its list and its late read of the deployment records, and the read of the pinned issues", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"), {
      next: { "site:prod": pending("site:prod", change("page")) },
    });
    const before = scanned.github.requests.length;
    await scan(scanned.context);
    expect(scanned.github.requests.slice(before)).toEqual([
      "listIssues",
      "compareCommits",
      // Record 0050: the commit's check runs, and the one page.
      "listCheckRuns",
      "createCheckRun",
      "listIssues",
      "getIssue",
      "listNewestDeployments",
      "updateIssueBody",
      "getIssue",
      // Slice 5.9: the dashboard is pinned already, so no pin.
      "listPinnedIssues",
    ]);
  });
});

// Slice 2.22, onboarding log hurdle 5: a push that fell back to a full scan
// because of files no stack claims says so in its summary, with the block the
// check mode prints (record 0042), ready to paste.
describe("the summary of a scan that fell back because of unclaimed files", () => {
  function section(summary: string): string {
    const from = summary.indexOf("### Why this was a full scan");
    return from < 0 ? "" : summary.slice(from);
  }

  test("names the files and holds the ready-to-paste scan.unrelated block", async () => {
    const scanned = await pushed(
      TABLE,
      ahead("README.md", "docs/setup.txt", "docs/diagram.png", "package.json", "site/index.ts"),
      { config: 'scan:\n  unrelated:\n    - "**/*.txt"\n' },
    );
    await scan(scanned.context);
    expect(scanned.adapter.previewed).toEqual(ALL);
    const summary = scanned.log.summaries.at(-1) ?? "";
    expect(section(summary)).toBe(
      [
        "### Why this was a full scan",
        "This push fell back to a full scan, because no stack claims 2 of the changed files: docs/diagram.png, package.json. A push that changes one of them previews every stack.",
        "A file that some stacks read belongs under the inputs of those stacks in sluiceway.yaml. A file that no stack reads can be listed under scan.unrelated.",
        "The block below keeps what scan.unrelated has and adds globs for the files that look like docs and tooling. Sluiceway does not decide this for you: leave out any glob that covers a file one of your programs reads.",
        ["```yaml", "scan:", "  unrelated:", '    - "**/*.txt"', '    - "docs/**"', "```"].join(
          "\n",
        ),
      ].join("\n\n") + "\n",
    );
  });

  test("offers no block when no file looks like docs or tooling, and never sluiceway.yaml", async () => {
    const scanned = await pushed(TABLE, ahead("package.json", "sluiceway.yaml"));
    await scan(scanned.context);
    const summary = section(scanned.log.summaries.at(-1) ?? "");
    expect(summary).toContain("no stack claims 1 of the changed files: package.json.");
    expect(summary).not.toContain("```yaml");
    expect(summary).not.toContain("sluiceway.yaml:");
  });

  test("names at most twenty files and points at the job log for the rest", async () => {
    const files = Array.from({ length: 23 }, (_, i) => `notes/n${String(i).padStart(2, "0")}.txt`);
    const scanned = await pushed(TABLE, ahead(...files));
    await scan(scanned.context);
    const summary = section(scanned.log.summaries.at(-1) ?? "");
    expect(summary).toContain("notes/n19.txt, and 3 more files. The job log lists them all.");
    expect(summary).not.toContain("notes/n20.txt");
  });
});

describe("no full scan section in the summary", () => {
  test("of a narrowed scan", async () => {
    const scanned = await pushed(TABLE, ahead("site/index.ts"));
    await scan(scanned.context);
    expect(scanned.log.summaries.at(-1)).not.toContain("### Why this was a full scan");
  });

  test("of a full scan for another reason, or a change of sluiceway.yaml alone", async () => {
    for (const comparison of [
      { status: "diverged", files: [{ path: "README.md" }] },
      ahead("sluiceway.yaml"),
    ]) {
      const scanned = await pushed(TABLE, comparison);
      await scan(scanned.context);
      expect(scanned.adapter.previewed).toEqual(ALL);
      expect(scanned.log.summaries.at(-1)).not.toContain("### Why this was a full scan");
    }
  });
});
