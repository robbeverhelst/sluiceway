import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type DashboardFacts,
  dashboardFacts,
  HEADER_STATES,
  MAX_CRATES,
} from "../../src/render/dashboard-facts.ts";
import type { ParsedRow } from "../../src/render/marker.ts";

// The facts of a dashboard's row set, at the interface every renderer reads:
// rows in, facts out. The header state (records 0031, 0043, 0055 and 0075),
// the crate count (records 0047, 0066 and 0075), the destroy signs (records
// 0043 and 0075), the destroy alert (records 0062 and 0075) and the counts
// line in numbers (records 0029, 0055 and 0056).

type Known = Extract<ParsedRow, { known: true }>;

interface Facts {
  destroys?: number;
  deletes?: number;
  failed?: boolean;
  gone?: number;
  shortened?: number;
  ticked?: boolean;
}

function row(state: Known["state"], id: string, facts: Facts = {}): Known {
  return {
    ...(facts.deletes === undefined ? {} : { deletes: facts.deletes }),
    ...(facts.gone === undefined ? {} : { gone: facts.gone }),
    known: true,
    stackId: id,
    state,
    hash: undefined,
    destroys: facts.destroys ?? 0,
    failed: facts.failed ?? false,
    shortened: facts.shortened ?? 0,
    drift: false,
    ticked: facts.ticked ?? false,
    text: "",
  };
}

// A row of a state this version does not know. Its marker could carry a
// `destroys` key, but the parser keeps no facts for it, so it has none. Its
// state may even start with a word a known state has.
const unknown = (id: string, state = "pending-approval"): ParsedRow => ({
  known: false,
  stackId: id,
  state,
  text: "",
});

const pending = (count: number) =>
  Array.from({ length: count }, (_, index) => row("pending", `p${String(index).padStart(2, "0")}`));

const NONE = { deletes: false, replaces: false };
const ZERO = {
  pending: 0,
  drifted: 0,
  deploying: 0,
  previewFailed: 0,
  inSync: 0,
  destroying: 0,
  failedDeploys: 0,
};

// The facts that are not lists of rows, and the lists as stack ids.
function plain(facts: DashboardFacts) {
  const ids = (rows: readonly ParsedRow[]) => rows.map((one) => one.stackId);
  return {
    headerState: facts.headerState,
    crates: facts.crates,
    signs: facts.signs,
    counts: facts.counts,
    shortened: facts.shortened,
    alert: facts.alert,
    pending: ids(facts.pending),
    deploying: ids(facts.deploying),
    drift: ids(facts.drift),
    previewFailed: ids(facts.previewFailed),
    inSync: ids(facts.inSync),
    unknown: ids(facts.unknown),
  };
}

type Expected = Partial<ReturnType<typeof plain>>;

const cases: [string, ParsedRow[], Expected][] = [
  // Every scan ends with one row per stack (record 0011).
  [
    "no rows at all is the first run, with nothing counted",
    [],
    {
      headerState: "first-run",
      crates: 0,
      signs: NONE,
      counts: ZERO,
      alert: undefined,
      pending: [],
      unknown: [],
    },
  ],
  [
    "only in sync rows is in sync",
    [row("in-sync", "b"), row("in-sync", "a")],
    { headerState: "in-sync", crates: 0, counts: { ...ZERO, inSync: 2 }, inSync: ["a", "b"] },
  ],
  [
    "a pending row is pending, one crate",
    [row("in-sync", "a"), row("pending", "b")],
    {
      headerState: "pending",
      crates: 1,
      counts: { ...ZERO, pending: 1, inSync: 1 },
      pending: ["b"],
    },
  ],
  // Record 0055: drift is a picture of nothing waiting, so pending wins.
  [
    "a drift row is drift",
    [row("in-sync", "a"), row("drift", "b")],
    { headerState: "drift", counts: { ...ZERO, drifted: 1, inSync: 1 }, drift: ["b"] },
  ],
  [
    "a pending row wins over drift",
    [row("drift", "a"), row("pending", "b")],
    { headerState: "pending" },
  ],
  [
    "a pending row that also shows drift is pending",
    [{ ...row("pending", "a"), drift: true }],
    { headerState: "pending", counts: { ...ZERO, pending: 1 } },
  ],
  [
    "a deploying row is deploying, and is counted and placed as deploying",
    [row("deploying", "a")],
    { headerState: "deploying", counts: { ...ZERO, deploying: 1 }, deploying: ["a"] },
  ],
  // Record 0056 places and counts a queued row with the deploying ones.
  // Record 0075 gives it a header state of its own while nothing deploys.
  [
    "a queued row is counted and placed as deploying, and the header is queued",
    [row("queued", "a"), row("in-sync", "b")],
    { headerState: "queued", counts: { ...ZERO, deploying: 1, inSync: 1 }, deploying: ["a"] },
  ],
  [
    "a deploying row wins over a queued one, and both are in Deploying by stack id",
    [row("queued", "a"), row("deploying", "c"), row("queued", "b")],
    { headerState: "deploying", counts: { ...ZERO, deploying: 3 }, deploying: ["a", "b", "c"] },
  ],
  [
    "a queued row wins over a pending row, and the crates still count the pending one",
    [row("pending", "a"), row("queued", "b")],
    { headerState: "queued", crates: 1, pending: ["a"], deploying: ["b"] },
  ],
  [
    "a preview failure is failing",
    [row("preview-failed", "a"), row("deploying", "b")],
    { headerState: "failing", counts: { ...ZERO, previewFailed: 1, deploying: 1 } },
  ],
  [
    "a failure line is failing on a row of any state, and counts as a failed deploy",
    [row("in-sync", "a", { failed: true }), row("pending", "b", { failed: true })],
    {
      headerState: "failing",
      counts: { ...ZERO, pending: 1, inSync: 1, failedDeploys: 2 },
      inSync: ["a"],
    },
  ],
  [
    "a failure line on a drifted row is failing",
    [row("drift", "a", { failed: true }), row("in-sync", "b")],
    { headerState: "failing" },
  ],
  // Record 0043: a destroy adds a sign and leaves the state alone.
  [
    "a destroy on a pending row: still pending, a sign, the warning and the alert",
    [row("pending", "a", { destroys: 1, deletes: 1 }), row("in-sync", "b")],
    {
      headerState: "pending",
      signs: { deletes: true, replaces: false },
      counts: { ...ZERO, pending: 1, inSync: 1, destroying: 1 },
      alert: "> [!CAUTION]\n> 1 pending stack deletes or replaces resources: **a**",
    },
  ],
  [
    "a destroy does not hide a failure",
    [row("pending", "a", { destroys: 1 }), row("preview-failed", "b")],
    { headerState: "failing", signs: { deletes: true, replaces: false } },
  ],
  // The two destroy rules side by side: the signs count pending, deploying
  // and queued rows, the warning and the alert pending rows only.
  [
    "a destroy on a deploying row turns a sign on, and neither the warning nor the alert",
    [row("deploying", "a", { destroys: 2, deletes: 0 }), row("pending", "b")],
    {
      headerState: "deploying",
      signs: { deletes: false, replaces: true },
      counts: { ...ZERO, pending: 1, deploying: 1 },
      alert: undefined,
    },
  ],
  [
    "a destroy on a queued row turns a sign on, and neither the warning nor the alert",
    [row("queued", "a", { destroys: 1, deletes: 1 })],
    { headerState: "queued", signs: { deletes: true, replaces: false }, alert: undefined },
  ],
  [
    "an in sync or preview failed row with destroys counts nowhere",
    [row("in-sync", "a", { destroys: 1, deletes: 1 }), row("preview-failed", "b", { destroys: 4 })],
    { signs: NONE, counts: { ...ZERO, inSync: 1, previewFailed: 1 }, alert: undefined },
  ],
  // Record 0075: a sign for a replace and a sign of its own for a delete.
  [
    "a row with only replaces puts up the replace sign",
    [row("pending", "a", { destroys: 2, deletes: 0 })],
    { signs: { deletes: false, replaces: true }, counts: { ...ZERO, pending: 1, destroying: 1 } },
  ],
  [
    "a row with only deletes puts up the delete sign",
    [row("pending", "a", { destroys: 2, deletes: 2 })],
    { signs: { deletes: true, replaces: false } },
  ],
  [
    "a row with both puts up both",
    [row("deploying", "a", { destroys: 3, deletes: 1 })],
    { signs: { deletes: true, replaces: true } },
  ],
  [
    "two rows, one of each, put up both",
    [
      row("pending", "a", { destroys: 1, deletes: 1 }),
      row("queued", "b", { destroys: 1, deletes: 0 }),
    ],
    { signs: { deletes: true, replaces: true } },
  ],
  // An older version did not say which. The delete sign asks for the more
  // care of the two.
  [
    "a marker that does not say how many are deletes counts them all as deletes",
    [row("pending", "a", { destroys: 2 })],
    { signs: { deletes: true, replaces: false } },
  ],
  [
    "a failure line makes no difference to the signs",
    [row("pending", "a", { destroys: 1, failed: true }), row("in-sync", "b", { failed: true })],
    { signs: { deletes: true, replaces: false } },
  ],
  [
    "the alert names every pending stack with a destroy, in stack id order, as the warning counts them",
    [
      row("pending", "storage/buckets:prod", { destroys: 1 }),
      row("pending", "apps/auth:prod"),
      row("pending", "apps/api:prod", { destroys: 1 }),
    ],
    {
      counts: { ...ZERO, pending: 3, destroying: 2 },
      alert:
        "> [!CAUTION]\n> 2 pending stacks delete or replace resources: **apps/api:prod**, **storage/buckets:prod**",
    },
  ],
  // Record 0075: a drifted row deletes and replaces nothing. The alert names
  // it for a resource gone outside the code, and nothing else counts that.
  [
    "the alert names a drifted stack with a resource gone, and no sign or warning does",
    [row("drift", "site:prod", { gone: 1 }), row("drift", "web:prod")],
    {
      headerState: "drift",
      signs: NONE,
      counts: { ...ZERO, drifted: 2 },
      alert: "> [!CAUTION]\n> 1 drifted stack has resources gone outside the code: **site:prod**",
    },
  ],
  [
    "the alert has a paragraph for pending destroys and one for resources gone",
    [
      row("drift", "a", { gone: 2 }),
      row("drift", "b", { gone: 1 }),
      row("pending", "p", { destroys: 1 }),
    ],
    {
      alert: [
        "> [!CAUTION]",
        "> 1 pending stack deletes or replaces resources: **p**",
        ">",
        "> 2 drifted stacks have resources gone outside the code: **a**, **b**",
      ].join("\n"),
    },
  ],
  [
    "a stack id in the alert is never trusted as markup",
    [row("pending", "a*b<c>", { destroys: 1 })],
    {
      alert: "> [!CAUTION]\n> 1 pending stack deletes or replaces resources: **a&#42;b&lt;c&gt;**",
    },
  ],
  // Record 0028: the note under the scan line counts shortened pending rows.
  [
    "shortened counts pending rows only",
    [
      row("pending", "a", { shortened: 2 }),
      row("pending", "b"),
      row("drift", "c", { shortened: 1 }),
    ],
    { shortened: 1 },
  ],
  // Record 0009: a row of a state this version does not know takes no part.
  [
    "a row of an unknown state takes no part, and is listed last by stack id",
    [unknown("z"), unknown("y", "flooded"), row("pending", "a")],
    {
      headerState: "pending",
      crates: 1,
      signs: NONE,
      counts: { ...ZERO, pending: 1 },
      alert: undefined,
      unknown: ["y", "z"],
    },
  ],
  // Stacks were found, so this is not a first run.
  [
    "rows of unknown states alone are in sync, not a first run",
    [unknown("x")],
    { headerState: "in-sync" },
  ],
  [
    "whether a box is ticked makes no difference",
    [row("pending", "a", { ticked: true })],
    { headerState: "pending", crates: 1 },
  ],
];

describe("the facts of a row set", () => {
  test.each(cases)("%s", (_, rows, expected) => {
    expect(plain(dashboardFacts(rows))).toMatchObject(expected);
  });

  test.each(cases)("%s, in any order of the rows", (_, rows) => {
    expect(plain(dashboardFacts([...rows].reverse()))).toEqual(plain(dashboardFacts(rows)));
  });
});

// The first state that applies wins, top to bottom. Each case holds
// everything below its winner as well.
describe("precedence: bad news wins", () => {
  const precedence: [(typeof HEADER_STATES)[number], ParsedRow[]][] = [
    [
      "failing",
      [
        row("pending", "a", { destroys: 1 }),
        row("preview-failed", "b"),
        row("in-sync", "c", { failed: true }),
        row("deploying", "d", { destroys: 1 }),
        row("pending", "e"),
        row("in-sync", "f"),
      ],
    ],
    ["failing", [row("preview-failed", "a"), row("queued", "b"), row("pending", "c")]],
    [
      "deploying",
      [row("deploying", "a"), row("queued", "b"), row("pending", "c"), row("in-sync", "d")],
    ],
    ["deploying", [row("deploying", "a"), row("drift", "b")]],
    ["queued", [row("queued", "a"), row("pending", "b"), row("drift", "c"), row("in-sync", "d")]],
    ["pending", [row("pending", "a", { destroys: 3 }), row("drift", "b"), row("in-sync", "c")]],
    ["drift", [row("drift", "a"), row("in-sync", "b")]],
    ["in-sync", [row("in-sync", "a")]],
  ];

  test("the seven states are listed in the order in which they win, and plain is gone", () => {
    expect(HEADER_STATES).toEqual([
      "failing",
      "deploying",
      "queued",
      "pending",
      "drift",
      "first-run",
      "in-sync",
    ]);
  });

  test.each(precedence)("%s", (expected, rows) => {
    expect(dashboardFacts(rows).headerState).toBe(expected);
    expect(dashboardFacts([...rows].reverse()).headerState).toBe(expected);
  });
});

// Record 0047: one crate per pending stack up to the maximum, and past it
// the row runs on off the edge. Record 0075 raised the maximum from 12 to 20.
describe("the crate count", () => {
  test("the maximum is 20", () => {
    expect(MAX_CRATES).toBe(20);
  });

  test.each<[number, number | "more"]>([
    [0, 0],
    [1, 1],
    [12, 12],
    [13, 13],
    [19, 19],
    [20, 20],
    [21, "more"],
    [58, "more"],
  ])("%i pending rows show %p, whatever else there is", (count, crates) => {
    const others = [row("in-sync", "x"), row("deploying", "y"), row("preview-failed", "z")];
    const later = Array.from({ length: 30 }, (_, index) => unknown(`later-${index}`));
    expect(dashboardFacts([...pending(count), ...others, ...later]).crates).toBe(crates);
  });
});

// Record 0043: the plain state is gone, and nothing in the code still names it
// as a state. A comment may still tell where the destroy sign's rule came from.
test("no code in src/ names plain as a header state", () => {
  const SRC = resolve(import.meta.dir, "../../src");
  const files = [...new Bun.Glob("**/*.ts").scanSync(SRC)];
  expect(files.length).toBeGreaterThan(0);
  const naming = files.filter((file) =>
    /["'`]plain["'`]|plain-(?:light|dark|\$\{)/.test(readFileSync(join(SRC, file), "utf8")),
  );
  expect(naming).toEqual([]);
});
