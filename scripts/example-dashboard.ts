// The example dashboard (slice 5.24, record 0088): a whole dashboard body,
// made from made-up rows by the real renderer, so nobody keeps a copy by
// hand. `bun run example` writes it to EXAMPLE_FILE, where another site
// fetches it raw at a release tag, and into the README, made fit for it. A
// test fails when either one is not what this file gives.
//
// Made up, not a real repo's body: no real names, no values, nothing to
// redact, and a body that shows every section at once, which no real repo
// holds on one day. The attribution, the shipped lines and the destroy alert
// are worked out by the core from a made-up history, as a scan would.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { attributor, type CommitWalk, type WalkedCommit } from "../src/core/attribution.ts";
import type { IgnoredStack } from "../src/core/config.ts";
import type { Change, Op, ShownValue, Tracking } from "../src/core/diff.ts";
import { diffHash } from "../src/core/diff-hash.ts";
import type { OutsideDeploy } from "../src/core/outside-deploy.ts";
import { type BodyLayout, type RecentDeploy, renderBody, rowBlock } from "../src/render/body.ts";
import { renderBulkLine } from "../src/render/bulk-box.ts";
import { type BulkFacts, parseDashboard, type RootFacts } from "../src/render/marker.ts";
import { type MergeRow, mergeBlock } from "../src/render/merge-row.ts";
import type { DeployingRow, DriftRow, InSyncRow, PendingRow, Row } from "../src/render/row.ts";
import { type WaitingLine, waitingBlock } from "../src/render/waiting-line.ts";

// Where the body is committed. `assets/` is already what other pages fetch
// raw at an exact tag: the header pictures (record 0033).
export const EXAMPLE_FILE = "assets/example-dashboard.md";

const ROOT = resolve(import.meta.dir, "..");

// The version of this checkout, as the footer of a dashboard names it and as
// its pictures are served (build plan, section 3). release-please bumps it in
// the release pull request, and the release workflow runs `bun run example`
// on that branch, so a release tag holds an example that names itself.
export function exampleActionRef(): string {
  const { version } = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
    version: string;
  };
  return `v${version}`;
}

const REPO_URL = "https://github.com/example-org/infra";
const SCAN_RUN = "17034455121";
const SCAN_RUN_URL = `${REPO_URL}/actions/runs/${SCAN_RUN}`;
const runUrl = (run: string) => `${REPO_URL}/actions/runs/${run}`;
// A preview page is a check run (record 0050).
const pageUrl = (id: number) => `${REPO_URL}/runs/${id}`;

// A made-up commit id that looks like one and never changes.
const sha = (label: string) => createHash("sha1").update(`example ${label}`).digest("hex");

// The history, newest first as GitHub lists it: one pull request or direct
// push per commit, each on the parent below it.
const HISTORY: [label: string, pr: number | undefined, author: string, files: string[]][] = [
  ["web flags", 516, "carol", ["apps/web/src/flags.ts"]],
  ["network routes", undefined, "gina", ["infra/network/index.ts"]],
  ["billing monitor", 514, "erin", ["apps/billing/index.ts"]],
  ["auth sessions", 513, "alice", ["apps/auth/index.ts"]],
  ["api image", 512, "alice", ["apps/api/index.ts"]],
  ["billing deps", 511, "renovate[bot]", ["apps/billing/package.json"]],
  ["web layout", 510, "bob", ["apps/web/src/app.ts"]],
  ["worker queue", 509, "bob", ["apps/worker/index.ts"]],
  ["retire legacy", 498, "dave", ["apps/legacy-worker/Pulumi.prod.yaml"]],
  ["lockfile", 497, "frank", ["pnpm-lock.yaml"]],
  ["base", 490, "carol", ["README.md"]],
];

const TITLES: Record<string, string> = {
  "web flags": "Feature flags for the new checkout",
  "billing monitor": "Scrape the billing service",
  "auth sessions": "Shorter session lifetime",
  "api image": "Ship the new api build",
  "billing deps": "Update dependency @pulumi/kubernetes",
  "web layout": "New landing layout",
  "worker queue": "Move jobs to the shared queue",
  "retire legacy": "Retire the legacy worker",
  lockfile: "Refresh the lockfile",
  base: "Docs",
};

const at = (label: string) => sha(label);

const WALK: CommitWalk = {
  defaultBranch: "main",
  commits: HISTORY.map(([label, pr, author, files], index): WalkedCommit => {
    const parent = HISTORY[index + 1];
    return {
      sha: at(label),
      parents: parent ? [at(parent[0])] : [],
      author,
      message: TITLES[label] ?? label,
      pullRequests:
        pr === undefined
          ? []
          : [
              {
                number: pr,
                title: TITLES[label] ?? label,
                author,
                base: "main",
                merged: true,
                changedFiles: files.length,
                files,
              },
            ],
    };
  }),
};

const SCAN_SHA = at("web flags");

const STACK_PATHS = [
  "apps/api",
  "apps/auth",
  "apps/billing",
  "apps/legacy-worker",
  "apps/web",
  "apps/worker",
  "data/postgres",
  "infra/network",
  "monitoring/grafana",
  "platform/external-dns",
  "platform/ingress-nginx",
];

const attribute = attributor({
  walk: WALK,
  pushFiles: new Map(
    HISTORY.filter(([, pr]) => pr === undefined).map(([label, , , files]) => [at(label), files]),
  ),
  stacks: STACK_PATHS.map((path) => ({ id: path, path, inputs: [] })),
  unrelated: [],
  repoUrl: REPO_URL,
  scanSha: SCAN_SHA,
});

// The attribution of a stack's row, from the commit of its last deploy. The
// claim rule is by path, so the stack id's path stands for the stack.
const from = (stackId: string, label: string) =>
  attribute(stackId.split(":")[0] ?? stackId, at(label)).lines;

function ch(
  op: Op,
  type: string,
  name: string,
  changedKeys: string[] = [],
  more: { tracking?: Tracking; replaceKeys?: string[]; values?: ShownValue[] } = {},
): Change {
  return {
    address: `${type}::${name}`,
    type,
    name,
    op,
    changedKeys,
    replaceKeys: more.replaceKeys ?? [],
    ...(more.tracking ? { tracking: more.tracking } : {}),
    ...(more.values ? { values: more.values } : {}),
  };
}

function pending(stackId: string, page: number, changes: Change[], since: string): PendingRow {
  const diff = { stackId, changes };
  return {
    state: "pending",
    diff,
    hash: diffHash(diff),
    runUrl: SCAN_RUN_URL,
    previewUrl: pageUrl(page),
    attribution: from(stackId, since),
  };
}

function drifted(stackId: string, page: number, drift: Change[]): DriftRow {
  const diff = { stackId, changes: [], drift };
  return {
    state: "drift",
    diff,
    hash: diffHash(diff),
    runUrl: SCAN_RUN_URL,
    previewUrl: pageUrl(page),
  };
}

const inSync = (stackId: string): InSyncRow => ({ state: "in-sync", stackId });

// A tick went out a few minutes before the scan: one stack deploys, and the
// one that depends on it waits for it (record 0056).
const DEPLOYING: DeployingRow[] = [
  {
    state: "deploying",
    stackId: "apps/api:prod",
    ticker: "alice",
    runUrl: runUrl("17034467330"),
    attribution: from("apps/api:prod", "billing deps"),
  },
  {
    state: "deploying",
    stackId: "apps/worker:prod",
    ticker: "alice",
    runUrl: runUrl("17034467330"),
    behind: ["apps/api:prod"],
    attribution: from("apps/worker:prod", "retire legacy"),
  },
];

const PENDING: PendingRow[] = [
  pending(
    "apps/billing:prod",
    48213301,
    [
      ch("update", "kubernetes:apps/v1:Deployment", "billing", ["spec.replicas"], {
        // A path the repo lists under `dashboard.showValues` (record 0052).
        values: [{ path: "spec.replicas", old: "2", new: "3" }],
      }),
      ch("create", "kubernetes:monitoring.coreos.com/v1:ServiceMonitor", "billing"),
    ],
    "web layout",
  ),
  pending(
    "apps/legacy-worker:prod",
    48213302,
    [
      ch("delete", "kubernetes:apps/v1:Deployment", "legacy-worker"),
      ch("delete", "kubernetes:core/v1:Service", "legacy-worker"),
      ch("delete", "aws:sqs/queue:Queue", "legacy-jobs"),
      ch("none", "aws:iam/role:Role", "legacy-worker", [], { tracking: "forget" }),
    ],
    "lockfile",
  ),
  pending(
    "apps/web:staging",
    48213303,
    [
      ch("create", "kubernetes:core/v1:ConfigMap", "web-feature-flags"),
      ch("create", "kubernetes:autoscaling/v2:HorizontalPodAutoscaler", "web"),
      ch("update", "kubernetes:apps/v1:Deployment", "web", [
        'metadata.labels["app.kubernetes.io/version"]',
        "spec.template.spec.containers[0].image",
      ]),
    ],
    "base",
  ),
  pending(
    "infra/network:prod",
    48213304,
    [
      ch("replace", "aws:ec2/subnet:Subnet", "private-b", ["cidrBlock"], {
        replaceKeys: ["cidrBlock"],
      }),
      ch("update", "aws:ec2/routeTable:RouteTable", "private", ["routes[1].natGatewayId"]),
    ],
    "billing monitor",
  ),
];

// Drift from a scheduled scan (record 0055): a setting changed by hand, and
// a record deleted outside the code, which the destroy alert names (record
// 0075).
const DRIFTED: DriftRow[] = [
  drifted("monitoring/grafana:prod", 48213305, [
    ch("update", "kubernetes:apps/v1:Deployment", "grafana", ["spec.replicas"]),
  ]),
  drifted("platform/external-dns:prod", 48213306, [
    ch("delete", "aws:route53/record:Record", "status-cname"),
  ]),
];

const IN_SYNC = [
  "apps/api:staging",
  "apps/auth:prod",
  "apps/auth:staging",
  "apps/billing:staging",
  "apps/web:prod",
  "data/postgres:prod",
  "data/postgres:staging",
  "platform/ingress-nginx:prod",
].map(inSync);

const ROWS: Row[] = [...DEPLOYING, ...PENDING, ...DRIFTED, ...IN_SYNC];

// A person ticked Repair all under the drifted rows, and `resolve` put the
// confirm box in its place (record 0083). Pending keeps its bulk box.
const CONFIRM: Extract<BulkFacts, { kind: "confirm" }> = {
  kind: "confirm",
  section: "drift",
  by: "carol",
  stacks: DRIFTED.map((row) => ({ stackId: row.diff.stackId, hash: row.hash })),
  scanRun: SCAN_RUN,
};

// A Renovate update that merges and deploys with one tick, with its branch
// preview (records 0054 and 0071), and one that waits on its checks (record
// 0081).
const MERGES: MergeRow[] = [
  {
    pr: 519,
    stackIds: ["platform/ingress-nginx:prod"],
    head: sha("renovate ingress-nginx"),
    title: "Update Helm release ingress-nginx to v4.13",
    author: "renovate[bot]",
    preview: [
      {
        stackId: "platform/ingress-nginx:prod",
        changes: [
          ch("update", "kubernetes:helm.sh/v3:Release", "ingress-nginx", ["chart.version"]),
        ],
      },
    ],
  },
];

const WAITING: WaitingLine[] = [
  {
    pr: 521,
    stackIds: ["apps/web:prod"],
    title: "Update dependency next to v15.5",
    author: "renovate[bot]",
  },
];

const utc = (iso: string) => new Date(iso);

// The trail (records 0062 and 0072): what each deploy shipped, from the
// success before it, a deploy with nothing to deploy, a drift repair, a
// failed deploy that a later one cleared (record 0076), and a deploy made
// outside the dashboard (record 0073).
const RECENT: RecentDeploy[] = [
  {
    stackId: "apps/auth:prod",
    ticker: "alice",
    at: utc("2026-09-21T09:41:07Z"),
    runUrl: runUrl("17034388102"),
    shipped: attribute.shipped("apps/auth", at("retire legacy"), at("auth sessions")),
  },
  {
    stackId: "apps/auth:staging",
    ticker: "alice",
    at: utc("2026-09-21T09:12:55Z"),
    runUrl: runUrl("17034120455"),
    result: "in-sync",
  },
  {
    stackId: "platform/ingress-nginx:prod",
    ticker: "carol",
    at: utc("2026-09-20T18:05:12Z"),
    runUrl: runUrl("17030044170"),
    result: "drift-repaired",
  },
  {
    stackId: "apps/web:prod",
    ticker: "bob",
    at: utc("2026-09-20T16:52:40Z"),
    runUrl: runUrl("17029910331"),
    shipped: attribute.shipped("apps/web", at("retire legacy"), at("web layout")),
  },
  {
    stackId: "apps/web:prod",
    ticker: "bob",
    at: utc("2026-09-20T16:40:03Z"),
    runUrl: runUrl("17029855012"),
    result: "failed",
  },
];

const OUTSIDE: OutsideDeploy[] = [
  {
    stackId: "data/postgres:prod",
    kind: "deploy",
    at: utc("2026-09-21T09:30:18Z"),
    commit: at("api image"),
  },
];

// The example as data (record 0110): everything the renderer draws the body
// from, before any setting is applied. A reader outside this repo takes it
// whole and draws the example under its own setting with `renderBody`, as
// `exampleBody` does, instead of taking it through the markers of the
// published file, which lose the made-up changes and the trail's lines.
export interface ExampleDashboard {
  root: RootFacts;
  rows: readonly Row[];
  recentlyDeployed: readonly RecentDeploy[];
  outsideDeploys: readonly OutsideDeploy[];
  repoUrl: string;
  ignored: readonly IgnoredStack[];
  merges: readonly MergeRow[];
  waiting: readonly WaitingLine[];
  // The confirm box under the drifted rows. The bulk box under the pending
  // rows needs no data: the renderer draws it from the rows.
  confirm: Extract<BulkFacts, { kind: "confirm" }>;
}

export const EXAMPLE: ExampleDashboard = {
  root: {
    scanSha: SCAN_SHA,
    scanRun: SCAN_RUN,
    scanAt: "2026-09-21T10:02:41Z",
    fullScanAt: "2026-09-21T06:00:12Z",
    fullScanRun: "17031200455",
  },
  rows: ROWS,
  recentlyDeployed: RECENT,
  outsideDeploys: OUTSIDE,
  repoUrl: REPO_URL,
  ignored: [{ stackId: "sandbox/playground:dev", reason: "a scratch stack, deployed by hand" }],
  merges: MERGES,
  waiting: WAITING,
  confirm: CONFIRM,
};

// The settings of `sluiceway.yaml` a body is drawn under. The published
// example is drawn with every default: personality on, nothing redacted,
// UTC, boxes.
export interface ExampleSettings {
  redact?: boolean | undefined;
  personality?: boolean | undefined;
  timeZone?: string | undefined;
  readOnly?: boolean | undefined;
}

// And the layout keys of `dashboard` (record 0114), each at its default when
// absent.
export type ExampleLayoutSettings = ExampleSettings & BodyLayout;

// The body as a scan writes it into the dashboard issue.
export function exampleBody(
  actionRef = exampleActionRef(),
  settings: ExampleLayoutSettings = {},
): string {
  const { redact, timeZone, readOnly, personality: withPersonality, ...layout } = settings;
  const personality = withPersonality ?? true;
  const rowOptions = {
    redact,
    readOnly,
    timeZone,
    actionRef: personality ? actionRef : undefined,
    detail: layout.pendingDetail,
  };
  return renderBody({
    root: EXAMPLE.root,
    rows: EXAMPLE.rows.map((row) => rowBlock(row, rowOptions)),
    recentlyDeployed: EXAMPLE.recentlyDeployed,
    outsideDeploys: EXAMPLE.outsideDeploys,
    repoUrl: EXAMPLE.repoUrl,
    actionRef,
    personality,
    timeZone,
    readOnly,
    ignored: EXAMPLE.ignored,
    merges: EXAMPLE.merges.map((row) => mergeBlock(row, { redact })),
    waiting: EXAMPLE.waiting.map((line) => waitingBlock(line, { redact })),
    bulk: {
      on: !readOnly,
      live: parseDashboard(renderBulkLine({ ...EXAMPLE.confirm, ticked: false })).bulk,
    },
    layout,
  });
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// The body made fit for the README: the hidden markers go, every heading
// goes one level down under "What it looks like", and `#N` links to the
// example repo instead of this repo's own pull requests. The header picture
// and the counts line stay open, so a reader who never clicks still sees the
// crates and the signs; the rows sit in a closed <details> (record 0097).
export function readmeExample(actionRef = exampleActionRef()): string {
  const readme = exampleBody(actionRef)
    .replace(/^<!-- sluiceway:dashboard [^\n]*-->\n\n/, "")
    .replace(/^ *<!-- \/sluiceway:row -->\n/gm, "")
    .replace(/ <!-- sluiceway:[^\n]*?-->/g, "")
    .replace(/^## /gm, "### ")
    .replace(/#(\d+) by /g, `[#$1](${REPO_URL}/pull/$1) by `);
  const fold = readme.indexOf("\n### ");
  if (fold === -1) throw new Error("The example has no section under its counts line.");
  return [
    readme.slice(0, fold).trimEnd(),
    "",
    "<details>",
    `<summary><b>Open the example dashboard</b>: all ${plural(ROWS.length, "stack")} and every section</summary>`,
    "",
    withHardBreaks(readme.slice(fold + 1)),
    "",
    "</details>",
  ].join("\n");
}

// An issue body renders every line break as a break, and a README does not
// (record 0097). So a line of a row that goes on in an indented line ends in
// `<br>`, as the issue shows it: the `from` line under a row, and each
// `:warning:` line on its own. A line that already ends in `<br>`, and the
// fold of a row's changes, need none.
export function withHardBreaks(markdown: string): string {
  const lines = markdown.split("\n");
  const block = (line: string) => /^\s*<\/?details[\s>]/.test(line);
  return lines
    .map((line, index) => {
      const next = lines[index + 1] ?? "";
      const goesOn = /^ {2}\S/.test(next) && !block(next);
      return goesOn && line.trim() !== "" && !line.endsWith("<br>") && !block(line)
        ? `${line}<br>`
        : line;
    })
    .join("\n");
}

// Where the example sits in the README: from the first centred paragraph
// under "What it looks like", the example's header picture, to the end of
// its <details>. Undefined when the README has none.
export function readmeExampleSpan(readme: string): { start: number; end: number } | undefined {
  const section = readme.indexOf("\n## What it looks like\n");
  const start = section === -1 ? -1 : readme.indexOf('\n<p align="center">', section) + 1;
  const end = start <= 0 ? -1 : readme.indexOf("\n</details>\n\n## How it works", start);
  return start <= 0 || end === -1 ? undefined : { start, end: end + "\n</details>".length };
}

// The README with its example replaced, and nothing else changed.
export function withReadmeExample(readme: string, example: string): string {
  const span = readmeExampleSpan(readme);
  if (span === undefined) throw new Error("README.md has no example dashboard.");
  return `${readme.slice(0, span.start)}${example}${readme.slice(span.end)}`;
}

if (import.meta.main) {
  writeFileSync(resolve(ROOT, EXAMPLE_FILE), `${exampleBody()}\n`);
  const readme = resolve(ROOT, "README.md");
  writeFileSync(readme, withReadmeExample(readFileSync(readme, "utf8"), readmeExample()));
  console.log(`Wrote ${EXAMPLE_FILE} and the example in README.md`);
}
