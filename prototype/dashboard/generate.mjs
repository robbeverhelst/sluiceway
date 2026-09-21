#!/usr/bin/env node
// PROTOTYPE, throwaway. Not the renderer. Do not import from here.
//
// Question (map ticket "What does the dashboard look like with 51 real stacks?"):
// what should the dashboard issue body look like at real scale, where the decision
// records leave room, and what does truncation look like when the body is over budget?
//
// The "UI" here is a GitHub issue body, so a variant is a separate issue instead of a
// route with a search param. Everything the records already fix is the same in every
// variant: root marker first, row marker at the end of the first line, closing marker as
// the last line of the block, no reference on the checkbox line, plain logins, no values,
// destroys first, fixed failure reasons, rows sorted by stack id inside a section.
//
// Run:
//   node prototype/dashboard/generate.mjs                 write out/*.md and print sizes
//   node prototype/dashboard/generate.mjs --post          also create one lab issue per body
//   node prototype/dashboard/generate.mjs --update a=12,b=13,c=14,stress=15
//                                                         rewrite existing lab issues
//
// Issues only ever go to the PRIVATE lab repo below.

import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LAB_REPO = "sluiceway/behavior-lab";
const HARD_LIMIT = 65536; // characters, safe on every write path
const BUDGET = 58000; // target, Renovate's headroom figure
const BYTE_LIMIT = 262144;

const REPO_URL = "https://github.com/example-org/infra";
const SCAN_SHA = "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c";
const SCAN_RUN = "17034455121";
const runUrl = (id) => `${REPO_URL}/actions/runs/${id}`;
const SUMMARY_URL = runUrl(SCAN_RUN);

// ---------------------------------------------------------------- made-up data

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");

const ch = (op, type, name, changedKeys = [], replaceKeys = [], tracking) => ({
  op, type, name, changedKeys, replaceKeys, tracking,
});

const K8S_KINDS = [
  ["kubernetes:apps/v1:Deployment", ["spec"]],
  ["kubernetes:core/v1:ConfigMap", ["data"]],
  ["kubernetes:core/v1:Service", ["spec"]],
  ["kubernetes:networking.k8s.io/v1:Ingress", ["spec", "metadata"]],
  ["kubernetes:rbac.authorization.k8s.io/v1:ClusterRole", ["rules"]],
  ["kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition", ["spec"]],
  ["kubernetes:core/v1:ServiceAccount", ["metadata"]],
];
const NAMES = ["controller", "webhook", "metrics", "admission", "default-backend", "config", "leader-election", "tcp-services", "udp-services", "internal", "external", "public", "private", "canary"];

function bulk(n, prefix, ops) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const [type, keys] = pick(K8S_KINDS);
    const op = pick(ops);
    out.push(ch(op, type, `${prefix}-${pick(NAMES)}-${i + 1}`, op === "update" ? keys : []));
  }
  return out;
}

const pr = (n, by) => ({ pr: n, by });
const push = (sha, by) => ({ sha, by });

// Pending stacks. `attr` follows record 0026.
const PENDING = [
  {
    id: "apps/api:prod",
    changes: [ch("update", "kubernetes:apps/v1:Deployment", "api", ["spec"])],
    attr: { named: [pr(5, "alice"), pr(4, "renovate[bot]")], more: 0, outside: 0 },
  },
  {
    id: "apps/web:prod",
    changes: [
      ch("create", "kubernetes:core/v1:ConfigMap", "web-feature-flags"),
      ch("create", "kubernetes:autoscaling/v2:HorizontalPodAutoscaler", "web"),
      ch("update", "kubernetes:apps/v1:Deployment", "web", ["spec", "metadata"]),
    ],
    attr: { named: [pr(418, "carol")], more: 0, outside: 2 },
  },
  {
    id: "data/postgres:prod",
    changes: [
      ch("replace", "aws:rds/instance:Instance", "main", ["engineVersion", "instanceClass", "storageType"], ["engineVersion", "storageType"]),
      ch("update", "aws:rds/parameterGroup:ParameterGroup", "main", ["parameters"]),
      ch("update", "aws:cloudwatch/metricAlarm:MetricAlarm", "main-cpu", ["dimensions"]),
    ],
    attr: { named: [pr(431, "bob")], more: 0, outside: 0 },
  },
  {
    id: "apps/legacy-worker:prod",
    changes: [
      ch("delete", "kubernetes:apps/v1:Deployment", "legacy-worker"),
      ch("delete", "kubernetes:core/v1:Service", "legacy-worker"),
      ch("delete", "aws:sqs/queue:Queue", "legacy-jobs"),
      ch("none", "aws:iam/role:Role", "legacy-worker", [], [], "forget"),
    ],
    attr: { named: [pr(427, "dave")], more: 0, outside: 0 },
  },
  {
    id: "storage/buckets:prod",
    changes: [
      ch("replace", "aws:s3/bucket:Bucket", "uploads", ["bucket", "tags"], ["bucket"]),
      ch("delete", "aws:s3/bucketPolicy:BucketPolicy", "uploads-public-read"),
      ch("update", "aws:s3/bucketLifecycleConfiguration:BucketLifecycleConfiguration", "logs", ["rules"]),
      ch("none", "aws:s3/bucket:Bucket", "archive", [], [], "move"),
      ch("create", "aws:s3/bucketVersioning:BucketVersioning", "uploads"),
    ],
    attr: { named: [pr(433, "alice"), pr(429, "alice"), push("3fa9c1e", "bob")], more: 0, outside: 1 },
  },
  {
    id: "platform/ingress:prod",
    changes: [
      ch("replace", "kubernetes:batch/v1:Job", "ingress-admission-patch", ["spec"], ["spec"]),
      ...bulk(45, "ingress", ["update", "update", "update", "create"]),
    ],
    attr: {
      named: [pr(436, "renovate[bot]"), pr(434, "carol"), pr(430, "renovate[bot]"), pr(425, "bob"), pr(421, "renovate[bot]")],
      more: 2,
      outside: 4,
    },
  },
  {
    id: "monitoring/dashboards:prod",
    changes: bulk(120, "dashboard", ["update", "update", "create"]),
    attr: { named: [pr(435, "erin")], more: 0, outside: 0 },
  },
  {
    id: "infra/dns:prod",
    changes: [
      ch("none", "cloudflare:index/record:Record", "status-page", [], [], "import"),
      ch("none", "cloudflare:index/record:Record", "docs", [], [], "import"),
      ch("update", "cloudflare:index/record:Record", "api", ["ttl"]),
    ],
    attr: { named: [], more: 0, outside: 4 },
  },
  {
    id: "apps/billing:staging",
    changes: bulk(9, "billing", ["create"]),
    attr: { never: true },
  },
  {
    id: "apps/search:prod",
    changes: [
      ch("update", "kubernetes:apps/v1:StatefulSet", "search", ["spec"]),
      ch("update", "kubernetes:core/v1:ConfigMap", "search-config", ["data"]),
    ],
    attr: { named: [pr(432, "carol"), pr(426, "carol")], more: 0, outside: 0 },
    failure: { reason: "the change moved since the tick", by: "alice", at: "2026-09-21 08:52 UTC", run: "17034120077" },
  },
  {
    id: "apps/notifications:prod",
    changes: [
      ch("update", "kubernetes:apps/v1:Deployment", "notifications", ["spec"]),
      ch("create", "kubernetes:batch/v1:CronJob", "digest"),
    ],
    attr: { named: [pr(428, "dave")], more: 0, outside: 3, earlier: true },
    orphan: true,
  },
];

const DEPLOYING = [
  { id: "platform/cert-manager:prod", by: "carol", run: "17034501999", attr: { named: [pr(437, "renovate[bot]")], more: 0, outside: 0 }, counts: "~4" },
  { id: "apps/web:staging", by: "alice", run: "17034502113", attr: { named: [pr(418, "carol")], more: 0, outside: 2 }, counts: "+2 ~1", waiting: true },
];

const PREVIEW_FAILED = [
  { id: "monitoring/loki:prod", reason: "the preview timed out after 10 minutes" },
  { id: "data/redis:staging", reason: "the tool exited with an error (exit code 255)" },
];

const IN_SYNC_IDS = `
apps/admin:prod apps/admin:staging apps/api:staging apps/auth:prod apps/auth:staging apps/billing:prod
apps/docs:prod apps/notifications:staging apps/search:staging apps/worker:prod apps/worker:staging
data/kafka:prod data/kafka:staging data/postgres:staging data/redis:prod data/warehouse:prod
infra/bastion:prod infra/cluster:prod infra/cluster:staging infra/dns:staging infra/iam:prod
infra/kms:prod infra/network:prod infra/network:staging infra/registry:prod infra/vpn:prod
monitoring/alertmanager:prod monitoring/grafana:prod monitoring/prometheus:prod monitoring/prometheus:staging
monitoring/tempo:prod monitoring/uptime:prod platform/argo-workflows:prod platform/cert-manager:staging
platform/external-dns:prod platform/external-secrets:prod platform/ingress:staging platform/karpenter:prod
platform/policy:prod platform/service-mesh:prod storage/backups:prod storage/buckets:staging storage/cdn:prod
`.trim().split(/\s+/);

const IN_SYNC_FAILURE = {
  "data/warehouse:prod": { reason: "the run ended without reporting a result", by: "bob", at: "2026-09-19 16:03 UTC", run: "17019884120" },
};

const RECENT = [
  ["apps/auth:prod", "alice", "2026-09-21 09:41 UTC", "17034388102"],
  ["apps/auth:staging", "alice", "2026-09-21 09:12 UTC", "17034120455"],
  ["platform/external-dns:prod", "carol", "2026-09-20 17:30 UTC", "17029910331"],
  ["infra/network:staging", "bob", "2026-09-20 14:02 UTC", "17027745120"],
  ["apps/worker:prod", "dave", "2026-09-19 11:47 UTC", "17018803377"],
  ["apps/worker:staging", "dave", "2026-09-19 11:20 UTC", "17018650912"],
  ["monitoring/grafana:prod", "erin", "2026-09-18 15:55 UTC", "17009921140"],
  ["storage/cdn:prod", "bob", "2026-09-18 10:08 UTC", "17007112054"],
];

// Stress fixture: the same dashboard plus enough big pending stacks to go over budget.
function stressPending() {
  const extra = [];
  for (let i = 1; i <= 34; i++) {
    const env = i % 2 ? "prod" : "staging";
    const changes = bulk(30 + Math.floor(rnd() * 50), `svc${i}`, ["update", "update", "create"]);
    if (i % 6 === 0) changes.push(ch("delete", "aws:sqs/queue:Queue", `svc${i}-dead-letter`));
    if (i % 9 === 0) changes.push(ch("replace", "aws:elasticache/cluster:Cluster", `svc${i}-cache`, ["nodeType", "engineVersion"], ["nodeType"]));
    if (i % 12 === 0) for (let d = 1; d <= 450; d++) changes.push(ch("delete", "aws:route53/record:Record", `tenant-${d}`));
    extra.push({
      id: `services/svc-${String(i).padStart(2, "0")}:${env}`,
      changes,
      attr: { named: [pr(440 + i, pick(["alice", "bob", "carol"])), pr(400 + i, "renovate[bot]"), pr(380 + i, "dave")], more: i % 3, outside: 4 },
    });
  }
  return extra;
}

// ---------------------------------------------------------------- shared pieces (fixed by the records)

const enc = (v) => v.replace(/[%"<>\x00-\x20\x7f]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
const openMarker = (id, state, hash) =>
  `<!-- sluiceway:row stack="${enc(id)}" state="${state}"${hash ? ` hash="${hash}"` : ""} -->`;
const CLOSE = "  <!-- /sluiceway:row -->";

const OP_ORDER = { delete: 0, replace: 1 };
const sortChanges = (cs) =>
  [...cs].sort((a, b) => (OP_ORDER[a.op] ?? 2) - (OP_ORDER[b.op] ?? 2) || (a.type + a.name).localeCompare(b.type + b.name));
const isDestroy = (c) => c.op === "replace" || c.op === "delete";

function count(cs) {
  const n = { create: 0, update: 0, replace: 0, delete: 0, tracking: 0 };
  for (const c of cs) {
    if (c.op !== "none") n[c.op]++;
    else if (c.tracking) n.tracking++;
  }
  return n;
}

// Attribution line, record 0026. `level` >= 1 cuts the named pull requests.
function attribution(attr, compareFrom, cutNames) {
  if (!attr) return null;
  if (attr.never) return "  not deployed from this dashboard yet";
  const parts = [];
  let named = attr.named, more = attr.more;
  if (cutNames) { more += named.length; named = []; }
  const names = named.map((n) => (n.pr ? `#${n.pr} by ${n.by}` : `[${n.sha}](${REPO_URL}/commit/${n.sha}) by ${n.by}`));
  if (names.length) parts.push(names.join(", "));
  if (more) parts.push(names.length ? `and ${more} more` : plural(more, "pull request"));
  if (attr.outside) parts.push(`${parts.length ? "and " : ""}${plural(attr.outside, "change")} outside this stack`);
  if (attr.earlier) parts.push("and earlier changes");
  return `  from ${parts.join(", ")} · [compare](${REPO_URL}/compare/${compareFrom}...${SCAN_SHA.slice(0, 7)})`;
}

const failureLine = (f) =>
  `  :x: last deploy failed: ${f.reason} · ticked by ${f.by} · ${f.at} · [run](${runUrl(f.run)})`;
const ORPHAN_NOTE = "  :information_source: a tick on this row was not picked up. Tick again to deploy.";

// ---------------------------------------------------------------- the three variants
//
// Each variant supplies: counts(n), destroyTag(n), details(stack, level), and a few section choices.
// Truncation level per row: 0 full, 1 attribution names cut, 2 non-destroys hidden,
// 3 nothing listed: no changes block, and the warning says how many destroys are hidden.

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function destroyWords(n, hidden) {
  const p = [];
  if (n.delete) p.push(`deletes ${n.delete}`);
  if (n.replace) p.push(`replaces ${n.replace}`);
  return p.join(", ") + (hidden ? ` (${hidden} not listed here, see the summary)` : "");
}

const hiddenLine = (n, what) => `${plural(n, what)} not shown here, see the [summary](${SUMMARY_URL})`;

const VARIANTS = {
  // A: closest to the brief. Symbol counts, fenced diff block (red and green), loose list,
  // one top level CAUTION alert above the pending list that names the destroying stacks.
  a: {
    title: "Variant A: symbol counts, diff block, one alert on top",
    counts: (n) => "`" + [`+${n.create}`, `~${n.update}`, `+-${n.replace}`, `-${n.delete}`].join(" ") + "`" + (n.tracking ? ` · ${n.tracking} tracking only` : ""),
    destroyTag: (n, hidden) => ` · :warning: **${destroyWords(n, hidden)}**`,
    topAlert: true,
    details(shown, hiddenPlain, hiddenDestroys) {
      const sym = { create: "+ ", update: "~ ", replace: "-+", delete: "- ", none: "  " };
      const lines = shown.map((c) => {
        const keys = c.changedKeys.length
          ? "  [" + c.changedKeys.map((k) => (c.replaceKeys.includes(k) ? `${k} (forces replace)` : k)).join(", ") + "]"
          : "";
        const word = c.op === "none" ? c.tracking : c.op + (c.tracking ? `, ${c.tracking}` : "");
        return `  ${sym[c.op]} ${word.padEnd(8)} ${c.type}  ${c.name}${keys}`;
      });
      const out = ["  <details><summary>Show changes</summary>", "", "  ```diff", ...lines, "  ```"];
      if (hiddenDestroys) out.push("", "  " + hiddenLine(hiddenDestroys, "delete or replace"));
      if (hiddenPlain) out.push("", "  " + hiddenLine(hiddenPlain, "more change"));
      out.push("", "  </details>");
      return out;
    },
    loose: true,
    recentAsTable: true,
  },

  // B: destroys are never folded away. Word counts, destroy lines sit open under the row,
  // everything else behind the fold as plain HTML lines. Tight list, no top alert.
  b: {
    title: "Variant B: word counts, destroys outside the fold, tight rows",
    counts: (n) =>
      [n.create && plural(n.create, "create"), n.update && plural(n.update, "update"), n.replace && `**${plural(n.replace, "replace")}**`, n.delete && `**${plural(n.delete, "delete")}**`, n.tracking && `${n.tracking} tracking only`]
        .filter(Boolean).join(", "),
    destroyTag: () => "",
    topAlert: false,
    details(shown, hiddenPlain, hiddenDestroys, n) {
      const out = [];
      const line = (c) => {
        const forced = c.replaceKeys.length ? ` · forced by ${c.replaceKeys.map((k) => `<code>${k}</code>`).join(", ")}` : "";
        const rest = c.changedKeys.filter((k) => !c.replaceKeys.includes(k));
        const keys = rest.length ? ` · ${c.op === "replace" ? "also changes " : ""}${rest.map((k) => `<code>${k}</code>`).join(", ")}` : "";
        const word = c.op === "none" ? c.tracking : c.op + (c.tracking ? ` + ${c.tracking}` : "");
        return `<kbd>${isDestroy(c) ? word.toUpperCase() : word}</kbd> <code>${c.type}</code> <b>${c.name}</b>${forced}${keys}`;
      };
      for (const c of shown.filter(isDestroy)) out.push(`  :warning: ${line(c)}`);
      if (hiddenDestroys) out.push(`  :warning: **${destroyWords(n)}, not listed here, see the [summary](${SUMMARY_URL})**`);
      const plain = shown.filter((c) => !isDestroy(c));
      if (plain.length || hiddenPlain) {
        out.push(`  <details><summary>${plural(plain.length + hiddenPlain, n.delete || n.replace ? "other change" : "change")}</summary>`);
        plain.forEach((c) => out.push(`  ${line(c)}<br>`));
        if (hiddenPlain) out.push(`  ${plural(hiddenPlain, "change")} not shown here, see the <a href="${SUMMARY_URL}">summary</a>`);
        out.push("  </details>");
      }
      return out;
    },
    loose: false,
    recentAsTable: false,
  },

  // C: word counts, a quoted warning inside the row, changes as a table behind the fold.
  c: {
    title: "Variant C: quoted warning in the row, changes as a table",
    counts: (n) =>
      [n.create && `${n.create} to create`, n.update && `${n.update} to update`, n.replace && `${n.replace} to replace`, n.delete && `${n.delete} to delete`, n.tracking && `${n.tracking} tracking only`]
        .filter(Boolean).join(" · "),
    destroyTag: () => "",
    topAlert: false,
    quote: (n, hidden) => ["", `  > :warning: **Deploying this stack ${destroyWords(n, hidden)}.**`, ""],
    details(shown, hiddenPlain, hiddenDestroys) {
      const rows = shown.map((c) => {
        const word = c.op === "none" ? c.tracking : c.op + (c.tracking ? ` + ${c.tracking}` : "");
        const keys = c.changedKeys.map((k) => (c.replaceKeys.includes(k) ? `**\`${k}\`** (forces replace)` : `\`${k}\``)).join(", ");
        return `  | ${isDestroy(c) ? `:warning: **${word}**` : word} | \`${c.type}\` | ${c.name} | ${keys} |`;
      });
      const out = ["  <details><summary>Show changes</summary>", "", "  | | Type | Name | Changed properties |", "  |---|---|---|---|", ...rows];
      if (hiddenDestroys) out.push("", "  " + hiddenLine(hiddenDestroys, "delete or replace"));
      if (hiddenPlain) out.push("", "  " + hiddenLine(hiddenPlain, "more change"));
      out.push("", "  </details>");
      return out;
    },
    loose: true,
    recentAsTable: false,
  },
};

// ---------------------------------------------------------------- rows

function pendingRow(v, s, level) {
  const n = count(s.changes);
  const sorted = sortChanges(s.changes);
  const destroys = sorted.filter(isDestroy), plain = sorted.filter((c) => !isDestroy(c));
  const shown = level >= 3 ? [] : level >= 2 ? destroys : sorted;
  const hiddenPlain = level >= 2 ? plain.length : 0;
  const hiddenDestroys = level >= 3 ? destroys.length : 0;
  const hasDestroy = destroys.length > 0;

  const first =
    `- [ ] **${s.id}** · ${v.counts(n)}${hasDestroy ? v.destroyTag(n, hiddenDestroys) : ""} · [preview](${SUMMARY_URL}) ` +
    openMarker(s.id, "pending", s.hash);
  const out = [first];
  const a = attribution(s.attr, s.from, level >= 1);
  if (a) out.push(a);
  if (s.failure) out.push(failureLine(s.failure));
  if (s.orphan) out.push(ORPHAN_NOTE);
  if (hasDestroy && v.quote) out.push(...v.quote(n, hiddenDestroys));
  if (level >= 3) {
    if (!v.quote && !v.topAlert && hasDestroy) out.push(`  :warning: **${destroyWords(n, hiddenDestroys)}**`);
    if (v.loose) out.push("");
    out.push(`  Changes not listed here, see the [summary](${SUMMARY_URL})`);
  } else {
    out.push(...v.details(shown, hiddenPlain, hiddenDestroys, n));
  }
  out.push(CLOSE);
  return out.join("\n");
}

function deployingRow(v, s) {
  const out = [
    `- **${s.id}** · deploying${s.waiting ? ", waiting for a reviewer" : ""} · ticked by ${s.by} · [run](${runUrl(s.run)}) ${openMarker(s.id, "deploying")}`,
    attribution(s.attr, hex(7), false),
    CLOSE,
  ];
  return out.join("\n");
}

const previewFailedRow = (s) =>
  [`- **${s.id}** · preview failed: ${s.reason} · [run](${SUMMARY_URL}) ${openMarker(s.id, "preview-failed")}`, CLOSE].join("\n");

function inSyncRow(id) {
  const out = [`- ${id} ${openMarker(id, "in-sync")}`];
  if (IN_SYNC_FAILURE[id]) out.push(failureLine(IN_SYNC_FAILURE[id]));
  out.push(CLOSE);
  return out.join("\n");
}

// ---------------------------------------------------------------- body

function body(v, pending, levels, note) {
  const sep = v.loose ? "\n\n" : "\n";
  const destroyers = pending.filter((s) => s.changes.some(isDestroy));
  const failing = pending.filter((s) => s.failure).length + Object.keys(IN_SYNC_FAILURE).length;
  const out = [];

  out.push(
    `<!-- sluiceway:dashboard v="1" scan-sha="${SCAN_SHA}" scan-run="${SCAN_RUN}" scan-at="2026-09-21T10:02:41Z" full-scan-at="2026-09-21T06:00:12Z" full-scan-run="17031200455" -->`,
    "",
    "<picture>",
    '  <source media="(prefers-color-scheme: dark)" srcset="https://placehold.co/880x140/0d1117/8b949e/png?text=mascot+placeholder+(dark,+state:+destroys+pending)">',
    '  <img alt="Mascot placeholder" width="440" src="https://placehold.co/880x140/f6f8fa/57606a/png?text=mascot+placeholder+(light,+state:+destroys+pending)">',
    "</picture>",
    "",
    `**${pending.length} pending** · ${DEPLOYING.length} deploying · ${PREVIEW_FAILED.length} preview failed · ${IN_SYNC_IDS.length} in sync` +
      (destroyers.length ? ` · :warning: **${destroyers.length} pending ${destroyers.length === 1 ? "stack destroys" : "stacks destroy"} resources**` : "") +
      (failing ? ` · ${plural(failing, "failed deploy")}` : ""),
    "",
    `Scanned [\`${SCAN_SHA.slice(0, 7)}\`](${REPO_URL}/commit/${SCAN_SHA}) on 2026-09-21 10:02 UTC · [run](${SUMMARY_URL}) · <sub>last full scan 2026-09-21 06:00 UTC</sub>`,
    "",
  );
  if (note) out.push(note, "");

  out.push("## Pending", "", "Tick a box to deploy that stack exactly as its row shows it.", "");
  if (v.topAlert && destroyers.length) {
    out.push(
      "> [!CAUTION]",
      `> ${plural(destroyers.length, "pending stack")} would destroy resources: ` +
        destroyers.map((s) => `**${s.id}** (${destroyWords(count(s.changes))})`).join(", ") + ".",
      "",
    );
  }
  out.push(pending.map((s, i) => pendingRow(v, s, levels[i])).join(sep), "");

  out.push("## Deploying", "", DEPLOYING.map((s) => deployingRow(v, s)).join(sep), "");
  out.push("## Preview failed", "", "These stacks could not be previewed, so they cannot be deployed from here until a scan succeeds.", "", PREVIEW_FAILED.map(previewFailedRow).join(sep), "");

  out.push(
    `<details><summary><b>In sync (${IN_SYNC_IDS.length})</b></summary>`, "",
    IN_SYNC_IDS.map(inSyncRow).join("\n"), "", "</details>", "",
  );

  out.push("## Recently deployed", "");
  if (v.recentAsTable) {
    out.push("| Stack | Ticked by | When | |", "|---|---|---|---|", ...RECENT.map(([id, by, at, run]) => `| ${id} | ${by} | ${at} | [run](${runUrl(run)}) |`));
  } else {
    out.push(...RECENT.map(([id, by, at, run]) => `- ${id} · ticked by ${by} · ${at} · [run](${runUrl(run)})`));
  }
  out.push("", "---", "", "- [ ] Rescan all stacks <!-- sluiceway:rescan -->", "", `<sub>[Sluiceway](https://github.com/sluiceway/sluiceway) v0.0.0-prototype · [docs](https://github.com/sluiceway/sluiceway#readme)</sub>`, "");
  return out.join("\n");
}

// Size budget, records 0024 and 0026: names first, then plain changes, then destroys, then the block.
// Within a level the biggest rows give way first.
function fit(v, pending) {
  const levels = pending.map(() => 0);
  const steps = [];
  const size = () => body(v, pending, levels, "x".repeat(400)).length;
  for (let level = 1; level <= 3 && size() > BUDGET; level++) {
    const order = pending
      .map((s, i) => ({ i, len: pendingRow(v, s, levels[i]).length, destroys: s.changes.some(isDestroy) }))
      .sort((a, b) => b.len - a.len);
    let touched = 0;
    for (const { i } of order) {
      if (size() <= BUDGET) break;
      levels[i] = level;
      touched++;
    }
    steps.push(`level ${level}: ${touched} rows`);
  }
  // Give back: cutting a few huge rows often makes room to show the small ones in full again.
  const bySmallest = pending.map((s, i) => ({ i, len: pendingRow(v, s, 0).length })).sort((a, b) => a.len - b.len);
  for (const { i } of bySmallest) {
    const was = levels[i];
    for (let l = 0; l < was; l++) {
      levels[i] = l;
      if (size() <= BUDGET) break;
      levels[i] = was;
    }
  }
  return { levels, steps };
}

// ---------------------------------------------------------------- main

const args = process.argv.slice(2);
const outDir = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(outDir, { recursive: true });

const withIds = (list) => list.map((s) => ({ ...s, hash: hex(16), from: hex(7) })).sort((a, b) => a.id.localeCompare(b.id));
const normal = withIds(PENDING);
const stress = withIds([...PENDING, ...stressPending()]);

const jobs = [
  ...Object.entries(VARIANTS).map(([key, v]) => ({ key, v, pending: normal, title: `[dashboard prototype] ${v.title}` })),
  { key: "stress", v: VARIANTS.a, pending: stress, title: "[dashboard prototype] Over budget: what truncation looks like (variant A rows)" },
];

const LEVEL_WORDS = ["shown in full", "pull request names cut", "only deletes and replaces listed", "no changes listed"];
const results = [];
for (const job of jobs) {
  const raw = body(job.v, job.pending, job.pending.map(() => 0)).length;
  const { levels, steps } = fit(job.v, job.pending);
  const tally = LEVEL_WORDS.map((w, l) => [w, levels.filter((x) => x === l).length]).filter(([, c]) => c);
  const note = steps.length
    ? `> [!NOTE]\n> This dashboard is too large for one issue, so ${levels.filter(Boolean).length} of ${levels.length} pending rows are shortened. The [summary](${SUMMARY_URL}) of the scan shows every change. Deletes and replaces are the last thing to be cut.`
    : null;
  const text = body(job.v, job.pending, levels, note);
  if (text.length > HARD_LIMIT) throw new Error(`${job.key}: still over the hard limit after truncation`);
  writeFileSync(join(outDir, `${job.key}.md`), text);
  results.push({
    key: job.key,
    stacks: job.pending.length + DEPLOYING.length + PREVIEW_FAILED.length + IN_SYNC_IDS.length,
    "untruncated chars": raw,
    "final chars": text.length,
    "% of 65,536": ((text.length / HARD_LIMIT) * 100).toFixed(1),
    "utf-8 bytes": Buffer.byteLength(text),
    rows: tally.map(([w, c]) => `${c} ${w}`).join("; "),
  });
  job.text = text;
}
console.table(results);

const update = Object.fromEntries((args.find((a) => a.startsWith("a=") || a.includes("=")) ?? "").split(",").filter(Boolean).map((p) => p.split("=")));
if (args.includes("--post") || args.includes("--update")) {
  for (const job of jobs) {
    const file = join(outDir, `${job.key}.md`);
    const n = update[job.key];
    const cmd = n
      ? ["issue", "edit", n, "--repo", LAB_REPO, "--title", job.title, "--body-file", file]
      : ["issue", "create", "--repo", LAB_REPO, "--title", job.title, "--body-file", file];
    console.log(job.key, execFileSync("gh", cmd, { encoding: "utf8" }).trim());
  }
}
