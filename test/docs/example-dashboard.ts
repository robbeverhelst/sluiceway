import type { Change, Op, Tracking } from "../../src/core/diff.ts";
import { diffHash } from "../../src/core/diff-hash.ts";
import { type RecentDeploy, renderBody, rowBlock } from "../../src/render/body.ts";
import type { InSyncRow, PendingRow, Row } from "../../src/render/row.ts";

// The example dashboard of the README, made from made-up rows by the real
// renderer. The header can show one state, and bad news wins (record 0031),
// so the example is a pending dashboard: that is the one picture that shows
// both the crate count (record 0047) and the destroy sign (record 0043).
// Regenerate the README's block with:
//   bun -e 'import { exampleDashboard } from "./test/docs/example-dashboard.ts"; console.log(exampleDashboard())'

// The release whose pictures the example names (build plan, section 3).
export const EXAMPLE_ACTION_REF = "v0.1.1";

const REPO_URL = "https://github.com/example-org/infra";
const SCAN_SHA = "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c";
const SCAN_RUN_URL = `${REPO_URL}/actions/runs/17034455121`;

function ch(
  op: Op,
  type: string,
  name: string,
  changedKeys: string[] = [],
  tracking?: Tracking,
): Change {
  const change: Change = {
    address: `${type}::${name}`,
    type,
    name,
    op,
    changedKeys,
    replaceKeys: [],
  };
  if (tracking) change.tracking = tracking;
  return change;
}

// An attribution line in the core's format (record 0026), placed by the row
// as it is.
function pending(stackId: string, changes: Change[], from: string, by: string): PendingRow {
  const diff = { stackId, changes };
  const line = `from ${by} · [compare](${REPO_URL}/compare/${from}...${SCAN_SHA.slice(0, 7)})`;
  return {
    state: "pending",
    diff,
    hash: diffHash(diff),
    runUrl: SCAN_RUN_URL,
    attribution: { full: line, counted: line },
  };
}

const inSync = (stackId: string): InSyncRow => ({ state: "in-sync", stackId });

const ROWS: Row[] = [
  pending(
    "apps/api:prod",
    [
      ch("update", "kubernetes:apps/v1:Deployment", "api", [
        "spec.template.spec.containers[0].image",
      ]),
    ],
    "4193607",
    "#5 by alice, #4 by renovate[bot]",
  ),
  pending(
    "apps/legacy-worker:prod",
    [
      ch("delete", "kubernetes:apps/v1:Deployment", "legacy-worker"),
      ch("delete", "kubernetes:core/v1:Service", "legacy-worker"),
      ch("delete", "aws:sqs/queue:Queue", "legacy-jobs"),
      ch("none", "aws:iam/role:Role", "legacy-worker", [], "forget"),
    ],
    "284fd2d",
    "#427 by dave",
  ),
  pending(
    "apps/web:prod",
    [
      ch("create", "kubernetes:core/v1:ConfigMap", "web-feature-flags"),
      ch("create", "kubernetes:autoscaling/v2:HorizontalPodAutoscaler", "web"),
      ch("update", "kubernetes:apps/v1:Deployment", "web", [
        'metadata.labels["app.kubernetes.io/version"]',
        "spec.replicas",
      ]),
    ],
    "1dfd7ad",
    "#418 by carol, and 2 changes outside this stack",
  ),
  pending(
    "platform/ingress-nginx:prod",
    [
      ch("update", "kubernetes:helm.sh/v3:Release", "ingress-nginx", [
        "values.controller.image.tag",
        "values.controller.replicaCount",
      ]),
    ],
    "876b5b7",
    "#437 by renovate[bot]",
  ),
  ...[
    "apps/api:staging",
    "apps/auth:prod",
    "apps/auth:staging",
    "apps/web:staging",
    "data/postgres:prod",
    "data/postgres:staging",
    "infra/network:prod",
    "monitoring/grafana:prod",
    "platform/external-dns:prod",
  ].map(inSync),
];

const RECENT: RecentDeploy[] = [
  ["apps/auth:prod", "alice", "2026-09-21T09:41:07Z", "17034388102"],
  ["apps/auth:staging", "alice", "2026-09-21T09:12:55Z", "17034120455"],
  ["platform/external-dns:prod", "carol", "2026-09-20T17:30:00Z", "17029910331"],
].map(([stackId = "", ticker = "", at = "", run = ""]) => ({
  stackId,
  ticker,
  at: new Date(at),
  runUrl: `${REPO_URL}/actions/runs/${run}`,
}));

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// The body as a dashboard issue gets it, made fit for the README: the hidden
// markers go, every heading goes one level down under "What it looks like",
// and `#N` links to the example repo instead of this repo's own pull
// requests. It sits in a closed <details>, with a line that says what is in it.
export function exampleDashboard(): string {
  const body = renderBody({
    root: {
      scanSha: SCAN_SHA,
      scanRun: "17034455121",
      scanAt: "2026-09-21T10:02:41Z",
      fullScanAt: "2026-09-21T06:00:12Z",
      fullScanRun: "17031200455",
    },
    rows: ROWS.map((row) => rowBlock(row)),
    recentlyDeployed: RECENT,
    repoUrl: REPO_URL,
    actionRef: EXAMPLE_ACTION_REF,
    personality: true,
  });
  const readme = body
    .replace(/^<!-- sluiceway:dashboard [^\n]*-->\n\n/, "")
    .replace(/^ *<!-- \/sluiceway:row -->\n/gm, "")
    .replace(/ <!-- sluiceway:[^\n]*?-->/g, "")
    .replace(/^## /gm, "### ")
    .replace(/#(\d+) by /g, `[#$1](${REPO_URL}/pull/$1) by `);

  const pendingRows = ROWS.filter((row): row is PendingRow => row.state === "pending");
  const destroying = pendingRows.filter((row) =>
    row.diff.changes.some((change) => change.op === "delete" || change.op === "replace"),
  ).length;
  const summary = `${plural(ROWS.length, "stack")}, ${pendingRows.length} pending, ${destroying === 1 ? "one of them" : `${destroying} of them`} deleting resources`;
  return [
    "<details>",
    `<summary><b>Open the example dashboard</b>: ${summary}</summary>`,
    "",
    readme,
    "",
    "</details>",
  ].join("\n");
}
