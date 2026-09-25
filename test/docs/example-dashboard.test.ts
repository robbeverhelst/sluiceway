import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import {
  EXAMPLE,
  EXAMPLE_FILE,
  exampleActionRef,
  exampleBody,
  readmeExample,
  readmeExampleSpan,
  withHardBreaks,
  withReadmeExample,
} from "../../scripts/example-dashboard.ts";
import { renderBody, rowBlock } from "../../src/render/body.ts";
import { renderBulkLine } from "../../src/render/bulk-box.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { mergeBlock } from "../../src/render/merge-row.ts";
import { waitingBlock } from "../../src/render/waiting-line.ts";
import { ROOT, read } from "./docs.ts";

// The example dashboard (slice 5.24, record 0088): the whole body the
// renderer gives for the made-up rows of scripts/example-dashboard.ts,
// committed where another site can fetch it raw at a release tag, and the
// same dashboard in the README. `bun run example` writes both. They cannot
// fall behind the renderer the way the README's copy did before (slice 2.15,
// record 0047) and the landing page's hand-kept copy did after.

const published = existsSync(resolve(ROOT, EXAMPLE_FILE)) ? read(EXAMPLE_FILE) : "";

describe("the published example dashboard", () => {
  test("is what the renderer gives for the example rows", () => {
    expect(published).not.toBe("");
    expect(published).toBe(`${exampleBody()}\n`);
  });
});

// The headings of the body in the order a reader meets them.
const headings = (body: string) => [...body.matchAll(/^#+ (.+)$/gm)].map((match) => match[1] ?? "");

const version = JSON.parse(read("package.json")).version as string;
const IMAGES = `https://raw.githubusercontent.com/sluiceway/sluiceway/v${version}/assets/mascot`;

describe("what the example shows", () => {
  const body = exampleBody();

  // Build plan, section 3: the pictures and the footer name the exact tag of
  // the version, and release-please bumps the version, so the release tag
  // names itself.
  test("names this version in its pictures and its footer", () => {
    expect(exampleActionRef()).toBe(`v${version}`);
    const urls = [...body.matchAll(/https:\/\/raw\.githubusercontent\.com\/[^"]+/g)].map(
      (match) => match[0],
    );
    expect(urls.length).toBeGreaterThan(2);
    for (const url of urls) expect(url.startsWith(`${IMAGES}/`)).toBe(true);
    expect(body).toContain(`[Sluiceway](https://github.com/sluiceway/sluiceway) v${version} · `);
  });

  // The README's copy once named a picture its tag did not hold.
  test("names only pictures this checkout holds", () => {
    const files = [...body.matchAll(/\/assets\/mascot\/([^"]+)"/g)].map((match) => match[1]);
    const missing = files.filter((file) => !existsSync(resolve(ROOT, `assets/mascot/${file}`)));
    expect(missing).toEqual([]);
  });

  // Record 0063: deploying sits at the top, each row with the spinner. The
  // queued row's crate stands still (record 0098).
  test("lists the deploying rows first, each with the spinner", () => {
    expect(headings(body)).toEqual([
      "Deploying",
      "Updates waiting to merge",
      "Pending",
      "Drifted",
      "In sync",
      "Recently deployed",
    ]);
    const deploying = body.slice(body.indexOf("## Deploying"), body.indexOf("## Updates"));
    const rows = deploying.split("\n").filter((line) => line.startsWith("- "));
    expect(rows.length).toBe(2);
    const [running, queued] = rows;
    expect(running).toContain(`${IMAGES}/spinner-light.svg`);
    expect(running).toContain("· deploying ·");
    expect(queued).toContain(`${IMAGES}/spinner-queued-light.svg`);
    expect(queued).toContain("· queued behind **");
  });

  // Records 0047, 0066 and 0075: one crate per pending stack, and both signs
  // while a delete and a replace wait.
  test("shows the crates and both signs in the header picture", () => {
    const pending = Number(body.match(/\*\*(\d+) pending\*\*/)?.[1]);
    expect(pending).toBeGreaterThan(1);
    expect(body).toContain(`${IMAGES}/deploying-${pending}-deletes-replaces-light.svg`);
    expect(body).toContain(`${IMAGES}/deploying-${pending}-deletes-replaces-dark.svg`);
    expect(body).toContain("<kbd>DELETE</kbd>");
    expect(body).toContain("<kbd>REPLACE</kbd>");
    expect(body).toContain("> [!CAUTION]");
  });

  // Records 0054, 0071 and 0081.
  test("has a merge and deploy row and an update waiting on its checks", () => {
    expect(body).toMatch(/^- \[ \] .* · preview after the merge: .*<!-- sluiceway:merge /m);
    expect(body).toMatch(/^- \*\*.* · waits on its checks <!-- sluiceway:waiting /m);
  });

  // Record 0083: the bulk box under pending, a confirm box under drift.
  test("has a bulk box and a confirm box", () => {
    expect(body).toMatch(/^- \[ \] Deploy all \d+ pending stacks <!-- sluiceway:bulk /m);
    expect(body).toMatch(/^- \[ \] \*\*Confirm:\*\* repair all \d+ drifted stacks: .* asked by /m);
  });

  test("folds in sync and the stacks left out by ignore", () => {
    expect(body).toMatch(/<details><summary>\d+ stacks in sync<\/summary>/);
    expect(body).toMatch(/<details><summary>1 stack left out by ignore<\/summary>/);
  });

  // Records 0062, 0072 and 0073.
  test("has a trail with shipped lines, an outside deploy and a failed deploy", () => {
    const trail = body.slice(body.indexOf("## Recently deployed"), body.indexOf("\n---\n"));
    expect(trail).toMatch(/^ {2}shipped #\d+ by /m);
    expect(trail).toContain("deployed outside the dashboard, from ");
    expect(trail).toContain(" · failed · ");
    expect(trail).toContain(" · drift fixed · ");
    expect(trail).toContain(" · no changes · ");
  });

  test("ends with the rescan box and the footer", () => {
    expect(body).toMatch(
      /\n---\n\n- \[ \] Rescan all stacks <!-- sluiceway:rescan -->\n\n<sub>\[Sluiceway\]\([^)]+\) v[\d.]+ · \[docs\]\(https:\/\/docs\.sluiceway\.dev\/\)<\/sub>$/,
    );
  });

  // Record 0088: made up, so there is nothing to keep out. No real
  // organization: the repo is example-org's.
  test("names no real repo but the example one and Sluiceway's own", () => {
    const repos = new Set(
      [...body.matchAll(/https:\/\/github\.com\/([^/)\s"]+\/[^/)\s"]+)/g)].map((match) => match[1]),
    );
    expect([...repos].sort()).toEqual(["example-org/infra", "sluiceway/sluiceway"]);
  });
});

// Record 0110: the example is data first, so a reader can redraw it whole
// with the renderer, under any setting, instead of taking it through its
// markers, which lose the made-up changes and the trail's lines.
describe("the example as data", () => {
  test("exports its rows, trail and outside deploys, and the renderer gives the published body from them", () => {
    const ids = EXAMPLE.rows.map((row) => ("diff" in row ? row.diff.stackId : row.stackId));
    expect(ids).toHaveLength(16);
    expect(new Set(ids).size).toBe(16);
    expect(EXAMPLE.recentlyDeployed).toHaveLength(5);
    expect(EXAMPLE.outsideDeploys).toHaveLength(1);
    const actionRef = exampleActionRef();
    const body = renderBody({
      root: EXAMPLE.root,
      rows: EXAMPLE.rows.map((row) => rowBlock(row, { actionRef })),
      recentlyDeployed: EXAMPLE.recentlyDeployed,
      outsideDeploys: EXAMPLE.outsideDeploys,
      repoUrl: EXAMPLE.repoUrl,
      actionRef,
      personality: true,
      ignored: EXAMPLE.ignored,
      merges: EXAMPLE.merges.map((row) => mergeBlock(row)),
      waiting: EXAMPLE.waiting.map((line) => waitingBlock(line)),
      bulk: {
        on: true,
        live: parseDashboard(renderBulkLine({ ...EXAMPLE.confirm, ticked: false })).bulk,
      },
    });
    expect(`${body}\n`).toBe(read(EXAMPLE_FILE));
  });

  test("redraws under another setting: redacted, without personality, in a zone, read only", () => {
    const body = exampleBody(exampleActionRef(), {
      redact: true,
      personality: false,
      timeZone: "Europe/Brussels",
      readOnly: true,
    });
    for (const row of EXAMPLE.rows) {
      expect(body).toContain("diff" in row ? row.diff.stackId : row.stackId);
    }
    expect(body).not.toContain("raw.githubusercontent.com");
    expect(body).not.toContain("kubernetes:apps/v1:Deployment");
    for (const row of parseDashboard(body).rows) expect(row.text).not.toStartWith("- [ ] ");
    expect(body).not.toContain("Rescan all stacks");
    expect(body).toContain("Times are in Europe/Brussels");
    expect(body).not.toBe(exampleBody());
  });
});

// Slice 5.51 (record 0114): the generator draws the example under each
// layout key, one test per key. Every redraw holds every row block of the
// example, so every marker, and changes what its key says and nothing more.
describe("the example under each layout key", () => {
  const ref = exampleActionRef();
  const every = parseDashboard(exampleBody())
    .rows.map((row) => row.stackId)
    .sort();
  const redraw = (settings: Parameters<typeof exampleBody>[1]) => {
    const body = exampleBody(ref, settings);
    expect(
      parseDashboard(body)
        .rows.map((row) => row.stackId)
        .sort(),
    ).toEqual(every);
    expect(body).not.toBe(exampleBody());
    return body;
  };
  const sections = (body: string) => headings(body).filter((one) => one !== "Recently deployed");

  test("the defaults named one by one draw the published example", () => {
    expect(
      exampleBody(ref, {
        sections: [
          "deploying",
          "updates",
          "pending",
          "drifted",
          "previewFailed",
          "inSync",
          "recentlyDeployed",
        ],
        deployingSection: true,
        driftedSection: true,
        inSyncSection: "fold",
        zeroCounts: true,
        destroyAlert: "destroys",
        pendingDetail: "full",
        deployAll: true,
        repairAll: true,
        rescanBox: true,
        footer: true,
      }),
    ).toBe(exampleBody());
  });

  test("sections", () => {
    const body = redraw({ sections: ["inSync", "pending"] });
    expect(sections(body).slice(0, 3)).toEqual(["In sync", "Pending", "Deploying"]);
  });

  test("deployingSection", () => {
    const body = redraw({ deployingSection: false });
    expect(headings(body)).not.toContain("Deploying");
    expect(body).toContain("in sections this dashboard does not show</summary>");
  });

  test("driftedSection", () => {
    const body = redraw({ driftedSection: false });
    expect(body).not.toContain("Repair all");
    expect(body).not.toContain("**Confirm:**");
  });

  test("inSyncSection", () => {
    expect(redraw({ inSyncSection: "list" })).not.toMatch(
      /<summary>\d+ stacks? in sync<\/summary>/,
    );
    expect(redraw({ inSyncSection: "off" })).not.toContain("left out by ignore");
  });

  test("zeroCounts", () => {
    // The example has no preview failure (record 0088).
    expect(redraw({ zeroCounts: false })).not.toContain("0 preview failed");
  });

  test("destroyAlert", () => {
    // The example has pending destroys, so always draws the caution it has.
    expect(exampleBody(ref, { destroyAlert: "always" })).toBe(exampleBody());
    expect(exampleBody()).toContain("> [!CAUTION]");
  });

  test("pendingDetail", () => {
    const compact = redraw({ pendingDetail: "compact" });
    expect(compact).toContain("<kbd>DELETE</kbd>");
    // A pending row's attribution line goes; a deploying row keeps its own.
    const pendingFrom = "  from #514 by erin, #511 by renovate&#91;bot&#93;";
    expect(exampleBody()).toContain(pendingFrom);
    expect(compact).not.toContain(pendingFrom);
    const names = redraw({ pendingDetail: "names" });
    expect(names).toContain("<kbd>DELETE</kbd>");
  });

  test("deployAll", () => {
    expect(redraw({ deployAll: false })).not.toContain("Deploy all");
  });

  test("repairAll", () => {
    expect(redraw({ repairAll: false })).not.toContain("**Confirm:**");
  });

  test("rescanBox", () => {
    expect(redraw({ rescanBox: false })).not.toContain("Rescan all stacks");
  });

  test("footer", () => {
    expect(redraw({ footer: false })).not.toContain("<sub>[Sluiceway]");
  });
});

describe("the example dashboard in the README", () => {
  const readme = read("README.md");
  const span = readmeExampleSpan(readme);
  const shown = span === undefined ? "" : readme.slice(span.start, span.end);
  const folded = shown.slice(shown.indexOf("<details>"));

  test("is the published example made fit for the README", () => {
    expect(shown).not.toBe("");
    expect(shown).toBe(readmeExample());
  });

  // Record 0097: a reader who never opens the fold still sees the crates, the
  // signs and the counts.
  test("keeps the header picture and the counts line open, above the fold", () => {
    const open = shown.slice(0, shown.indexOf("<details>"));
    expect(open).toContain("deploying-4-deletes-replaces-light.svg");
    expect(open).toContain("**4 pending**");
    expect(open).not.toContain("### ");
    expect(folded.startsWith("<details>\n<summary><b>Open the example dashboard</b>")).toBe(true);
  });

  test("says what it holds in its summary line", () => {
    expect(shown).toContain(
      "<summary><b>Open the example dashboard</b>: all 16 stacks and every section</summary>",
    );
  });

  // Record 0097: an issue breaks every line and a README does not, so a row's
  // lines would run into one paragraph without the `<br>`.
  test("breaks a row's lines as the issue does", () => {
    const lines = folded.split("\n");
    const warnings = lines.filter((line) => line.trimStart().startsWith(":warning: <kbd>"));
    expect(warnings.length).toBeGreaterThanOrEqual(4);
    for (const [index, line] of lines.entries()) {
      if (/^ {2}(from |shipped |:warning: |Ticking )/.test(line))
        expect(lines[index - 1]?.endsWith("<br>")).toBe(true);
    }
  });

  test("carries no hidden marker and no pull request number of this repo", () => {
    expect(shown).not.toContain("<!--");
    // `#N` alone would link to this repo's pull request N. `&#91;` is an entity.
    expect(shown).not.toMatch(/(^|[^[&>])#\d+(?![\d\]<])/m);
  });

  test("bun run example changes the example and nothing else of the README", () => {
    const other =
      '<p align="center">old</p>\n\n<details>\n<summary><b>Open the example dashboard</b>: old</summary>\n\nold\n\n</details>';
    const before = readme.replace(shown, other);
    expect(withReadmeExample(before, readmeExample())).toBe(readme);
  });
});

describe("the hard breaks of the README example", () => {
  test("end a line that goes on in an indented line", () => {
    expect(withHardBreaks("- a\n  b\n  c\n- d")).toBe("- a<br>\n  b<br>\n  c\n- d");
  });

  test("leave a fold, a line with its own break and a blank line alone", () => {
    const fold = "- a\n  <details><summary>1</summary>\n  x<br>\n  y<br>\n  </details>\n\n  z";
    expect(withHardBreaks(fold)).toBe(fold);
  });
});

// release-please bumps the version in its pull request and cannot run a
// script, and its version updater rewrites the first version on a line only,
// where a deploying row names two (record 0088). So the release workflow
// writes the example on that pull request's branch, and the tag it merges
// into holds an example that names itself.
describe("the release workflow", () => {
  const workflow = parse(read(".github/workflows/release.yml")) as {
    jobs: Record<
      string,
      {
        steps: {
          id?: string;
          uses?: string;
          if?: string;
          with?: Record<string, unknown>;
          run?: string;
          env?: Record<string, string>;
        }[];
      }
    >;
  };
  // The npm job after it publishes the command line (record 0094).
  const steps = workflow.jobs["release-please"]?.steps ?? [];
  const release = steps.findIndex((step) => step.id === "release");
  const after = steps.slice(release + 1);
  const example = after.find((step) => step.run?.includes("bun run example"));

  test("writes the example on the release pull request's branch", () => {
    expect(release).toBeGreaterThan(-1);
    expect(example).toBeDefined();
    const checkout = after.find((step) => step.uses?.startsWith("actions/checkout@"));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a template.
    expect(checkout?.with?.ref).toBe("${{ fromJSON(steps.release.outputs.pr).headBranchName }}");
    // Every step after release-please runs for a release pull request, but
    // the one that moves the major tag after a release.
    const tag = after.filter((step) => step.if?.includes("release_created"));
    expect(tag.length).toBe(1);
    for (const step of after.filter((one) => !tag.includes(one))) {
      expect(step.if).toBe("steps.release.outputs.pr");
    }
  });

  // A commit made through the API is signed by GitHub, and one on top of the
  // head release-please just wrote is refused if the head moved.
  test("commits both files through the API, on the head it read", () => {
    const commit = after.find((step) => step.run?.includes("createCommitOnBranch"));
    expect(commit?.run).toContain("expectedHeadOid");
    expect(commit?.run).toContain(EXAMPLE_FILE);
    expect(commit?.run).toContain("README.md");
  });
});
