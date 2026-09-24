import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Change } from "../../src/core/diff.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  applyResultFile,
  applyResultSchema,
  dashboardCounts,
  resultFileJsonSchema,
  scanResultFile,
  scanResultSchema,
} from "../../src/render/result-file.ts";
import type { SummaryStack } from "../../src/render/summary.ts";

// The result file of record 0041: what the summary holds, as JSON, for a
// workflow step that sends or charts it. No value (record 0021) and none of
// the tool's words (record 0022), because the renderer is handed neither.

const RUN = "https://github.com/example-org/infra/actions/runs/7";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const DASHBOARD = "https://github.com/example-org/infra/issues/1";

function change(op: Change["op"], type: string, name: string, rest: Partial<Change> = {}): Change {
  return { address: `${type}::${name}`, type, name, op, changedKeys: [], replaceKeys: [], ...rest };
}

const BUCKETS: SummaryStack = {
  kind: "diff",
  diff: {
    stackId: "storage/buckets:prod",
    changes: [
      change("create", "aws:s3/bucketVersioning:BucketVersioning", "uploads"),
      change("replace", "aws:s3/bucket:Bucket", "uploads", {
        changedKeys: ["tags", "bucket", "tags"],
        replaceKeys: ["bucket"],
      }),
      change("none", "aws:s3/bucket:Bucket", "archive", {
        tracking: "move",
        previousAddress: "aws:s3/bucket:Bucket::old-archive",
      }),
      change("delete", "aws:s3/bucketPolicy:BucketPolicy", "uploads-public-read"),
    ],
  },
  // Attribution joins the file as the summary shows it (record 0061).
  merges: [{ kind: "pull-request", number: 433, title: "Rename", url: "u", author: "alice" }],
};

const MISSING: SummaryStack = {
  kind: "preview-failed",
  stackId: "network:dev",
  reason: "the stack does not exist in the backend",
  ignore: "network:dev",
};

const QUIET: SummaryStack = { kind: "diff", diff: { stackId: "app:prod", changes: [] } };

describe("the result file of a scan", () => {
  test("every previewed stack in stack id order, with the dashboard it wrote", () => {
    const text = scanResultFile({
      run: RUN,
      commit: SHA,
      milliseconds: 12_345,
      dashboard: {
        url: DASHBOARD,
        changed: true,
        counts: { pending: 1, deploying: 0, previewFailed: 1, inSync: 1, failedDeploys: 0 },
      },
      stacks: [
        { stack: BUCKETS, milliseconds: 8_000 },
        { stack: MISSING, milliseconds: 1_250 },
        { stack: QUIET, milliseconds: 500 },
      ],
    });

    expect(JSON.parse(text)).toEqual({
      version: 1,
      mode: "scan",
      run: RUN,
      commit: SHA,
      seconds: 12.345,
      dashboard: {
        url: DASHBOARD,
        changed: true,
        pending: 1,
        deploying: 0,
        previewFailed: 1,
        inSync: 1,
        failedDeploys: 0,
      },
      stacks: [
        { stack: "app:prod", state: "in-sync", seconds: 0.5, counts: counts(), changes: [] },
        {
          stack: "network:dev",
          state: "preview-failed",
          seconds: 1.25,
          reason: "the stack does not exist in the backend",
          ignore: "network:dev",
        },
        {
          stack: "storage/buckets:prod",
          state: "pending",
          seconds: 8,
          counts: counts({ create: 1, replace: 1, delete: 1, trackingOnly: 1 }),
          // Destroys first, as everywhere (record 0024).
          changes: [
            {
              type: "aws:s3/bucketPolicy:BucketPolicy",
              name: "uploads-public-read",
              op: "delete",
              changedKeys: [],
              replaceKeys: [],
            },
            {
              type: "aws:s3/bucket:Bucket",
              name: "uploads",
              op: "replace",
              changedKeys: ["bucket", "tags"],
              replaceKeys: ["bucket"],
            },
            {
              type: "aws:s3/bucket:Bucket",
              name: "archive",
              op: "none",
              tracking: "move",
              changedKeys: [],
              replaceKeys: [],
            },
            {
              type: "aws:s3/bucketVersioning:BucketVersioning",
              name: "uploads",
              op: "create",
              changedKeys: [],
              replaceKeys: [],
            },
          ],
          attribution: [
            { kind: "pull-request", number: 433, title: "Rename", url: "u", author: "alice" },
          ],
        },
      ],
    });
    expect(text.endsWith("}\n")).toBe(true);
    expect(scanResultSchema.safeParse(JSON.parse(text)).success).toBe(true);
  });

  test("a scan that wrote no dashboard says so", () => {
    const text = scanResultFile({ run: RUN, commit: SHA, milliseconds: 0, stacks: [] });

    expect(JSON.parse(text)).toMatchObject({ dashboard: null, stacks: [] });
  });

  test("no address: only what the summary can show", () => {
    const text = scanResultFile({
      run: RUN,
      commit: SHA,
      milliseconds: 0,
      stacks: [{ stack: BUCKETS, milliseconds: 0 }],
    });

    for (const word of ["::", "old-archive"]) expect(text).not.toContain(word);
  });

  // Record 0061: the pull requests and direct pushes the summary lists for a
  // stack, newest first, with the first line of a push's message.
  test("attribution, as the summary lists it", () => {
    const stack: SummaryStack = {
      kind: "diff",
      diff: { stackId: "app:prod", changes: [change("update", "random:x", "a")] },
      merges: [
        { kind: "pull-request", number: 12, title: "Bump the chart", url: "https://x/pull/12" },
        {
          kind: "push",
          sha: SHA,
          message: "Hotfix the tag\n\nA longer body.",
          url: `https://x/commit/${SHA}`,
          author: "bob",
        },
      ],
    };
    const text = scanResultFile({
      run: RUN,
      commit: SHA,
      milliseconds: 0,
      stacks: [{ stack, milliseconds: 0 }],
    });

    expect(JSON.parse(text).stacks[0].attribution).toEqual([
      { kind: "pull-request", number: 12, title: "Bump the chart", url: "https://x/pull/12" },
      {
        kind: "push",
        commit: SHA,
        message: "Hotfix the tag",
        url: `https://x/commit/${SHA}`,
        author: "bob",
      },
    ]);
    expect(scanResultSchema.safeParse(JSON.parse(text)).success).toBe(true);
  });

  test("no attribution key when the lookup failed, an empty list when it found nothing", () => {
    const of = (merges: Extract<SummaryStack, { kind: "diff" }>["merges"]) =>
      JSON.parse(
        scanResultFile({
          run: RUN,
          commit: SHA,
          milliseconds: 0,
          stacks: [
            {
              stack: { kind: "diff", diff: { stackId: "a", changes: [] }, merges },
              milliseconds: 0,
            },
          ],
        }),
      ).stacks[0];
    expect(of(undefined)).not.toHaveProperty("attribution");
    expect(of([]).attribution).toEqual([]);
  });

  // Record 0046: a step that reads the file gets what the summary shows,
  // every path whole, and not what a row shortens.
  test("keys are property paths, every one of them and whole", () => {
    const paths = Array.from(
      { length: 12 },
      (_, index) =>
        `values.controller.runnerScaleSets[${index + 10}].template.spec.containers[0].resources.limits.memory`,
    );
    const text = scanResultFile({
      run: RUN,
      commit: SHA,
      milliseconds: 0,
      stacks: [
        {
          stack: {
            kind: "diff",
            diff: {
              stackId: "apps/arc:prod",
              changes: [
                change("update", "kubernetes:helm.sh/v3:Release", "arc", { changedKeys: paths }),
              ],
            },
          },
          milliseconds: 0,
        },
      ],
    });

    expect(JSON.parse(text).stacks[0].changes[0].changedKeys).toEqual(paths);
  });

  test("the same input gives the same bytes", () => {
    const input = {
      run: RUN,
      commit: SHA,
      milliseconds: 3,
      stacks: [
        { stack: QUIET, milliseconds: 1 },
        { stack: BUCKETS, milliseconds: 2 },
      ],
    };
    expect(scanResultFile(input)).toBe(scanResultFile(input));
  });
});

// Record 0055: a stack with drift says so, with the drift in the same shape
// as its changes. The key is added, so the version stays 1.
describe("drift in the result file of a scan", () => {
  const gone = change("delete", "local:index/file:File", "notes");
  const stacks: { stack: SummaryStack; milliseconds: number }[] = [
    {
      stack: { kind: "diff", diff: { stackId: "a:prod", changes: [], drift: [gone] } },
      milliseconds: 1,
    },
    {
      stack: {
        kind: "diff",
        diff: {
          stackId: "b:prod",
          changes: [change("create", "random:Pet", "pet")],
          drift: [gone],
        },
      },
      milliseconds: 1,
    },
  ];
  const file = JSON.parse(scanResultFile({ run: RUN, commit: SHA, milliseconds: 1, stacks }));

  test("a stack with drift only is in the state drift, with its drift listed", () => {
    expect(file.stacks[0]).toMatchObject({
      stack: "a:prod",
      state: "drift",
      changes: [],
      drift: [
        {
          type: "local:index/file:File",
          name: "notes",
          op: "delete",
          changedKeys: [],
          replaceKeys: [],
        },
      ],
    });
  });

  test("a pending stack with drift stays pending and lists its drift", () => {
    expect(file.stacks[1]).toMatchObject({ state: "pending", drift: [{ name: "notes" }] });
  });

  test("it fits the schema, and a stack without drift has no drift key", () => {
    expect(scanResultSchema.safeParse(file).success).toBe(true);
    const quiet = JSON.parse(
      scanResultFile({
        run: RUN,
        commit: SHA,
        milliseconds: 1,
        stacks: [{ stack: QUIET, milliseconds: 1 }],
      }),
    );
    expect(quiet.stacks[0]).not.toHaveProperty("drift");
  });
});

describe("the result file of an apply", () => {
  test("a stack that deployed: what went out", () => {
    const text = applyResultFile({
      run: RUN,
      commit: SHA,
      deployment: 42,
      dashboardUrl: DASHBOARD,
      outcome: "deployed",
      stack: "storage/buckets:prod",
      ticker: "alice",
      milliseconds: 95_500,
      deployMilliseconds: 61_250,
      applied: { kind: "deployed", diff: QUIET.kind === "diff" ? QUIET.diff : never() },
    });

    expect(JSON.parse(text)).toEqual({
      version: 1,
      mode: "apply",
      run: RUN,
      commit: SHA,
      deployment: 42,
      dashboard: { url: DASHBOARD },
      outcome: "deployed",
      stack: "storage/buckets:prod",
      ticker: "alice",
      reason: null,
      // Record 0061: the whole job, and the tool's deploy inside it.
      seconds: 95.5,
      deploySeconds: 61.25,
      preview: { state: "in-sync", counts: counts(), changes: [] },
      after: null,
    });
    expect(applyResultSchema.safeParse(JSON.parse(text)).success).toBe(true);
  });

  test("a deploy that failed half way: the reason, what was checked and what is left", () => {
    const text = applyResultFile({
      run: RUN,
      commit: SHA,
      deployment: 42,
      outcome: "failed",
      stack: "network:dev",
      ticker: "alice",
      reason: "the tool exited with an error (exit code 1)",
      milliseconds: 1_000,
      deployMilliseconds: 500,
      applied: {
        kind: "not-deployed",
        reason: "the tool exited with an error (exit code 1)",
        checked: {
          kind: "diff",
          diff: { stackId: "network:dev", changes: [change("create", "random:x", "a")] },
        },
        after: { kind: "preview-failed", reason: "the preview timed out after 10 minutes" },
      },
    });

    expect(JSON.parse(text)).toMatchObject({
      dashboard: null,
      outcome: "failed",
      reason: "the tool exited with an error (exit code 1)",
      preview: {
        state: "pending",
        counts: counts({ create: 1 }),
        changes: [{ type: "random:x", name: "a", op: "create", changedKeys: [], replaceKeys: [] }],
      },
      after: { state: "preview-failed", reason: "the preview timed out after 10 minutes" },
    });
    expect(applyResultSchema.safeParse(JSON.parse(text)).success).toBe(true);
  });

  test("a refused re-run knows no stack and no ticker", () => {
    const text = applyResultFile({
      run: RUN,
      commit: SHA,
      deployment: 42,
      outcome: "refused",
      milliseconds: 750,
    });

    expect(JSON.parse(text)).toEqual({
      version: 1,
      mode: "apply",
      run: RUN,
      commit: SHA,
      deployment: 42,
      dashboard: null,
      outcome: "refused",
      stack: null,
      ticker: null,
      reason: null,
      seconds: 0.75,
      // The tool never deployed.
      deploySeconds: null,
      preview: null,
      after: null,
    });
  });
});

describe("the counts of the dashboard", () => {
  test("are counted from the row markers, as the counts line is", () => {
    const row = (id: string, state: string, extra = "") =>
      `- [ ] **${id}** <!-- sluiceway:row stack="${id}" state="${state}"${extra} -->\n<!-- /sluiceway:row -->`;
    const body = [
      '<!-- sluiceway:dashboard v="1" scan-sha="abc" scan-run="1" scan-at="2026-09-21T06:00:00Z" -->',
      row("a", "pending"),
      row("b", "pending", ' failed="true"'),
      row("c", "deploying"),
      row("d", "in-sync", ' failed="true"'),
      row("e", "preview-failed"),
      row("f", "flooded"),
    ].join("\n");

    expect(dashboardCounts(parseDashboard(body).rows)).toEqual({
      pending: 2,
      deploying: 1,
      previewFailed: 1,
      inSync: 1,
      failedDeploys: 2,
    });
  });
});

test("the JSON schema of the result file", () => {
  expect(JSON.stringify(resultFileJsonSchema(), null, 2)).toMatchSnapshot();
});

// Slice 5.33 (record 0096): the schema says what the file never holds, and the
// one field that may hold a value says when it does, so a field added later
// cannot quietly carry one.
test("the JSON schema says the file holds no secret, and where the one kind of value may be", () => {
  const schema = resultFileJsonSchema();
  expect(String(schema.description)).toContain("no secret");
  expect(String(schema.description)).toContain("dashboard.showValues");
  const text = JSON.stringify(schema);
  const values = [...text.matchAll(/"values":\{[^{]*?"description":"([^"]+)"/g)].map(
    (match) => match[1],
  );
  expect(values.length).toBeGreaterThan(0);
  for (const description of values) {
    expect(description).toContain("dashboard.showValues");
    expect(description).toContain("never one the tool marks secret");
  }
});

// Record 0061: the schema is published next to the one of sluiceway.yaml, and
// CI fails when it is stale, as it does for dist/.
test("the committed schema file is what the generator writes now", () => {
  const file = resolve(import.meta.dir, "../../schema/result-file.schema.json");
  expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(resultFileJsonSchema(), null, 2)}\n`);
});

function counts(some: Partial<Record<string, number>> = {}) {
  return { create: 0, update: 0, replace: 0, delete: 0, trackingOnly: 0, ...some };
}

function never(): never {
  throw new Error("unreachable");
}
