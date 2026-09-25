import { describe, expect, test } from "bun:test";
import { DASHBOARD_SECTIONS } from "../../src/core/config.ts";
import {
  type BodyInput,
  type BodyLayout,
  type RecentDeploy,
  renderBody,
  rowBlock,
} from "../../src/render/body.ts";
import { fitBody } from "../../src/render/budget.ts";
import { parseDashboard, RESCAN_MARKER } from "../../src/render/marker.ts";
import type { DriftRow, FailureLine, PendingRow, Row } from "../../src/render/row.ts";

// Slice 5.51 (record 0114): the dashboard layout keys. Written out by hand
// from issue 277 and the record: the defaults draw the body of today byte for
// byte, every row block is in the body at every setting, and nothing hides a
// destroy, a preview failure or a failure line.

const REPO_URL = "https://github.com/example-org/infra";
const RUN_URL = `${REPO_URL}/actions/runs/17034455121`;

function change(op: "update" | "delete", index: number) {
  return {
    address: `address-${index}`,
    type: "random:index/randomPet:RandomPet",
    name: `pet-${index}`,
    op,
    changedKeys: op === "update" ? ["length"] : [],
    replaceKeys: [],
  };
}

function pending(stackId: string, ops: ("update" | "delete")[] = ["update"]): PendingRow {
  return {
    state: "pending",
    diff: { stackId, changes: ops.map((op, index) => change(op, index)) },
    hash: "3fa9c1e2aabbccdd",
    runUrl: RUN_URL,
    attribution: { full: "from #12 by alice", counted: "from 1 pull request" },
  };
}

function drifted(stackId: string, op: "update" | "delete", failure?: FailureLine): DriftRow {
  return {
    state: "drift",
    diff: { stackId, changes: [], drift: [change(op, 0)] },
    hash: "4be1a0c93d7e5f20",
    runUrl: RUN_URL,
    failure,
  };
}

const FAILURE: FailureLine = {
  reason: "the tool exited with an error",
  ticker: "alice",
  at: new Date("2026-09-21T08:52:00Z"),
  runUrl: RUN_URL,
};

const ROWS: Row[] = [
  { state: "deploying", stackId: "network:prod", ticker: "carol", runUrl: RUN_URL },
  pending("apps/api:prod", ["update", "delete"]),
  pending("apps/web:prod"),
  drifted("apps/cache:prod", "update"),
  drifted("apps/db:prod", "delete"),
  drifted("apps/queue:prod", "update", FAILURE),
  {
    state: "preview-failed",
    stackId: "site:prod",
    reason: "the tool exited with an error",
    runUrl: RUN_URL,
  },
  { state: "in-sync", stackId: "apps/auth:prod", failure: FAILURE },
  { state: "in-sync", stackId: "apps/jobs:prod" },
  { state: "in-sync", stackId: "apps/mail:prod" },
];

const RECENT: RecentDeploy[] = [
  {
    stackId: "apps/jobs:prod",
    ticker: "alice",
    at: new Date("2026-09-21T09:41:00Z"),
    runUrl: RUN_URL,
  },
];

function input(layout?: BodyLayout, rows: Row[] = ROWS, more: Partial<BodyInput> = {}): BodyInput {
  return {
    root: {
      scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
      scanRun: "17034455121",
      scanAt: "2026-09-21T10:02:41Z",
    },
    rows: rows.map((row) => rowBlock(row)),
    recentlyDeployed: RECENT,
    repoUrl: REPO_URL,
    actionRef: "v0.11.0",
    personality: false,
    ignored: [{ stackId: "sandbox:dev", reason: "a scratch stack" }],
    bulk: { on: true, live: [] },
    ...(layout === undefined ? {} : { layout }),
    ...more,
  };
}

const headings = (body: string) => body.split("\n").filter((line) => line.startsWith("## "));
const paragraphs = (body: string) => body.split("\n\n");
// The paragraphs of a section, from its heading to the next heading or rule.
function section(body: string, heading: string): string {
  const all = paragraphs(body);
  const start = all.indexOf(heading);
  if (start === -1) return "";
  const end = all.findIndex((one, index) => index > start && /^(## |---)/.test(one));
  return all.slice(start, end === -1 ? undefined : end).join("\n\n");
}
const block = (stackId: string) =>
  input().rows.find((row) => row.stackId === stackId)?.text ?? "missing";
// The closed fold at the end of the sections that holds the rows of a
// section that is off.
function offFold(body: string): string {
  const all = paragraphs(body);
  const start = all.findIndex((one) => /^<details><summary>\d+ stacks? in sections/.test(one));
  return start === -1 ? "" : all.slice(start, all.indexOf("</details>", start) + 1).join("\n\n");
}

const DEFAULTS: BodyLayout = {
  sections: [...DASHBOARD_SECTIONS],
  deployingSection: true,
  driftedSection: true,
  inSyncSection: "fold",
  zeroCounts: true,
  destroyAlert: "destroys",
  pendingDetail: "full",
  deployAll: true,
  repairAll: true,
  rescanBox: true,
  footer: true,
};

// Every setting the keys allow, one key at a time and all of them at once.
const SETTINGS: BodyLayout[] = [
  { sections: ["recentlyDeployed", "inSync", "previewFailed", "drifted", "pending"] },
  { deployingSection: false },
  { driftedSection: false },
  { inSyncSection: "list" },
  { inSyncSection: "off" },
  { zeroCounts: false },
  { destroyAlert: "always" },
  { pendingDetail: "compact" },
  { pendingDetail: "names" },
  { deployAll: false, repairAll: false },
  { rescanBox: false, footer: false },
  {
    sections: ["previewFailed", "pending"],
    deployingSection: false,
    driftedSection: false,
    inSyncSection: "off",
    zeroCounts: false,
    destroyAlert: "always",
    pendingDetail: "names",
    deployAll: false,
    repairAll: false,
    rescanBox: false,
    footer: false,
  },
];

describe("the defaults", () => {
  test("no layout, an empty one and every default named write the same bytes", () => {
    const today = renderBody(input());
    expect(renderBody(input({}))).toBe(today);
    expect(renderBody(input(DEFAULTS))).toBe(today);
    expect(fitBody({ ...input(DEFAULTS), rows: ROWS, carried: [] }).body).toBe(
      fitBody({ ...input(), rows: ROWS, carried: [] }).body,
    );
  });
});

describe("dashboard.sections", () => {
  test("the sections come in the order the list gives", () => {
    const body = renderBody(
      input({
        sections: [
          "recentlyDeployed",
          "inSync",
          "previewFailed",
          "drifted",
          "pending",
          "deploying",
          "updates",
        ],
      }),
    );
    expect(headings(body)).toEqual([
      "## Recently deployed",
      "## In sync",
      "## Preview failed",
      "## Drifted",
      "## Pending",
      "## Deploying",
    ]);
  });

  test("a section the list leaves out follows the ones it names, in today's order, and is not hidden", () => {
    expect(headings(renderBody(input({ sections: ["inSync", "previewFailed"] })))).toEqual([
      "## In sync",
      "## Preview failed",
      "## Deploying",
      "## Pending",
      "## Drifted",
      "## Recently deployed",
    ]);
  });

  test("the destroy alert and the deploy all box move with Pending, and repair all with Drifted", () => {
    const body = renderBody(input({ sections: ["drifted", "pending", "deploying"] }));
    const pendingPart = section(body, "## Pending");
    expect(pendingPart).toContain("> [!CAUTION]");
    expect(pendingPart).toContain("Deploy all 2 pending stacks");
    expect(section(body, "## Drifted")).toContain("Repair all 3 drifted stacks");
    expect(body.indexOf("## Drifted")).toBeLessThan(body.indexOf("## Pending"));
  });
});

describe("a section that is off", () => {
  test("Deploying off: no heading, its rows in the closed fold at the end of the sections, still counted", () => {
    const body = renderBody(input({ deployingSection: false }));
    expect(headings(body)).not.toContain("## Deploying");
    expect(offFold(body)).toBe(
      `<details><summary>1 stack in sections this dashboard does not show</summary>\n\n${block("network:prod")}\n\n</details>`,
    );
    expect(body).toContain("1 deploying");
    // The fold is the last thing above the rule.
    const all = paragraphs(body);
    expect(all[all.indexOf("---") - 1]).toBe("</details>");
    expect(all.indexOf("## Recently deployed")).toBeLessThan(all.indexOf("---"));
  });

  test("Drifted off: a row with a failure line or a resource gone stays open, and no repair all box", () => {
    const body = renderBody(input({ driftedSection: false }));
    const open = section(body, "## Drifted");
    expect(open).toContain(block("apps/db:prod"));
    expect(open).toContain(block("apps/queue:prod"));
    expect(open).not.toContain(block("apps/cache:prod"));
    expect(offFold(body)).toContain(block("apps/cache:prod"));
    expect(body).not.toContain("Repair all");
  });

  test("Drifted off with nothing that must stay: no heading at all", () => {
    const rows = ROWS.filter((row) => !["apps/db:prod", "apps/queue:prod"].includes(rowId(row)));
    const body = renderBody(input({ driftedSection: false }, rows));
    expect(headings(body)).not.toContain("## Drifted");
    expect(offFold(body)).toContain(block("apps/cache:prod"));
  });

  test("In sync as a list: every row open, the ignored stacks still folded", () => {
    const body = renderBody(input({ inSyncSection: "list" }));
    expect(section(body, "## In sync")).toBe(
      [
        "## In sync",
        [block("apps/auth:prod"), block("apps/jobs:prod"), block("apps/mail:prod")].join("\n"),
        "<details><summary>1 stack left out by ignore</summary>",
        "- sandbox:dev · a scratch stack",
        "</details>",
      ].join("\n\n"),
    );
  });

  test("In sync off: the row with a failure line stays open under its heading, the rest go to the fold, and so does the ignore fold", () => {
    const body = renderBody(input({ inSyncSection: "off" }));
    expect(section(body, "## In sync")).toBe(`## In sync\n\n${block("apps/auth:prod")}`);
    expect(offFold(body)).toBe(
      `<details><summary>2 stacks in sections this dashboard does not show</summary>\n\n${[block("apps/jobs:prod"), block("apps/mail:prod")].join("\n")}\n\n</details>`,
    );
    expect(body).not.toContain("left out by ignore");
  });

  test("several sections off share one fold, in the order of the sections", () => {
    const body = renderBody(input({ deployingSection: false, inSyncSection: "off" }));
    expect(offFold(body)).toContain(
      [block("network:prod"), block("apps/jobs:prod"), block("apps/mail:prod")].join("\n"),
    );
  });

  test("Pending and Preview failed are always there", () => {
    for (const layout of SETTINGS) {
      const body = renderBody(input(layout));
      expect(headings(body)).toContain("## Pending");
      expect(section(body, "## Preview failed")).toContain(block("site:prod"));
    }
  });
});

describe("the counts line", () => {
  test("without zero counts a 0 is left out, and the pending count stays", () => {
    const rows: Row[] = [{ state: "in-sync", stackId: "a" }];
    expect(paragraphs(renderBody(input({ zeroCounts: false }, rows)))[1]).toBe(
      "**0 pending** · 1 in sync",
    );
    expect(paragraphs(renderBody(input({}, rows)))[1]).toBe(
      "**0 pending** · 0 deploying · 0 preview failed · 1 in sync",
    );
  });
});

describe("the destroy alert", () => {
  test("always: a note when nothing is destroyed, the caution of today when something is", () => {
    const rows: Row[] = [pending("a"), { state: "in-sync", stackId: "b" }];
    const body = renderBody(input({ destroyAlert: "always" }, rows));
    expect(section(body, "## Pending")).toContain(
      "> [!NOTE]\n> No pending stack deletes or replaces resources.",
    );
    expect(renderBody(input({}, rows))).not.toContain("[!NOTE]");
    expect(renderBody(input({ destroyAlert: "always" }))).toBe(renderBody(input()));
  });

  test("is drawn at every setting while a pending stack destroys", () => {
    for (const layout of SETTINGS) {
      expect(renderBody(input(layout))).toContain(
        "> [!CAUTION]\n> 1 pending stack deletes or replaces resources: **apps/api:prod**",
      );
    }
  });
});

describe("the boxes and the foot", () => {
  test("deploy all and repair all each go with their own key", () => {
    expect(renderBody(input({ deployAll: false }))).not.toContain("Deploy all");
    expect(renderBody(input({ deployAll: false }))).toContain("Repair all 3 drifted stacks");
    expect(renderBody(input({ repairAll: false }))).not.toContain("Repair all");
    expect(renderBody(input({ repairAll: false }))).toContain("Deploy all 2 pending stacks");
  });

  test("the rescan box and the footer each go with their own key, and the rule with both", () => {
    const noRescan = renderBody(input({ rescanBox: false }));
    expect(noRescan).not.toContain(RESCAN_MARKER);
    expect(noRescan).toContain("<sub>[Sluiceway]");
    const noFooter = renderBody(input({ footer: false }));
    expect(noFooter).toContain(RESCAN_MARKER);
    expect(noFooter).not.toContain("<sub>[Sluiceway]");
    const neither = paragraphs(renderBody(input({ rescanBox: false, footer: false })));
    expect(neither).not.toContain("---");
  });

  test("rows of a state this version does not know keep the rule above them", () => {
    const unknown = parseDashboard(
      '- **x** · later <!-- sluiceway:row stack="x" state="later" -->\n  <!-- /sluiceway:row -->',
    ).rows;
    const body = renderBody({
      ...input({ rescanBox: false, footer: false }),
      rows: [...input().rows, ...unknown],
    });
    const all = paragraphs(body);
    expect(all.at(-2)).toBe("---");
  });
});

describe("at every setting", () => {
  test("every row block is in the body as it was given, so every marker is the same", () => {
    for (const layout of SETTINGS) {
      const given = input(layout)
        .rows.map((row) => row.text)
        .sort();
      const found = parseDashboard(renderBody(input(layout)))
        .rows.map((row) => row.text)
        .sort();
      expect(found).toEqual(given);
    }
  });

  test("every failure line and every delete line is outside any fold", () => {
    for (const layout of SETTINGS) {
      const { body } = fitBody({ ...input(layout), rows: ROWS, carried: [] });
      const folded = [...body.matchAll(/<details>[\s\S]*?<\/details>/g)]
        .map((m) => m[0])
        .join("\n");
      expect(body).toContain(":x: last deploy failed");
      expect(folded).not.toContain(":x: last deploy failed");
      expect(body).toContain("<kbd>DELETE</kbd>");
      expect(folded).not.toContain("<kbd>DELETE</kbd>");
    }
  });

  test("the pending detail reaches the writer's own rows through the budget", () => {
    const { body } = fitBody({ ...input({ pendingDetail: "compact" }), rows: ROWS, carried: [] });
    expect(body).not.toContain("from #12 by alice");
    expect(body).toContain("<kbd>DELETE</kbd>");
    const names = fitBody({ ...input({ pendingDetail: "names" }), rows: ROWS, carried: [] }).body;
    expect(names).toContain("- [ ] **apps/web:prod** · 1 update <!--");
  });

  // Record 0028: a body over the target shortens the biggest pending rows
  // first, and one over the hard limit is never written.
  test("the size budget still brings a large dashboard under its target", () => {
    const many: Row[] = Array.from({ length: 60 }, (_, index) =>
      pending(
        `apps/service-${String(index).padStart(2, "0")}:prod`,
        Array.from({ length: 40 }, (_, at) => (at === 0 ? "delete" : "update")),
      ),
    );
    for (const layout of SETTINGS) {
      const fitted = fitBody({ ...input(layout, []), rows: [...ROWS, ...many], carried: [] });
      expect(fitted.fits).toBe(true);
      expect(fitted.size).toBeLessThanOrEqual(58_000);
      expect(fitted.rows).toHaveLength(ROWS.length + many.length);
    }
  });
});

function rowId(row: Row): string {
  return row.state === "pending" || row.state === "drift" ? row.diff.stackId : row.stackId;
}
