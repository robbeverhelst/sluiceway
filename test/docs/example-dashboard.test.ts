import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import {
  EXAMPLE_FILE,
  exampleActionRef,
  exampleBody,
  readmeExample,
  withReadmeExample,
} from "../../scripts/example-dashboard.ts";
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

  // Record 0063: deploying sits at the top, each row with the spinner.
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
    for (const row of rows) expect(row).toContain(`${IMAGES}/spinner-light.svg`);
    expect(deploying).toContain("· deploying ·");
    expect(deploying).toContain("· queued behind **");
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

describe("the example dashboard in the README", () => {
  const readme = read("README.md");
  const start = readme.indexOf("<details>\n<summary><b>Open the example dashboard</b>");
  const end = readme.indexOf("\n</details>\n\n## How it works", start);
  const shown = start === -1 || end === -1 ? "" : readme.slice(start, end + "\n</details>".length);

  test("is the published example made fit for the README", () => {
    expect(shown).not.toBe("");
    expect(shown).toBe(readmeExample());
  });

  test("says what it holds in its summary line", () => {
    expect(shown).toContain(
      "<summary><b>Open the example dashboard</b>: 16 stacks, 2 deploying, 4 pending, 2 drifted</summary>",
    );
  });

  test("carries no hidden marker and no pull request number of this repo", () => {
    expect(shown).not.toContain("<!--");
    // `#N` alone would link to this repo's pull request N. `&#91;` is an entity.
    expect(shown).not.toMatch(/(^|[^[&>])#\d+(?![\d\]<])/m);
  });

  test("bun run example changes the example and nothing else of the README", () => {
    const other =
      "<details>\n<summary><b>Open the example dashboard</b>: old</summary>\n\nold\n\n</details>";
    const before = readme.replace(shown, other);
    expect(withReadmeExample(before, readmeExample())).toBe(readme);
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
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
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
