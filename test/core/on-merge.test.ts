import { describe, expect, test } from "bun:test";
import type { PreviewResult } from "../../src/adapters/adapter.ts";
import type { DeployWindow } from "../../src/core/deploy-window.ts";
import type { Change, Diff } from "../../src/core/diff.ts";
import { diffHash } from "../../src/core/diff-hash.ts";
import { type OnMergeInput, type OnMergeWait, onMergeDeploys } from "../../src/core/on-merge.ts";

// Record 0095: a stack with `deploy: on-merge` whose row would be pending
// after the scan of a merge deploys through the path a tick takes. What goes
// and what waits for a tick, and why, is decided here and nowhere else.

const change = (op: Change["op"], name = "motd"): Change => ({
  address: `urn:${name}`,
  type: "local:File",
  name,
  op,
  changedKeys: op === "update" ? ["content"] : [],
  replaceKeys: op === "replace" ? ["path"] : [],
});

const diff = (stackId: string, changes: Change[], drift?: Change[]): Diff => ({
  stackId,
  changes,
  ...(drift ? { drift } : {}),
});

const ok = (stackId: string, changes: Change[], drift?: Change[]): PreviewResult => ({
  ok: true,
  diff: diff(stackId, changes, drift),
  toolLog: "",
});

const base = (overrides: Partial<OnMergeInput> = {}): OnMergeInput => ({
  mergedBy: "alice",
  deploys: true,
  readOnly: false,
  stacks: [
    { id: "app:prod", environment: "production", deploy: "on-merge" },
    { id: "site:prod", environment: "sluiceway", deploy: "on-tick" },
  ],
  previewed: new Map([
    ["app:prod", ok("app:prod", [change("update")])],
    ["site:prod", ok("site:prod", [change("update", "index")])],
  ]),
  livePending: new Set(),
  open: new Set(),
  phases: [],
  // A Tuesday morning in Brussels.
  clock: { now: new Date("2026-09-22T08:00:00Z"), timeZone: "Europe/Brussels" },
  ...overrides,
});

describe("onMergeDeploys", () => {
  test("a stack set to on-merge that is pending after the scan of a merge deploys, attributed to whoever merged", () => {
    const decided = onMergeDeploys(base());
    expect(decided.deploys).toEqual([
      {
        stackId: "app:prod",
        environment: "production",
        ticker: "alice",
        hash: diffHash(diff("app:prod", [change("update")])),
        drift: false,
        behind: undefined,
      },
    ]);
    expect(decided.waits).toEqual(new Map());
  });

  test("a stack left at the default waits for a tick as always, and gets no note", () => {
    const decided = onMergeDeploys(base());
    expect(decided.deploys.map(({ stackId }) => stackId)).not.toContain("site:prod");
    expect(decided.waits.has("site:prod")).toBe(false);
  });

  test("a repo with no stack set to on-merge decides nothing", () => {
    const decided = onMergeDeploys(
      base({ stacks: [{ id: "app:prod", environment: "sluiceway", deploy: "on-tick" }] }),
    );
    expect(decided).toEqual({ deploys: [], waits: new Map() });
  });

  test("a stack in sync, or whose preview failed, or that this scan did not preview, deploys nothing and gets no note", () => {
    const failed: PreviewResult = {
      ok: false,
      reason: { kind: "tool-error", exitCode: 1 },
      log: "",
    } as unknown as PreviewResult;
    for (const previewed of [
      new Map([["app:prod", ok("app:prod", [])]]),
      new Map([["app:prod", failed]]),
      new Map<string, PreviewResult>(),
    ]) {
      expect(onMergeDeploys(base({ previewed }))).toEqual({ deploys: [], waits: new Map() });
    }
  });

  test("a stack with an open deployment is deploying already, and nothing more starts", () => {
    expect(onMergeDeploys(base({ open: new Set(["app:prod"]) }))).toEqual({
      deploys: [],
      waits: new Map(),
    });
  });

  test("a delete never goes by itself: the stack waits for a tick, and says why", () => {
    const previewed = new Map([
      ["app:prod", ok("app:prod", [change("update"), change("delete", "old")])],
    ]);
    const decided = onMergeDeploys(base({ previewed }));
    expect(decided.deploys).toEqual([]);
    expect(decided.waits).toEqual(new Map([["app:prod", { kind: "destroy" }]]));
  });

  test("a replace is a destroy too: the old object goes away before or after its new one exists", () => {
    const previewed = new Map([["app:prod", ok("app:prod", [change("replace")])]]);
    expect(onMergeDeploys(base({ previewed })).waits).toEqual(
      new Map([["app:prod", { kind: "destroy" }]]),
    );
  });

  test("a change that only starts or stops tracking an object is no destroy, and goes", () => {
    const forget: Change = { ...change("none", "kept"), tracking: "forget" };
    const previewed = new Map([["app:prod", ok("app:prod", [forget])]]);
    expect(onMergeDeploys(base({ previewed })).deploys.map(({ stackId }) => stackId)).toEqual([
      "app:prod",
    ]);
  });

  test("a pending row that also shows drift waits for a tick: a deploy would put back what someone changed by hand", () => {
    const previewed = new Map([
      ["app:prod", ok("app:prod", [change("update")], [change("update", "drifted")])],
    ]);
    const decided = onMergeDeploys(base({ previewed }));
    expect(decided.deploys).toEqual([]);
    expect(decided.waits).toEqual(new Map([["app:prod", { kind: "drift" }]]));
  });

  test("a drifted row with nothing from the code is no change of the code, deploys nothing and gets no note", () => {
    const previewed = new Map([["app:prod", ok("app:prod", [], [change("update", "drifted")])]]);
    expect(onMergeDeploys(base({ previewed }))).toEqual({ deploys: [], waits: new Map() });
  });

  test("a destroy is named before drift, the reason a person most needs to read", () => {
    const previewed = new Map([
      ["app:prod", ok("app:prod", [change("delete")], [change("update", "drifted")])],
    ]);
    expect(onMergeDeploys(base({ previewed })).waits.get("app:prod")).toEqual({ kind: "destroy" });
  });

  test("a scan no merge started (a schedule, a dispatch, the rescan box) deploys nothing, and the row says it waits for a tick", () => {
    const decided = onMergeDeploys(base({ mergedBy: undefined }));
    expect(decided.deploys).toEqual([]);
    expect(decided.waits).toEqual(new Map([["app:prod", { kind: "not-merged" }]]));
  });

  test("deploys: false stops it: nothing goes, and the row says deploys are off", () => {
    const decided = onMergeDeploys(base({ deploys: false }));
    expect(decided.deploys).toEqual([]);
    expect(decided.waits).toEqual(new Map([["app:prod", { kind: "deploys-off" }]]));
  });

  test("deploys: false is named before a destroy: no tick would deploy it either", () => {
    const previewed = new Map([["app:prod", ok("app:prod", [change("delete")])]]);
    expect(onMergeDeploys(base({ deploys: false, previewed })).waits.get("app:prod")).toEqual({
      kind: "deploys-off",
    });
  });

  test("a read-only dashboard deploys nothing and writes no note: it says once, above the rows, that nothing can be ticked", () => {
    const previewed = new Map([
      ["app:prod", ok("app:prod", [change("update")])],
      ["gone:prod", ok("gone:prod", [change("delete")])],
    ]);
    const stacks = [
      { id: "app:prod", environment: "sluiceway", deploy: "on-merge" as const },
      { id: "gone:prod", environment: "sluiceway", deploy: "on-merge" as const },
    ];
    expect(onMergeDeploys(base({ readOnly: true, previewed, stacks }))).toEqual({
      deploys: [],
      waits: new Map(),
    });
  });

  describe("dependsOn and phases decide the order, as for a tick", () => {
    const chain = (
      network: OnMergeInput["stacks"][number]["deploy"],
      overrides: Partial<OnMergeInput> = {},
    ): OnMergeInput =>
      base({
        stacks: [
          { id: "network:prod", environment: "sluiceway", deploy: network },
          {
            id: "app:prod",
            environment: "sluiceway",
            deploy: "on-merge",
            dependsOn: ["network:prod"],
          },
        ],
        previewed: new Map([
          ["network:prod", ok("network:prod", [change("update", "vpc")])],
          ["app:prod", ok("app:prod", [change("update")])],
        ]),
        ...overrides,
      });

    test("two stacks set to on-merge in one chain: the first layer goes now, the next is queued behind it", () => {
      const decided = onMergeDeploys(chain("on-merge"));
      expect(decided.deploys.map(({ stackId, behind }) => [stackId, behind])).toEqual([
        ["network:prod", undefined],
        ["app:prod", ["network:prod"]],
      ]);
      expect(decided.waits).toEqual(new Map());
    });

    test("a stack that depends on one waiting for a tick waits too, and says for which", () => {
      const decided = onMergeDeploys(chain("on-tick"));
      expect(decided.deploys).toEqual([]);
      expect(decided.waits).toEqual(
        new Map([["app:prod", { kind: "depends-on", named: ["network:prod"], phases: [] }]]),
      );
    });

    test("a dependency set to on-merge whose own change waits (a destroy) holds it back as well", () => {
      const previewed = new Map([
        ["network:prod", ok("network:prod", [change("delete", "vpc")])],
        ["app:prod", ok("app:prod", [change("update")])],
      ]);
      const decided = onMergeDeploys(chain("on-merge", { previewed }));
      expect(decided.deploys).toEqual([]);
      expect(decided.waits).toEqual(
        new Map<string, OnMergeWait>([
          ["network:prod", { kind: "destroy" }],
          ["app:prod", { kind: "depends-on", named: ["network:prod"], phases: [] }],
        ]),
      );
    });

    test("a dependency this scan did not preview holds it back while its live row is pending", () => {
      const previewed = new Map([["app:prod", ok("app:prod", [change("update")])]]);
      const decided = onMergeDeploys(
        chain("on-tick", { previewed, livePending: new Set(["network:prod"]) }),
      );
      expect(decided.waits.get("app:prod")).toEqual({
        kind: "depends-on",
        named: ["network:prod"],
        phases: [],
      });
    });

    test("a dependency that is in sync holds nothing back", () => {
      const previewed = new Map([
        ["network:prod", ok("network:prod", [])],
        ["app:prod", ok("app:prod", [change("update")])],
      ]);
      expect(
        onMergeDeploys(chain("on-tick", { previewed })).deploys.map(({ stackId }) => stackId),
      ).toEqual(["app:prod"]);
    });

    test("a dependency that is deploying queues it behind that deploy", () => {
      const decided = onMergeDeploys(chain("on-tick", { open: new Set(["network:prod"]) }));
      expect(decided.deploys.map(({ stackId, behind }) => [stackId, behind])).toEqual([
        ["app:prod", ["network:prod"]],
      ]);
    });

    test("a stack waiting on an earlier phase names the phase", () => {
      const decided = onMergeDeploys(
        base({
          phases: ["infra", "apps"],
          stacks: [
            { id: "network:prod", environment: "sluiceway", deploy: "on-tick", phase: "infra" },
            {
              id: "app:prod",
              environment: "sluiceway",
              deploy: "on-merge",
              phase: "apps",
              dependsOn: ["network:prod"],
            },
          ],
          previewed: new Map([
            ["network:prod", ok("network:prod", [change("update", "vpc")])],
            ["app:prod", ok("app:prod", [change("update")])],
          ]),
        }),
      );
      expect(decided.waits.get("app:prod")).toEqual({
        kind: "depends-on",
        named: [],
        phases: [{ phase: "infra", stackIds: ["network:prod"] }],
      });
    });
  });

  // Deploy windows (record 0104): a deploy on merge waits for the window as a
  // tick does. Its record is opened now and waits, and a run inside the
  // window starts it. A destroy still waits for a tick, window or not.
  describe("the deploy window", () => {
    const OFFICE_HOURS: DeployWindow[] = [
      { days: ["monday", "tuesday", "wednesday", "thursday"], from: "09:00", to: "17:00" },
    ];
    const windowed = (deploy: "on-merge" | "on-tick" = "on-merge") => [
      { id: "app:prod", environment: "production", deploy, deployWindows: OFFICE_HOURS },
    ];
    const FRIDAY = { now: new Date("2026-09-25T16:00:00Z"), timeZone: "Europe/Brussels" };

    test("outside the window the record waits for it, and nothing is handed on", () => {
      const decided = onMergeDeploys(base({ stacks: windowed(), clock: FRIDAY }));
      expect(decided.deploys).toEqual([
        expect.objectContaining({ stackId: "app:prod", behind: undefined, window: true }),
      ]);
      expect(decided.waits).toEqual(new Map());
    });

    test("inside the window it goes as before, with no window key", () => {
      const decided = onMergeDeploys(base({ stacks: windowed() }));
      expect(decided.deploys).toEqual([expect.objectContaining({ stackId: "app:prod" })]);
      expect("window" in (decided.deploys[0] ?? {})).toBe(false);
    });

    test("a destroy waits for a tick, window or not", () => {
      const destroy = new Map([["app:prod", ok("app:prod", [change("delete")])]]);
      for (const clock of [FRIDAY, base().clock]) {
        const decided = onMergeDeploys(base({ stacks: windowed(), clock, previewed: destroy }));
        expect(decided.deploys).toEqual([]);
        expect(decided.waits.get("app:prod")).toEqual({ kind: "destroy" });
      }
    });

    test("a stack behind another gets no window key: it is held to the window when it starts", () => {
      const decided = onMergeDeploys(
        base({
          stacks: [
            ...windowed(),
            {
              id: "site:prod",
              environment: "sluiceway",
              deploy: "on-merge",
              dependsOn: ["app:prod"],
              deployWindows: OFFICE_HOURS,
            },
          ],
          clock: FRIDAY,
        }),
      );
      expect(decided.deploys).toEqual([
        expect.objectContaining({ stackId: "app:prod", window: true }),
        expect.objectContaining({ stackId: "site:prod", behind: ["app:prod"] }),
      ]);
      expect("window" in (decided.deploys[1] ?? {})).toBe(false);
    });
  });
});
