import { describe, expect, test } from "bun:test";
import { type BodyInput, type RecentDeploy, renderBody, rowBlock } from "../../src/render/body.ts";
import { HEADER_STATES, type HeaderState } from "../../src/render/header-state.ts";
import { type ParsedRow, parseDashboard } from "../../src/render/marker.ts";
import type { FailureLine, InSyncRow, PendingRow, Row } from "../../src/render/row.ts";
import { rows58, rows100 } from "./fixtures.ts";

const ROOT = {
  scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
  scanRun: "17034455121",
  scanAt: "2026-09-21T10:02:41Z",
  fullScanAt: "2026-09-21T06:00:12Z",
  fullScanRun: "17031200455",
};

const REPO_URL = "https://github.com/example-org/infra";
const RUN_URL = `${REPO_URL}/actions/runs/17034455121`;

function pending(
  stackId: string,
  ops: ("create" | "update" | "delete")[] = ["update"],
): PendingRow {
  return {
    state: "pending",
    diff: {
      stackId,
      changes: ops.map((op, index) => ({
        address: `address-${index}`,
        type: "random:index/randomPet:RandomPet",
        name: `pet-${index}`,
        op,
        changedKeys: op === "update" ? ["length"] : [],
        replaceKeys: [],
      })),
    },
    hash: "3fa9c1e2aabbccdd",
    runUrl: RUN_URL,
  };
}

const inSync = (stackId: string): InSyncRow => ({ state: "in-sync", stackId });

function input(rows: Row[], overrides: Partial<BodyInput> = {}): BodyInput {
  return {
    root: ROOT,
    rows: rows.map((row) => rowBlock(row)),
    recentlyDeployed: [],
    repoUrl: REPO_URL,
    actionRef: "v0.1.0",
    personality: true,
    ...overrides,
  };
}

const IMAGES = "https://raw.githubusercontent.com/sluiceway/sluiceway/v0.1.0/assets/mascot";

// Written out by hand from records 0029 and 0033, not from the code.
describe("the body of record 0029", () => {
  test("one pending stack and one in sync", () => {
    expect(renderBody(input([inSync("apps/web:prod"), pending("apps/api:prod")]))).toBe(
      [
        '<!-- sluiceway:dashboard v="1" scan-sha="8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c" scan-run="17034455121" scan-at="2026-09-21T10:02:41Z" full-scan-at="2026-09-21T06:00:12Z" full-scan-run="17031200455" -->',
        "",
        "<picture>",
        `  <source media="(prefers-color-scheme: dark)" srcset="${IMAGES}/pending-dark.svg">`,
        `  <img alt="Sluiceway: changes are pending" width="440" src="${IMAGES}/pending-light.svg">`,
        "</picture>",
        "",
        "**1 pending** · 0 deploying · 0 preview failed · 1 in sync",
        "",
        `Scanned [\`8c41f0e\`](${REPO_URL}/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](${RUN_URL}) · <sub>last full scan 2026-09-21 06:00 UTC</sub>`,
        "",
        "## Pending",
        "",
        "Tick a box to deploy that stack exactly as its row shows it.",
        "",
        `- [ ] **apps/api:prod** · 1 update · [preview](${RUN_URL}) <!-- sluiceway:row stack="apps/api:prod" state="pending" hash="3fa9c1e2aabbccdd" -->`,
        "  <details><summary>1 change</summary>",
        "  <kbd>update</kbd> <code>random:index/randomPet:RandomPet</code> <b>pet-0</b> · <code>length</code><br>",
        "  </details>",
        "  <!-- /sluiceway:row -->",
        "",
        "## In sync",
        "",
        "<details><summary>1 stack in sync</summary>",
        "",
        '- apps/web:prod <!-- sluiceway:row stack="apps/web:prod" state="in-sync" -->',
        "  <!-- /sluiceway:row -->",
        "",
        "</details>",
        "",
        "---",
        "",
        "- [ ] Rescan all stacks <!-- sluiceway:rescan -->",
        "",
        "<sub>[Sluiceway](https://github.com/sluiceway/sluiceway) v0.1.0 · [docs](https://github.com/sluiceway/sluiceway#readme)</sub>",
      ].join("\n"),
    );
  });
});

const FAILURE: FailureLine = {
  reason: "the run ended without reporting a result",
  ticker: "bob",
  at: new Date("2026-09-19T16:03:20Z"),
  runUrl: `${REPO_URL}/actions/runs/17019884120`,
};

const deploying = (stackId: string, destroys = 0): Row => ({
  state: "deploying",
  stackId,
  ticker: "carol",
  runUrl: RUN_URL,
  destroys,
});

const previewFailed = (stackId: string): Row => ({
  state: "preview-failed",
  stackId,
  reason: "the tool exited with an error (exit code 255)",
  runUrl: RUN_URL,
});

// One small dashboard per header state, each holding everything that loses
// against its own state (record 0031).
const DASHBOARDS: Record<HeaderState, Row[]> = {
  plain: [
    pending("a:destroys", ["create", "delete"]),
    previewFailed("b:broken"),
    deploying("c:deploying"),
    pending("d:pending"),
    inSync("e:calm"),
  ],
  failing: [
    previewFailed("b:broken"),
    deploying("c:deploying"),
    pending("d:pending"),
    { ...inSync("e:failed"), failure: FAILURE },
    inSync("f:calm"),
  ],
  deploying: [deploying("c:deploying"), pending("d:pending"), inSync("e:calm")],
  pending: [pending("d:pending"), inSync("e:calm")],
  "first-run": [],
  "in-sync": [inSync("e:calm"), inSync("f:calm")],
};

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

const paragraphs = (body: string) => body.split("\n\n");
const headings = (body: string) => body.split("\n").filter((line) => line.startsWith("## "));

function lineUnderPending(body: string): string {
  const all = paragraphs(body);
  return all[all.indexOf("## Pending") + 1] ?? "";
}

describe("the picture", () => {
  // The alt texts of record 0031 and the file names of record 0033.
  const ALT: Record<HeaderState, string> = {
    "first-run": "Sluiceway: no stacks yet",
    "in-sync": "Sluiceway: everything is in sync",
    pending: "Sluiceway: changes are pending",
    deploying: "Sluiceway: deploying",
    failing: "Sluiceway: something failed",
    plain: "Sluiceway",
  };

  test.each([...HEADER_STATES])("%s", (state) => {
    const body = renderBody(input(DASHBOARDS[state]));
    expect(paragraphs(body)[1]).toBe(
      [
        "<picture>",
        `  <source media="(prefers-color-scheme: dark)" srcset="${IMAGES}/${state}-dark.svg">`,
        `  <img alt="${ALT[state]}" width="440" src="${IMAGES}/${state}-light.svg">`,
        "</picture>",
      ].join("\n"),
    );
  });

  test("is served from the exact ref it is given, a commit SHA as well", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const body = renderBody(input(DASHBOARDS.pending, { actionRef: sha }));
    expect(body).toContain(
      `src="https://raw.githubusercontent.com/sluiceway/sluiceway/${sha}/assets/mascot/pending-light.svg"`,
    );
    expect(body).toEndWith(
      "<sub>[Sluiceway](https://github.com/sluiceway/sluiceway) `0123456` · [docs](https://github.com/sluiceway/sluiceway#readme)</sub>",
    );
  });

  test("a redacted dashboard gets the same header", () => {
    const blocks = (redact: boolean) => rows58().map((row) => rowBlock(row, { redact }));
    const [, picture, counts] = paragraphs(renderBody({ ...input([]), rows: blocks(true) }));
    expect(paragraphs(renderBody({ ...input([]), rows: blocks(false) })).slice(1, 3)).toEqual([
      picture ?? "",
      counts ?? "",
    ]);
  });
});

describe("the counts line", () => {
  // The line record 0029 was judged on, from the same made-up dashboard.
  test("the 58 stack fixture", () => {
    const body = renderBody({ ...input([]), rows: rows58().map((row) => rowBlock(row)) });
    expect(paragraphs(body)[2]).toBe(
      "**11 pending** · 2 deploying · 2 preview failed · 43 in sync · :warning: **4 pending stacks destroy resources** · 2 failed deploys",
    );
  });

  test("keeps its shape when every count is 0", () => {
    expect(paragraphs(renderBody(input([])))[2]).toBe(
      "**0 pending** · 0 deploying · 0 preview failed · 0 in sync",
    );
  });

  test("one of each", () => {
    const rows = [
      { ...pending("a", ["delete"]), failure: FAILURE },
      deploying("b", 3),
      previewFailed("c"),
      inSync("d"),
    ];
    expect(paragraphs(renderBody(input(rows)))[2]).toBe(
      "**1 pending** · 1 deploying · 1 preview failed · 1 in sync · :warning: **1 pending stack destroys resources** · 1 failed deploy",
    );
  });
});

describe("the scan line", () => {
  test("leaves the last full scan out when the root marker does not hold it", () => {
    const { fullScanAt: _at, fullScanRun: _run, ...root } = ROOT;
    expect(paragraphs(renderBody(input([], { root })))[3]).toBe(
      `Scanned [\`8c41f0e\`](${REPO_URL}/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](${RUN_URL})`,
    );
  });

  // A writer other than the scan takes the root facts from the live body,
  // which anyone with write access can edit.
  test("root facts that were edited by hand cannot break out of the line or throw", () => {
    const root = {
      scanSha: "`](x) **",
      scanRun: "1) [x](y",
      scanAt: "yesterday",
      fullScanAt: "never",
    };
    expect(paragraphs(renderBody(input([], { root })))[3]).toBe(
      `Scanned [\`&#96;&#93;(x) &#42;\`](${REPO_URL}/commit/%60%5D%28x%29%20%2A%2A) · [run](${REPO_URL}/actions/runs/1%29%20%5Bx%5D%28y)`,
    );
  });

  // Record 0028. The words are the ones the owner judged on the over budget
  // prototype. The count comes from the row markers, because that is all a
  // writer other than the scan can read (record 0009).
  test("the note about shortened rows sits directly under it", () => {
    const blocks = [
      rowBlock(pending("a"), { level: 3 }),
      rowBlock(pending("b")),
      rowBlock(pending("c"), { level: 1 }),
      rowBlock(inSync("d")),
    ];
    const all = paragraphs(renderBody(input([], { rows: blocks })));
    expect(all[4]).toBe(
      "> [!NOTE]\n> This dashboard is too large for one issue, so 2 of 3 pending rows are shortened. The summary that a shortened row links to shows every change. Deletes and replaces are the last thing to be cut.",
    );
    expect(all[5]).toBe("## Pending");
  });

  test("the note counts one row and one pending row in the singular", () => {
    const one = renderBody(input([], { rows: [rowBlock(pending("a"), { level: 2 })] }));
    expect(paragraphs(one)[4]).toStartWith(
      "> [!NOTE]\n> This dashboard is too large for one issue, so 1 of 1 pending row is shortened. ",
    );
    const two = renderBody(
      input([], { rows: [rowBlock(pending("a"), { level: 2 }), rowBlock(pending("b"))] }),
    );
    expect(paragraphs(two)[4]).toContain("so 1 of 2 pending rows is shortened.");
  });

  test("a body with every row in full has no note", () => {
    expect(renderBody(input(DASHBOARDS.pending))).not.toContain("[!NOTE]");
  });

  // Slice 1.7 found that the note would vanish the first time `resolve`
  // re-renders. A writer that holds nothing but the live body keeps it.
  test("the note survives a writer that only has the row blocks", () => {
    const body = renderBody(
      input([], { rows: [rowBlock(pending("a"), { level: 3 }), rowBlock(pending("b"))] }),
    );
    expect(body).toContain("1 of 2 pending rows is shortened");
    expect(renderBody(input([], { rows: parseDashboard(body).rows }))).toBe(body);
  });

  test("only a pending row counts as shortened", () => {
    const carried = parseDashboard(
      [
        '- **a** · deploying <!-- sluiceway:row stack="a" state="deploying" shortened="3" -->',
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    ).rows;
    expect(renderBody(input([], { rows: carried }))).not.toContain("[!NOTE]");
  });
});

describe("the sections", () => {
  test("Pending is always shown, every other section only when it has rows", () => {
    expect(headings(renderBody(input([])))).toEqual(["## Pending"]);
    expect(headings(renderBody(input(DASHBOARDS["in-sync"])))).toEqual([
      "## Pending",
      "## In sync",
    ]);
    expect(headings(renderBody(input([deploying("a")])))).toEqual(["## Pending", "## Deploying"]);
    expect(headings(renderBody(input(DASHBOARDS.failing, { recentlyDeployed: RECENT })))).toEqual([
      "## Pending",
      "## Deploying",
      "## Preview failed",
      "## In sync",
      "## Recently deployed",
    ]);
  });

  test("inside a section rows are sorted by stack id, by code unit", () => {
    const ids = ["b", "a:prod", "B", "a/x", "ä", "a"];
    const body = renderBody(input(ids.map((id) => pending(id))));
    expect(parseDashboard(body).rows.map((row) => row.stackId)).toEqual([
      "B",
      "a",
      "a/x",
      "a:prod",
      "b",
      "ä",
    ]);
  });

  test("a row with a delete is not moved to the top of Pending", () => {
    const body = renderBody(input([pending("a"), pending("b", ["delete"]), pending("c")]));
    expect(parseDashboard(body).rows.map((row) => row.stackId)).toEqual(["a", "b", "c"]);
  });

  test("the preview failed section says what its rows cannot do", () => {
    const all = paragraphs(renderBody(input([previewFailed("a")])));
    expect(all[all.indexOf("## Preview failed") + 1]).toBe(
      "These stacks could not be previewed, so they cannot be deployed from here until a scan succeeds.",
    );
  });
});

describe("the in sync section", () => {
  test("is a fold", () => {
    const all = paragraphs(renderBody(input([inSync("a"), inSync("b")])));
    const at = all.indexOf("## In sync");
    expect(all.slice(at + 1, at + 4)).toEqual([
      "<details><summary>2 stacks in sync</summary>",
      `${rowBlock(inSync("a")).text}\n${rowBlock(inSync("b")).text}`,
      "</details>",
    ]);
  });

  // The 58 stack fixture has one: data/warehouse:prod.
  test("a row with a failure line is listed open, above the fold", () => {
    const all = paragraphs(
      renderBody({ ...input([]), rows: rows58().map((row) => rowBlock(row)) }),
    );
    const at = all.indexOf("## In sync");
    expect(all[at + 1]).toStartWith("- data/warehouse:prod <!-- sluiceway:row");
    expect(all[at + 1]).toContain(":x: last deploy failed");
    expect(all[at + 2]).toBe("<details><summary>42 more in sync</summary>");
    expect(all[at + 3]?.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(42);
    expect(all[at + 3]).not.toContain("data/warehouse:prod");
  });

  test("has no fold when every row in it has a failure line", () => {
    const body = renderBody(input([{ ...inSync("a"), failure: FAILURE }]));
    expect(body).toContain("## In sync");
    expect(body).not.toContain("<details>");
  });
});

describe("recently deployed", () => {
  test("a plain list, newest first", () => {
    const all = paragraphs(
      renderBody(input(DASHBOARDS["in-sync"], { recentlyDeployed: [...RECENT].reverse() })),
    );
    expect(all[all.indexOf("## Recently deployed") + 1]).toBe(
      [
        `- apps/auth:prod · ticked by alice · 2026-09-21 09:41 UTC · [run](${REPO_URL}/actions/runs/17034388102)`,
        `- apps/auth:staging · ticked by alice · 2026-09-21 09:12 UTC · [run](${REPO_URL}/actions/runs/17034120455)`,
        `- platform/external-dns:prod · ticked by carol · 2026-09-20 17:30 UTC · [run](${REPO_URL}/actions/runs/17029910331)`,
      ].join("\n"),
    );
  });

  test("the newest 10 and no more", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      stackId: `stack-${index}`,
      ticker: "alice",
      at: new Date(Date.UTC(2026, 8, 1 + index, 12)),
      runUrl: "run-url",
    }));
    const all = paragraphs(renderBody(input([], { recentlyDeployed: many })));
    const lines = all[all.indexOf("## Recently deployed") + 1]?.split("\n") ?? [];
    expect(lines).toHaveLength(10);
    expect(lines[0]).toStartWith("- stack-11 ·");
    expect(lines[9]).toStartWith("- stack-2 ·");
  });

  test("two deploys in the same millisecond are ordered by stack id", () => {
    const at = new Date("2026-09-21T09:41:07Z");
    const twins = ["b", "a"].map((stackId) => ({ stackId, ticker: "x", at, runUrl: "u" }));
    const body = renderBody(input([], { recentlyDeployed: twins }));
    expect(body.indexOf("- a ·")).toBeLessThan(body.indexOf("- b ·"));
    expect(body).toBe(renderBody(input([], { recentlyDeployed: [...twins].reverse() })));
  });

  test("a stack id and a login are never trusted as markup", () => {
    const hostile = [{ stackId: "a*b", ticker: "<x>", at: new Date(0), runUrl: "u" }];
    expect(renderBody(input([], { recentlyDeployed: hostile }))).toContain(
      "- a&#42;b · ticked by &lt;x&gt; · 1970-01-01 00:00 UTC · [run](u)",
    );
  });
});

// Records 0032 and 0034: which words stand under the Pending heading.
describe("the line under the Pending heading", () => {
  const INSTRUCTION = "Tick a box to deploy that stack exactly as its row shows it.";
  const cases: [string, Row[], string, string][] = [
    [
      "in sync",
      DASHBOARDS["in-sync"],
      "Gate closed, water calm. Nothing to deploy.",
      "Nothing to deploy. All 2 stacks are in sync.",
    ],
    [
      "first run",
      [],
      "The channel is dry. Add a stack to `sluiceway.yaml` and the next scan fills it.",
      "No stacks found yet. Add one to `sluiceway.yaml` and the next scan lists it here.",
    ],
    ["pending", DASHBOARDS.pending, INSTRUCTION, INSTRUCTION],
    ["deploying with rows pending", DASHBOARDS.deploying, INSTRUCTION, INSTRUCTION],
    ["failing with rows pending", DASHBOARDS.failing, INSTRUCTION, INSTRUCTION],
    ["plain with rows pending", DASHBOARDS.plain, INSTRUCTION, INSTRUCTION],
    [
      "failing with nothing pending",
      [previewFailed("a"), inSync("b")],
      "Nothing to deploy.",
      "Nothing to deploy.",
    ],
    [
      "deploying with nothing pending",
      [deploying("a"), inSync("b")],
      "Nothing to deploy.",
      "Nothing to deploy.",
    ],
    [
      "plain with nothing pending",
      [deploying("a", 1), inSync("b")],
      "Nothing to deploy.",
      "Nothing to deploy.",
    ],
  ];

  test.each(cases)("%s", (_name, rows, withPersonality, without) => {
    expect(lineUnderPending(renderBody(input(rows)))).toBe(withPersonality);
    expect(lineUnderPending(renderBody(input(rows, { personality: false })))).toBe(without);
  });
});

describe("dashboard.personality: false", () => {
  test("the root marker is followed directly by the counts line", () => {
    const all = paragraphs(renderBody(input(DASHBOARDS.pending, { personality: false })));
    expect(all[0]).toStartWith("<!-- sluiceway:dashboard ");
    expect(all[1]).toBe("**1 pending** · 0 deploying · 0 preview failed · 1 in sync");
  });

  test("nothing else changes", () => {
    for (const state of HEADER_STATES) {
      const on = paragraphs(renderBody(input(DASHBOARDS[state], { recentlyDeployed: RECENT })));
      const off = paragraphs(
        renderBody(input(DASHBOARDS[state], { recentlyDeployed: RECENT, personality: false })),
      );
      const voiced = on.indexOf("## Pending") + 1;
      expect(on[1]).toStartWith("<picture>");
      expect(off.join("\n")).not.toContain("<picture>");
      expect(off.filter((_, index) => index !== voiced - 1)).toEqual(
        on.filter((_, index) => index !== 1 && index !== voiced),
      );
    }
  });
});

describe("a row of a state this version does not know", () => {
  const later: ParsedRow = {
    known: false,
    stackId: "apps/later:prod",
    state: "drift",
    text: '- [x] **apps/later:prod** · drifted <!-- sluiceway:row stack="apps/later:prod" state="drift" -->\n  anything at all\n  <!-- /sluiceway:row -->',
  };

  test("is placed at the end of the body, byte for byte, and left out of the counts", () => {
    const base = input(DASHBOARDS.pending);
    const body = renderBody({ ...base, rows: [later, ...base.rows] });
    expect(body).toBe(`${renderBody(base)}\n\n${later.text}`);
    expect(parseDashboard(body).rows.at(-1)).toEqual(later);
    expect(parseDashboard(body).rescanTicked).toBe(false);
  });

  // In sync is a claim about every stack, and this one is not known to be calm.
  test("takes the voice and the count of stacks out of the good-news line", () => {
    for (const personality of [true, false]) {
      const base = input(DASHBOARDS["in-sync"], { personality });
      const body = renderBody({ ...base, rows: [...base.rows, later] });
      expect(lineUnderPending(body)).toBe("Nothing to deploy.");
    }
  });
});

const ALL_BODIES = (): [string, BodyInput][] => [
  ...HEADER_STATES.flatMap((state): [string, BodyInput][] => [
    [state, input(DASHBOARDS[state], { recentlyDeployed: RECENT })],
    [
      `${state}, no personality`,
      input(DASHBOARDS[state], { recentlyDeployed: RECENT, personality: false }),
    ],
  ]),
  [
    "58 stacks",
    { ...input([], { recentlyDeployed: RECENT }), rows: rows58().map((r) => rowBlock(r)) },
  ],
  [
    "58 stacks, redacted",
    { ...input([]), rows: rows58().map((row) => rowBlock(row, { redact: true })) },
  ],
  ["100 stacks", { ...input([]), rows: rows100().map((row) => rowBlock(row, { level: 3 })) }],
];

// What must hold for every body a writer ever renders.
describe("every rendered body", () => {
  test.each(ALL_BODIES())(
    "%s: the same input gives the same bytes, in any order of rows",
    (_name, body) => {
      const rendered = renderBody(body);
      expect(renderBody(body)).toBe(rendered);
      expect(
        renderBody({
          ...body,
          rows: [...body.rows].reverse(),
          recentlyDeployed: [...body.recentlyDeployed].reverse(),
        }),
      ).toBe(rendered);
    },
  );

  test.each(ALL_BODIES())(
    "%s: reads back as the root facts and the same row blocks",
    (_name, body) => {
      const parsed = parseDashboard(renderBody(body));
      expect(parsed.root).toEqual({ version: 1, ...ROOT });
      expect(parsed.rescanTicked).toBe(false);
      const sorted = [...body.rows].sort((a, b) => (a.stackId < b.stackId ? -1 : 1));
      expect([...parsed.rows].sort((a, b) => (a.stackId < b.stackId ? -1 : 1))).toEqual(sorted);
    },
  );

  // Rendering what was read gives the same body, which is what lets a writer
  // skip a write (record 0004).
  test.each(ALL_BODIES())("%s: rendering what was read changes nothing", (_name, body) => {
    const rendered = renderBody(body);
    expect(renderBody({ ...body, rows: parseDashboard(rendered).rows })).toBe(rendered);
  });

  test.each(ALL_BODIES())("%s: the shape of the text", (_name, body) => {
    const rendered = renderBody(body);
    expect(rendered).toStartWith("<!-- sluiceway:dashboard ");
    expect(rendered).not.toMatch(/\n\n\n|[ \t]\n|\r|\u2014/);
    expect(rendered).not.toMatch(/\s$/);
    expect(rendered).not.toContain("Penny");
    // The picture is a top level block followed by a blank line.
    if (body.personality) expect(rendered).toContain("</picture>\n\n**");
    // One rescan box, unticked.
    expect(rendered.match(/sluiceway:rescan/g)).toHaveLength(1);
    expect(rendered).toContain(
      "\n---\n\n- [ ] Rescan all stacks <!-- sluiceway:rescan -->\n\n<sub>",
    );
  });
});

describe("sizes", () => {
  // Record 0027 measured 37,607 characters for this dashboard.
  test("the 58 stack body is well under the target of 58,000 characters", () => {
    const body = renderBody({
      ...input([], { recentlyDeployed: RECENT }),
      rows: rows58().map((row) => rowBlock(row)),
    });
    expect(body.length).toBeGreaterThan(30_000);
    expect(body.length).toBeLessThan(45_000);
  });

  test("everything outside the row blocks is under 2,000 characters", () => {
    const rows = rows58().map((row) => rowBlock(row));
    const body = renderBody({ ...input([], { recentlyDeployed: RECENT }), rows });
    const inside = rows.reduce((sum, row) => sum + row.text.length + 1, 0);
    expect(body.length - inside).toBeLessThan(2_000);
  });
});

describe("snapshots", () => {
  for (const state of HEADER_STATES) {
    test(`header state ${state}`, () => {
      expect(
        `${renderBody(input(DASHBOARDS[state], { recentlyDeployed: RECENT }))}\n`,
      ).toMatchSnapshot();
    });
  }

  test("personality off, in sync", () => {
    expect(
      `${renderBody(input(DASHBOARDS["in-sync"], { personality: false }))}\n`,
    ).toMatchSnapshot();
  });

  test("personality off, first run", () => {
    expect(`${renderBody(input([], { personality: false }))}\n`).toMatchSnapshot();
  });

  test("personality off, failing", () => {
    expect(
      `${renderBody(input(DASHBOARDS.failing, { recentlyDeployed: RECENT, personality: false }))}\n`,
    ).toMatchSnapshot();
  });

  test("the 58 stack body", () => {
    expect(
      `${renderBody({ ...input([], { recentlyDeployed: RECENT }), rows: rows58().map((row) => rowBlock(row)) })}\n`,
    ).toMatchSnapshot();
  });

  test("the 58 stack body, redacted", () => {
    expect(
      `${renderBody({ ...input([], { recentlyDeployed: RECENT }), rows: rows58().map((row) => rowBlock(row, { redact: true })) })}\n`,
    ).toMatchSnapshot();
  });
});
