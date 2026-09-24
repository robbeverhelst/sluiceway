import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXAMPLE_FILE } from "../../scripts/example-dashboard.ts";
import { CANARY_SECRET, CANARY_VALUE } from "../../scripts/fixtures/example.ts";
import {
  exampleNames,
  LEFT_OUT,
  WRITTEN_PAGE,
  type WrittenExamples,
  withExamples,
  writtenExamples,
} from "../../scripts/written-examples.ts";
import { deploymentPayloadJsonSchema, deploymentPayloadSchema } from "../../src/core/deployment.ts";
import {
  bulkMarker,
  mergeMarker,
  outsideMarker,
  parseDashboard,
  RESCAN_MARKER,
  ROW_CLOSE_MARKER,
  rootMarker,
  rowMarker,
  waitingMarker,
} from "../../src/render/marker.ts";
import {
  applyResultSchema,
  resultFileJsonSchema,
  scanResultSchema,
} from "../../src/render/result-file.ts";
import { codeIn, fences, read, section, tableUnder } from "./docs.ts";

// Slice 5.33 (record 0096): the markers, the payload of a deployment record and
// the result file are a surface people and agents build on. The page that
// documents them takes every example from a run, and these tests hold the
// page to the code, so the two cannot drift apart.

const page = read(WRITTEN_PAGE);
let examples: WrittenExamples;

beforeAll(async () => {
  examples = await writtenExamples();
});

// The keys a marker holds, in the order it holds them.
function keysOf(marker: string): string[] {
  return [...marker.matchAll(/ ([^\s="]+)="/g)].map((match) => match[1] ?? "");
}

// The names in the first column of the table under a heading.
function documented(heading: string): string[] {
  return tableUnder(page, heading).flatMap((row) => codeIn(row[0] ?? ""));
}

describe("the examples on the page", () => {
  test("are what a run gives now, byte for byte", () => {
    expect(page).toBe(withExamples(page, examples));
  });

  test("are every example the generator gives, each once", () => {
    const named = [...page.matchAll(/^<!-- example: ([\w-]+) -->$/gm)].map((match) => match[1]);
    expect(named.sort()).toEqual(exampleNames(examples).sort());
  });

  test("hold no property value and no secret of the example project", () => {
    for (const text of Object.values(examples)) {
      expect(text).not.toContain(CANARY_VALUE);
      expect(text).not.toContain(CANARY_SECRET);
    }
  });

  test("come from the run and from the example dashboard, and nothing is written by hand", () => {
    const dashboard = read(EXAMPLE_FILE);
    for (const name of ["merge-row", "waiting-line", "bulk-box", "confirm-box", "outside-line"]) {
      expect(dashboard).toContain(examples[name] ?? "missing");
    }
    for (const line of (examples["row-markers"] ?? "").split("\n")) {
      expect(dashboard).toContain(line);
    }
  });
});

describe("a marker of each kind", () => {
  // Parsed and written again by the code, each example is itself: the page
  // shows exactly what the writers write.
  test("the root marker", () => {
    const line = examples["root-marker"] ?? "";
    const root = parseDashboard(line).root;
    expect(root).toBeDefined();
    expect(
      rootMarker({
        scanSha: root?.scanSha ?? "",
        scanRun: root?.scanRun ?? "",
        scanAt: root?.scanAt ?? "",
        fullScanAt: root?.fullScanAt,
        fullScanRun: root?.fullScanRun,
      }),
    ).toBe(line);
  });

  test("a row block", () => {
    const block = examples["row-block"] ?? "";
    const [row] = parseDashboard(block).rows;
    expect(row?.known).toBe(true);
    expect(row?.text).toBe(block);
    expect(block.split("\n").at(-1)?.trim()).toBe(ROW_CLOSE_MARKER);
  });

  test("the row markers", () => {
    for (const marker of (examples["row-markers"] ?? "").split("\n")) {
      const [row] = parseDashboard(`- x ${marker}\n  ${ROW_CLOSE_MARKER}`).rows;
      if (!row?.known) throw new Error(`Not a row: ${marker}`);
      expect(
        rowMarker({
          stackId: row.stackId,
          state: row.state,
          hash: row.hash,
          destroys: row.destroys,
          deletes: row.deletes,
          failed: row.failed,
          shortened: row.shortened,
          drift: row.drift,
          gone: row.gone,
          dependsOn: row.dependsOn,
          fingerprint: row.fingerprint,
        }),
      ).toBe(marker);
    }
  });

  test("a merge row, a waiting line, the boxes and an outside deploy", () => {
    const merge = parseDashboard(examples["merge-row"] ?? "").merges[0];
    expect(examples["merge-row"]).toEndWith(
      mergeMarker(merge ?? { pr: 0, stackIds: [], head: "" }),
    );
    const waiting = parseDashboard(examples["waiting-line"] ?? "").waiting[0];
    expect(examples["waiting-line"]).toEndWith(waitingMarker(waiting ?? { pr: 0, stackIds: [] }));
    for (const name of ["bulk-box", "confirm-box"]) {
      const [box] = parseDashboard((examples[name] ?? "").replace("- [ ]", "- [x]")).bulk;
      if (box === undefined) throw new Error(`Not a box: ${name}`);
      const { ticked: _ticked, text: _text, ...facts } = box;
      expect(examples[name]).toEndWith(bulkMarker(facts));
    }
    const [deploy] = parseDashboard(examples["outside-line"] ?? "").outside;
    if (deploy === undefined) throw new Error("Not an outside deploy");
    expect(examples["outside-line"]).toEndWith(outsideMarker(deploy));
    expect(examples["rescan-box"]).toEndWith(RESCAN_MARKER);
  });
});

// Every key a writer can write, with every optional fact set.
const WRITTEN_KEYS = {
  root: keysOf(
    rootMarker({
      scanSha: "a",
      scanRun: "1",
      scanAt: "t",
      fullScanAt: "t",
      fullScanRun: "1",
      waitingRun: { run: "2", since: "t", more: 1 },
    }),
  ),
  row: keysOf(
    rowMarker({
      stackId: "a",
      state: "drift",
      hash: "h",
      destroys: 1,
      deletes: 1,
      failed: true,
      shortened: 1,
      drift: true,
      gone: 1,
      dependsOn: ["b"],
      fingerprint: "f",
      policyFailed: true,
    }),
  ),
  merge: keysOf(mergeMarker({ pr: 1, stackIds: ["a"], head: "h" })),
  waiting: keysOf(waitingMarker({ pr: 1, stackIds: ["a"] })),
  bulk: [
    ...new Set([
      ...keysOf(
        bulkMarker({
          kind: "box",
          section: "pending",
          note: { kind: "changed", added: ["a"], gone: ["b"], moved: ["c"] },
        }),
      ),
      ...keysOf(
        bulkMarker({
          kind: "confirm",
          section: "drift",
          by: "a",
          stacks: [{ stackId: "a", hash: "h" }],
          scanRun: "1",
        }),
      ),
    ]),
  ],
  rescan: keysOf(RESCAN_MARKER),
  outside: keysOf(
    outsideMarker({ stackId: "a", kind: "deploy", at: new Date(0), commit: "c", dirty: true }),
  ),
};

const MARKER_HEADINGS: Record<keyof typeof WRITTEN_KEYS, string> = {
  root: "### The root marker",
  row: "### A row",
  merge: "### An update waiting to merge",
  waiting: "### An update waiting on its checks",
  bulk: "### A bulk box",
  rescan: "### The rescan box",
  outside: "### A deploy outside the dashboard",
};

describe("the keys of each marker kind", () => {
  for (const [kind, heading] of Object.entries(MARKER_HEADINGS) as [
    keyof typeof WRITTEN_KEYS,
    string,
  ][]) {
    test(`${kind}: the page documents every key a writer writes, except the ones left out on purpose`, () => {
      const left: readonly string[] = LEFT_OUT[kind];
      expect(documented(heading)).toEqual(WRITTEN_KEYS[kind].filter((key) => !left.includes(key)));
      for (const key of left) expect(WRITTEN_KEYS[kind]).toContain(key);
    });
  }

  test("the page says which keys are left out, and why", () => {
    const left = section(page, "## What is left out on purpose");
    for (const keys of Object.values(LEFT_OUT)) {
      for (const key of keys) expect(left).toContain(`\`${key}\``);
    }
  });
});

describe("the deployment record", () => {
  type Schema = { properties?: Record<string, unknown>; anyOf?: Schema[] };
  const schema = deploymentPayloadJsonSchema() as Schema;
  const keys = [
    ...new Set(
      (schema.anyOf ?? [schema]).flatMap((branch) => Object.keys(branch.properties ?? {})),
    ),
  ];

  test("the page documents every key of the payload's schema", () => {
    expect(documented("### The payload").sort()).toEqual(keys.sort());
  });

  test("every payload on the page fits the schema", () => {
    const payloads = (examples.payloads ?? "").split("\n").filter(Boolean);
    expect(payloads.length).toBeGreaterThanOrEqual(5);
    for (const payload of payloads) {
      expect(deploymentPayloadSchema.safeParse(JSON.parse(payload)).success).toBe(true);
    }
    const record = JSON.parse(examples.record ?? "") as { payload: unknown };
    expect(deploymentPayloadSchema.safeParse(record.payload).success).toBe(true);
  });

  test("the page links the published schema", () => {
    expect(page).toContain("../schema/deployment-payload.schema.json");
  });
});

describe("the result file", () => {
  type Node = {
    properties?: Record<string, Node>;
    items?: Node;
    anyOf?: Node[];
    oneOf?: Node[];
  };
  // Every field of a schema as a dotted path, a list written `[]`.
  function paths(node: Node, prefix = ""): string[] {
    const found: string[] = [];
    for (const branch of node.anyOf ?? []) found.push(...paths(branch, prefix));
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      found.push(path, ...paths(child, path));
    }
    if (node.items) found.push(...paths(node.items, `${prefix}[]`));
    return [...new Set(found)];
  }
  const [scanFile, applyFile] = ((resultFileJsonSchema() as Node).oneOf ?? []) as [Node, Node];
  const under = (all: string[], prefix: string) =>
    all.filter((path) => path.startsWith(prefix)).map((path) => path.slice(prefix.length));
  const nested = (path: string) => /^(changes|drift)\[\]\./.test(path);

  test("the page documents every field of a scan's file", () => {
    const all = paths(scanFile);
    expect(documented("#### The file of a scan").sort()).toEqual(
      all.filter((path) => !path.startsWith("stacks[].")).sort(),
    );
    const stack = under(all, "stacks[].").filter((path) => !nested(path));
    expect([...documented("#### A scanned stack"), ...documented("#### A preview")].sort()).toEqual(
      stack.sort(),
    );
  });

  test("the page documents every field of an apply's file, a preview and a change", () => {
    const all = paths(applyFile);
    const top = all.filter((path) => !/^(preview|after)\./.test(path));
    expect(documented("#### The file of an apply").sort()).toEqual(top.sort());
    const preview = under(all, "preview.").filter((path) => !nested(path));
    expect(documented("#### A preview").sort()).toEqual(preview.sort());
    expect(documented("#### A change").sort()).toEqual(under(all, "preview.changes[].").sort());
  });

  test("every file on the page fits the schema", () => {
    expect(scanResultSchema.safeParse(JSON.parse(examples["scan-result"] ?? "")).success).toBe(
      true,
    );
    for (const name of ["apply-result", "apply-result-failed"]) {
      expect(applyResultSchema.safeParse(JSON.parse(examples[name] ?? "")).success).toBe(true);
    }
  });
});

describe("the worked examples", () => {
  function fenceUnder(heading: string): string {
    const [fence] = fences(section(page, heading)).filter(({ language }) => language === "sh");
    if (fence === undefined) throw new Error(`No sh block under ${heading}`);
    return fence.text;
  }

  function sh(script: string, env: Record<string, string> = {}): string {
    const run = spawnSync("bash", ["-euo", "pipefail", "-c", script], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...env },
    });
    if (run.status !== 0) throw new Error(run.stderr);
    return run.stdout;
  }

  test("what is waiting, read from the body alone, is what Sluiceway reads", () => {
    const script = fenceUnder("### What is waiting, from the dashboard alone");
    const [fetch, ...rest] = script.trimEnd().split("\n");
    expect(fetch).toContain("gh issue view");
    const body = read(EXAMPLE_FILE);
    const found = sh(`cat "$BODY" |\n${rest.join("\n")}`, { BODY: join(root(), "body.md") });
    const pending = parseDashboard(body).rows.flatMap((row) =>
      row.known && row.state === "pending" ? [row.stackId] : [],
    );
    expect(found.trim().split("\n")).toEqual(pending);

    function root(): string {
      const dir = mkdtempSync(join(tmpdir(), "sluiceway-waiting-"));
      writeFileSync(join(dir, "body.md"), body);
      return dir;
    }
  });

  test("the step that reads the result file reads the file of the run", () => {
    const [fence] = fences(section(page, "### Read the result file in a later step")).filter(
      ({ language }) => language === "yaml",
    );
    const step = Bun.YAML.parse(fence?.text ?? "") as {
      env: Record<string, string>;
      run: string;
    }[];
    const dir = mkdtempSync(join(tmpdir(), "sluiceway-result-"));
    const file = join(dir, "sluiceway-scan-result.json");
    writeFileSync(file, examples["scan-result"] ?? "");
    const out = sh(step[0]?.run ?? "", { RESULT_FILE: file });
    expect(out.trim()).toBe("network:dev: 4 to create, 0 to update, 0 to replace, 0 to delete");
  });
});
