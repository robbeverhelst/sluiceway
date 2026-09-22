// The made-up dashboards the look of a row was judged on (records 0027 to
// 0029), as data: 58 stacks (11 pending, 2 deploying, 2 preview failures, 43
// in sync), and the same dashboard with 42 more large pending stacks, which is
// 100 stacks and far over the size budget. Everything is generated from one
// fixed seed, so the rows are the same bytes on every run.

import type { Change, Op, Tracking } from "../../src/core/diff.ts";
import { diffHash } from "../../src/core/diff-hash.ts";
import type {
  AttributionLines,
  DeployingRow,
  FailureLine,
  InSyncRow,
  PendingRow,
  PreviewFailedRow,
  Row,
} from "../../src/render/row.ts";

const REPO_URL = "https://github.com/example-org/infra";
const SCAN_SHA = "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c";
const runUrl = (id: string) => `${REPO_URL}/actions/runs/${id}`;
export const SCAN_RUN_URL = runUrl("17034455121");

// A small linear congruential generator, so nothing here depends on the
// platform's random numbers.
function generator(seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  return { next, pick };
}

function ch(
  op: Op,
  type: string,
  name: string,
  changedKeys: string[] = [],
  replaceKeys: string[] = [],
  tracking?: Tracking,
): Change {
  const change: Change = { address: `${type}::${name}`, type, name, op, changedKeys, replaceKeys };
  if (tracking) change.tracking = tracking;
  return change;
}

const KINDS: readonly (readonly [type: string, keys: string[]])[] = [
  ["kubernetes:apps/v1:Deployment", ["spec"]],
  ["kubernetes:core/v1:ConfigMap", ["data"]],
  ["kubernetes:core/v1:Service", ["spec"]],
  ["kubernetes:networking.k8s.io/v1:Ingress", ["spec", "metadata"]],
  ["kubernetes:rbac.authorization.k8s.io/v1:ClusterRole", ["rules"]],
  ["kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition", ["spec"]],
  ["kubernetes:core/v1:ServiceAccount", ["metadata"]],
];
const NAMES = [
  "controller",
  "webhook",
  "metrics",
  "admission",
  "default-backend",
  "config",
  "leader-election",
  "tcp-services",
  "udp-services",
  "internal",
  "external",
  "public",
  "private",
  "canary",
] as const;

// The attribution line is the core's to render (record 0026). These are
// hand-made lines in its format, which a row places as they are.
interface Attribution {
  named?: string[];
  more?: number;
  outside?: number;
  earlier?: boolean;
  never?: boolean;
}
const pr = (number: number, by: string) => `#${number} by ${by}`;
const push = (sha: string, by: string) => `[${sha}](${REPO_URL}/commit/${sha}) by ${by}`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function attribution(attr: Attribution, from: string): AttributionLines {
  if (attr.never) {
    const line = "not deployed from this dashboard yet";
    return { full: line, counted: line };
  }
  const line = (named: string[], more: number) => {
    const parts: string[] = [];
    if (named.length > 0) parts.push(named.join(", "));
    if (more > 0) parts.push(named.length > 0 ? `and ${more} more` : plural(more, "pull request"));
    if (attr.outside) {
      parts.push(
        `${parts.length > 0 ? "and " : ""}${plural(attr.outside, "change")} outside this stack`,
      );
    }
    if (attr.earlier) parts.push("and earlier changes");
    return `from ${parts.join(", ")} · [compare](${REPO_URL}/compare/${from}...${SCAN_SHA.slice(0, 7)})`;
  };
  const named = attr.named ?? [];
  return { full: line(named, attr.more ?? 0), counted: line([], (attr.more ?? 0) + named.length) };
}

function pending(
  stackId: string,
  changes: Change[],
  attr: Attribution,
  from: string,
  rest: Pick<PendingRow, "failure" | "orphanTick"> = {},
): PendingRow {
  const diff = { stackId, changes };
  return {
    state: "pending",
    diff,
    hash: diffHash(diff),
    runUrl: SCAN_RUN_URL,
    attribution: attribution(attr, from),
    ...rest,
  };
}

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
`
  .trim()
  .split(/\s+/);

function build(extraPending: number): Row[] {
  const { next, pick } = generator(42);
  const hex = (length: number) =>
    Array.from({ length }, () => "0123456789abcdef"[Math.floor(next() * 16)]).join("");

  const bulk = (count: number, prefix: string, ops: readonly Op[]): Change[] =>
    Array.from({ length: count }, (_, index) => {
      const [type, keys] = pick(KINDS);
      const op = pick(ops);
      return ch(op, type, `${prefix}-${pick(NAMES)}-${index + 1}`, op === "update" ? keys : []);
    });

  const moved: FailureLine = {
    reason: "the change moved since the tick",
    ticker: "alice",
    at: new Date("2026-09-21T08:52:10Z"),
    runUrl: runUrl("17034120077"),
  };

  const pendingRows: PendingRow[] = [
    pending(
      "apps/api:prod",
      [ch("update", "kubernetes:apps/v1:Deployment", "api", ["spec"])],
      { named: [pr(5, "alice"), pr(4, "renovate[bot]")] },
      hex(7),
    ),
    pending(
      "apps/web:prod",
      [
        ch("create", "kubernetes:core/v1:ConfigMap", "web-feature-flags"),
        ch("create", "kubernetes:autoscaling/v2:HorizontalPodAutoscaler", "web"),
        ch("update", "kubernetes:apps/v1:Deployment", "web", ["spec", "metadata"]),
      ],
      { named: [pr(418, "carol")], outside: 2 },
      hex(7),
    ),
    pending(
      "data/postgres:prod",
      [
        ch(
          "replace",
          "aws:rds/instance:Instance",
          "main",
          ["engineVersion", "instanceClass", "storageType"],
          ["engineVersion", "storageType"],
        ),
        ch("update", "aws:rds/parameterGroup:ParameterGroup", "main", ["parameters"]),
        ch("update", "aws:cloudwatch/metricAlarm:MetricAlarm", "main-cpu", ["dimensions"]),
      ],
      { named: [pr(431, "bob")] },
      hex(7),
    ),
    pending(
      "apps/legacy-worker:prod",
      [
        ch("delete", "kubernetes:apps/v1:Deployment", "legacy-worker"),
        ch("delete", "kubernetes:core/v1:Service", "legacy-worker"),
        ch("delete", "aws:sqs/queue:Queue", "legacy-jobs"),
        ch("none", "aws:iam/role:Role", "legacy-worker", [], [], "forget"),
      ],
      { named: [pr(427, "dave")] },
      hex(7),
    ),
    pending(
      "storage/buckets:prod",
      [
        ch("replace", "aws:s3/bucket:Bucket", "uploads", ["bucket", "tags"], ["bucket"]),
        ch("delete", "aws:s3/bucketPolicy:BucketPolicy", "uploads-public-read"),
        ch("update", "aws:s3/bucketLifecycleConfiguration:BucketLifecycleConfiguration", "logs", [
          "rules",
        ]),
        ch("none", "aws:s3/bucket:Bucket", "archive", [], [], "move"),
        ch("create", "aws:s3/bucketVersioning:BucketVersioning", "uploads"),
      ],
      { named: [pr(433, "alice"), pr(429, "alice"), push("3fa9c1e", "bob")], outside: 1 },
      hex(7),
    ),
    pending(
      "platform/ingress:prod",
      [
        ch("replace", "kubernetes:batch/v1:Job", "ingress-admission-patch", ["spec"], ["spec"]),
        ...bulk(45, "ingress", ["update", "update", "update", "create"]),
      ],
      {
        named: [
          pr(436, "renovate[bot]"),
          pr(434, "carol"),
          pr(430, "renovate[bot]"),
          pr(425, "bob"),
          pr(421, "renovate[bot]"),
        ],
        more: 2,
        outside: 4,
      },
      hex(7),
    ),
    pending(
      "monitoring/dashboards:prod",
      bulk(120, "dashboard", ["update", "update", "create"]),
      { named: [pr(435, "erin")] },
      hex(7),
    ),
    pending(
      "infra/dns:prod",
      [
        ch("none", "cloudflare:index/record:Record", "status-page", [], [], "import"),
        ch("none", "cloudflare:index/record:Record", "docs", [], [], "import"),
        ch("update", "cloudflare:index/record:Record", "api", ["ttl"]),
      ],
      { outside: 4 },
      hex(7),
    ),
    pending("apps/billing:staging", bulk(9, "billing", ["create"]), { never: true }, hex(7)),
    pending(
      "apps/search:prod",
      [
        ch("update", "kubernetes:apps/v1:StatefulSet", "search", ["spec"]),
        ch("update", "kubernetes:core/v1:ConfigMap", "search-config", ["data"]),
      ],
      { named: [pr(432, "carol"), pr(426, "carol")] },
      hex(7),
      { failure: moved },
    ),
    pending(
      "apps/notifications:prod",
      [
        ch("update", "kubernetes:apps/v1:Deployment", "notifications", ["spec"]),
        ch("create", "kubernetes:batch/v1:CronJob", "digest"),
      ],
      { named: [pr(428, "dave")], outside: 3, earlier: true },
      hex(7),
      { orphanTick: true },
    ),
  ];

  // Enough large pending stacks to go far over the size budget: a delete on
  // every sixth, a replace on every ninth, a teardown of 450 on every twelfth.
  for (let i = 1; i <= extraPending; i++) {
    const changes = bulk(30 + Math.floor(next() * 50), `svc${i}`, ["update", "update", "create"]);
    if (i % 6 === 0) changes.push(ch("delete", "aws:sqs/queue:Queue", `svc${i}-dead-letter`));
    if (i % 9 === 0) {
      changes.push(
        ch(
          "replace",
          "aws:elasticache/cluster:Cluster",
          `svc${i}-cache`,
          ["nodeType", "engineVersion"],
          ["nodeType"],
        ),
      );
    }
    if (i % 12 === 0) {
      for (let d = 1; d <= 450; d++) {
        changes.push(ch("delete", "aws:route53/record:Record", `tenant-${d}`));
      }
    }
    pendingRows.push(
      pending(
        `services/svc-${String(i).padStart(2, "0")}:${i % 2 ? "prod" : "staging"}`,
        changes,
        {
          named: [
            pr(440 + i, pick(["alice", "bob", "carol"])),
            pr(400 + i, "renovate[bot]"),
            pr(380 + i, "dave"),
          ],
          more: i % 3,
          outside: 4,
        },
        hex(7),
      ),
    );
  }

  const deploying: DeployingRow[] = [
    {
      state: "deploying",
      stackId: "platform/cert-manager:prod",
      ticker: "carol",
      runUrl: runUrl("17034501999"),
      attribution: attribution({ named: [pr(437, "renovate[bot]")] }, hex(7)),
    },
    {
      state: "deploying",
      stackId: "apps/web:staging",
      ticker: "alice",
      runUrl: runUrl("17034502113"),
      waiting: true,
      attribution: attribution({ named: [pr(418, "carol")], outside: 2 }, hex(7)),
    },
  ];

  const previewFailed: PreviewFailedRow[] = [
    {
      state: "preview-failed",
      stackId: "monitoring/loki:prod",
      reason: "the preview timed out after 10 minutes",
      runUrl: SCAN_RUN_URL,
    },
    {
      state: "preview-failed",
      stackId: "data/redis:staging",
      reason: "the tool exited with an error (exit code 255)",
      runUrl: SCAN_RUN_URL,
    },
  ];

  const inSync: InSyncRow[] = IN_SYNC_IDS.map((stackId) =>
    stackId === "data/warehouse:prod"
      ? {
          state: "in-sync",
          stackId,
          failure: {
            reason: "the run ended without reporting a result",
            ticker: "bob",
            at: new Date("2026-09-19T16:03:44Z"),
            runUrl: runUrl("17019884120"),
          },
        }
      : { state: "in-sync", stackId },
  );

  return [...pendingRows, ...deploying, ...previewFailed, ...inSync];
}

export const rows58 = (): Row[] => build(0);
export const rows100 = (): Row[] => build(42);

export function stackIdOf(row: Row): string {
  return "diff" in row ? row.diff.stackId : row.stackId;
}
