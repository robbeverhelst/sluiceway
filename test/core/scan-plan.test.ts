import { describe, expect, test } from "bun:test";
import type { Claimant } from "../../src/core/claim.ts";
import {
  changedPaths,
  comparisonBase,
  type FullScanReason,
  fullScanReasonText,
  oneRowPerStack,
  planScan,
} from "../../src/core/scan-plan.ts";

const OLD = "1111111111111111111111111111111111111111";

function claimant(id: string, inputs: string[] = []): Claimant {
  const [path = ""] = id.split(":");
  return { id, path, inputs };
}

describe("where a scan compares from", () => {
  const dashboard = { root: { version: 1, scanSha: OLD } };

  test("a push compares from the scan-sha of the dashboard", () => {
    expect(comparisonBase("push", dashboard, 1)).toEqual({ kind: "compare", from: OLD });
  });

  test.each(["schedule", "workflow_dispatch", "issues", "repository_dispatch"])(
    "a scan on %s is a full scan",
    (event) => {
      expect(comparisonBase(event, dashboard, 1)).toEqual({ kind: "event", event });
    },
  );

  test("the scan resolve starts after a merge compares from the scan-sha, as a push does (slice 4.13)", () => {
    expect(comparisonBase("workflow_dispatch", dashboard, 1, [418])).toEqual({
      kind: "compare",
      from: OLD,
    });
    expect(comparisonBase("workflow_dispatch", undefined, 1, [418])).toEqual({
      kind: "no-dashboard",
    });
  });

  test("a merge named on any other event, or no merge named, changes nothing", () => {
    expect(comparisonBase("schedule", dashboard, 1, [418])).toEqual({
      kind: "event",
      event: "schedule",
    });
    expect(comparisonBase("workflow_dispatch", dashboard, 1, [])).toEqual({
      kind: "event",
      event: "workflow_dispatch",
    });
  });

  test("no dashboard yet", () => {
    expect(comparisonBase("push", undefined, 1)).toEqual({ kind: "no-dashboard" });
  });

  test("a dashboard without a root marker that reads", () => {
    expect(comparisonBase("push", { root: undefined }, 1)).toEqual({ kind: "no-root-marker" });
  });

  test("a root marker of another version", () => {
    expect(comparisonBase("push", { root: { version: 2, scanSha: OLD } }, 1)).toEqual({
      kind: "other-version",
      version: 2,
    });
  });

  test.each([undefined, "", "main", "abc1234", `${OLD} `, `${OLD}...main`])(
    "a scan-sha of %p is no commit to compare from",
    (scanSha) => {
      expect(comparisonBase("push", { root: { version: 1, scanSha } }, 1)).toEqual({
        kind: "no-scan-sha",
      });
    },
  );

  test("a SHA-256 commit id is a commit too", () => {
    const from = "a".repeat(64);
    expect(comparisonBase("push", { root: { version: 1, scanSha: from } }, 1)).toEqual({
      kind: "compare",
      from,
    });
  });
});

describe("the changed paths of a comparison", () => {
  test("a straight line ahead gives its files", () => {
    expect(
      changedPaths({ status: "ahead", files: [{ path: "a.ts" }, { path: "b/c.ts" }] }),
    ).toEqual({ kind: "changed", paths: ["a.ts", "b/c.ts"] });
  });

  test("a renamed file counts under its old and its new path", () => {
    expect(
      changedPaths({
        status: "ahead",
        files: [{ path: "apps/loki/index.ts", previousPath: "apps/grafana/index.ts" }],
      }),
    ).toEqual({ kind: "changed", paths: ["apps/loki/index.ts", "apps/grafana/index.ts"] });
  });

  test("the same commit again is a straight line of no length", () => {
    expect(changedPaths({ status: "identical", files: [] })).toEqual({
      kind: "changed",
      paths: [],
    });
  });

  test.each(["behind", "diverged", "something-new"])("%s is not a straight line", (status) => {
    expect(changedPaths({ status, files: [{ path: "a.ts" }] })).toEqual({
      kind: "not-a-straight-line",
      status,
    });
  });

  test("a list at the cap of 300 files cannot be trusted, one under it can", () => {
    const files = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ path: `f${index}` }));
    expect(changedPaths({ status: "ahead", files: files(300) })).toEqual({ kind: "file-cap" });
    expect(changedPaths({ status: "ahead", files: files(299) }).kind).toBe("changed");
  });
});

describe("which stacks a narrowed scan previews", () => {
  const stacks = [
    claimant("app:prod", ["shared/**"]),
    claimant("network:dev"),
    claimant("network:prod"),
    claimant("site:prod"),
  ];
  const rows = (state = "in-sync") => stacks.map(({ id }) => ({ stackId: id, state }));

  test("only the stacks that claim a changed file, in the order of the stacks", () => {
    expect(planScan(stacks, ["shared/motd.txt", "network/Pulumi.yaml"], [], rows())).toEqual({
      kind: "narrowed",
      previews: [
        { id: "app:prod", why: { kind: "claims", files: ["shared/motd.txt"] } },
        { id: "network:dev", why: { kind: "claims", files: ["network/Pulumi.yaml"] } },
        { id: "network:prod", why: { kind: "claims", files: ["network/Pulumi.yaml"] } },
      ],
    });
  });

  test("a changed file that no stack claims makes it a full scan", () => {
    expect(planScan(stacks, ["site/index.ts", "package.json", "bun.lock"], [], rows())).toEqual({
      kind: "full",
      why: { kind: "unclaimed", files: ["package.json", "bun.lock"] },
    });
  });

  test("a push that changes only unrelated files previews nothing", () => {
    expect(planScan(stacks, ["README.md"], ["**/*.md"], rows())).toEqual({
      kind: "narrowed",
      previews: [],
    });
  });

  test("a stack without a row is previewed although it claims nothing", () => {
    const live = rows().filter((row) => row.stackId !== "site:prod");
    expect(planScan(stacks, [], [], live)).toEqual({
      kind: "narrowed",
      previews: [{ id: "site:prod", why: { kind: "no-row" } }],
    });
  });

  test("a stack whose row is a preview failure is previewed although it claims nothing", () => {
    const live = rows().map((row) =>
      row.stackId === "network:dev" ? { ...row, state: "preview-failed" } : row,
    );
    expect(planScan(stacks, [], [], live)).toEqual({
      kind: "narrowed",
      previews: [{ id: "network:dev", why: { kind: "preview-failed" } }],
    });
  });

  test("a claim is the reason that is named first", () => {
    const live = [{ stackId: "site:prod", state: "preview-failed" }];
    expect(planScan(stacks.slice(3), ["site/index.ts"], [], live)).toEqual({
      kind: "narrowed",
      previews: [{ id: "site:prod", why: { kind: "claims", files: ["site/index.ts"] } }],
    });
  });

  test("a row of a state this version does not know is a row", () => {
    expect(planScan(stacks, [], [], rows("drifted"))).toEqual({ kind: "narrowed", previews: [] });
  });
});

describe("one row for every discovered stack", () => {
  test("fresh wins, then the live row, and what is left has to be previewed now", () => {
    expect(
      oneRowPerStack(["a", "b", "c", "d"], new Set(["a", "b"]), ["b", "c", "gone", "c"]),
    ).toEqual({
      carried: ["c"],
      missing: ["d"],
      dropped: ["gone"],
    });
  });

  test("a full scan carries nothing and drops every row it does not know", () => {
    expect(oneRowPerStack(["a"], new Set(["a"]), ["a", "old"])).toEqual({
      carried: [],
      missing: [],
      dropped: ["old"],
    });
  });
});

describe("the words for why a scan is a full scan", () => {
  const words: [FullScanReason, string][] = [
    [
      { kind: "event", event: "schedule" },
      "the event is schedule, and only a push, or the scan resolve starts after a merge, gives a narrowed scan",
    ],
    [{ kind: "no-dashboard" }, "there is no dashboard yet"],
    [{ kind: "no-root-marker" }, "the dashboard has no root marker that can be read"],
    [
      { kind: "other-version", version: 2 },
      "the root marker of the dashboard has version 2, which this version of Sluiceway does not write",
    ],
    [{ kind: "no-scan-sha" }, "the root marker of the dashboard names no commit to compare from"],
    [
      { kind: "compare-failed" },
      "GitHub did not give the comparison from the commit of the last scan",
    ],
    [
      { kind: "not-a-straight-line", status: "diverged" },
      'the checked-out commit does not follow the commit of the last scan in a straight line (GitHub calls it "diverged"), as after a force push or a re-run of an older run',
    ],
    [
      { kind: "file-cap" },
      "the comparison lists 300 files, the most GitHub gives, so files may be missing from it",
    ],
    [{ kind: "unclaimed", files: ["package.json"] }, "no stack claims package.json"],
    [
      { kind: "unclaimed", files: ["package.json", "bun.lock", "tsconfig.json"] },
      "no stack claims package.json and 2 more changed files",
    ],
    // Onboarding log, hurdle 14: the config file is not a file a stack should
    // claim, so the words say what happened instead (record 0010).
    [
      { kind: "unclaimed", files: ["sluiceway.yaml"] },
      "sluiceway.yaml changed, so every stack is previewed",
    ],
    [
      { kind: "unclaimed", files: ["package.json", "sluiceway.yaml"] },
      "sluiceway.yaml changed, so every stack is previewed, and no stack claims package.json",
    ],
    [
      { kind: "unclaimed", files: ["package.json", "sluiceway.yaml", "bun.lock", "a.json"] },
      "sluiceway.yaml changed, so every stack is previewed, and no stack claims package.json and 2 more changed files",
    ],
    // Only the file at the repo root is the config file.
    [{ kind: "unclaimed", files: ["docs/sluiceway.yaml"] }, "no stack claims docs/sluiceway.yaml"],
    [
      { kind: "does-not-fit", carried: 12 },
      "the body does not fit in one issue with 12 rows carried through, and only a fresh row can be shortened",
    ],
  ];
  test.each(words)("%j", (reason, text) => {
    expect(fullScanReasonText(reason)).toBe(text);
  });
});
