import { describe, expect, test } from "bun:test";
import { fences, modeOf, read, section, workflows } from "./docs.ts";

// Slice README rewrite (owner, 2026-09-22): the README is the front door and
// the manual lives in docs/, which the docs site pulls from a pinned tag. The
// README sells and points, in a fixed order, and stays short enough to read in
// one go.

const readme = read("README.md");

// The headings of the README, in order.
const headings = [...readme.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

describe("the README as the front door", () => {
  test("has its sections in the agreed order", () => {
    expect(headings).toEqual([
      "What it looks like",
      "How it works",
      "Get started",
      "What it promises",
      "What it does",
      "More",
    ]);
  });

  // The owner asked for about 120 lines. The whole workflow alone is close to
  // 90, and it is what people copy, so the budget is on the words around it.
  // The example dashboard is folded and generated, so it does not count.
  test("is short: the words around the workflow fit in 90 lines", () => {
    const start = readme.indexOf("<details>\n<summary><b>Open the example dashboard</b>");
    const end = readme.indexOf("\n</details>\n\n## How it works");
    const outside = readme.slice(0, start) + readme.slice(end);
    const words = outside.replace(/^```[\s\S]*?^```$/gm, "");
    expect(words.split("\n").length).toBeLessThanOrEqual(90);
    expect(outside.split("\n").length).toBeLessThanOrEqual(170);
  });

  test("opens with Penny, then the one line, then the beta notice", () => {
    const top = readme.slice(0, readme.indexOf("\n## "));
    expect(top).toContain('<p align="center">');
    expect(top).toContain("assets/mascot/in-sync-light.svg");
    expect(top).toContain(
      "Sluiceway keeps one GitHub issue that shows which infrastructure stacks have changes waiting, and deploys a stack when you tick its box.",
    );
    expect(top.indexOf("<picture>")).toBeLessThan(top.indexOf("> [!IMPORTANT]"));
  });

  // The links go to the Markdown files for now. The swap to the docs site is
  // one pass later, and the comment says so to whoever does it.
  test("says at the top that its links move to docs.sluiceway.dev later", () => {
    const comment = readme.match(/^<!--([\s\S]*?)-->/)?.[1] ?? "";
    expect(comment).toContain("docs.sluiceway.dev");
    expect(comment).toContain("docs/");
  });

  test("tells how it works in five steps", () => {
    const steps = section(readme, "## How it works").match(/^\d+\. /gm) ?? [];
    expect(steps.length).toBe(5);
  });

  test("gets you started in four short paragraphs, each with a link into docs/", () => {
    const paragraphs = section(readme, "## Get started")
      .replace(/^```[\s\S]*?^```$/gm, "")
      .split("\n\n")
      .filter((block) => block.startsWith("**"));
    expect(paragraphs.map((block) => block.match(/^\*\*([^*]+)\*\*/)?.[1])).toEqual([
      "Check your setup.",
      "Add the workflow.",
      "Tell it about your stacks.",
      "Load your credentials.",
    ]);
    for (const block of paragraphs) expect(block).toMatch(/\]\(docs\/[\w-]+\.md(#[\w-]+)?\)/);
  });

  // What people copy. The check, the read-only trial and the wiring for merge
  // and deploy live in docs/workflow.md and docs/read-only-trial.md.
  test("shows one workflow, the whole loop, and no other YAML", () => {
    const yaml = fences(readme).filter((fence) => fence.language === "yaml");
    expect(yaml.length).toBe(1);
    const inReadme = workflows().filter(({ where }) => where.startsWith("README.md"));
    expect(inReadme.length).toBe(1);
    const modes = Object.values(inReadme[0]?.workflow.jobs ?? {}).map(modeOf);
    expect(modes).toEqual(["scan", "resolve", "apply", "settle"]);
  });

  test("shows the same workflow as docs/workflow.md explains", () => {
    const full = (path: string) =>
      fences(read(path)).find(
        (fence) => fence.language === "yaml" && fence.text.includes("mode: settle"),
      )?.text;
    expect(full("README.md")).toBeDefined();
    expect(full("README.md")).toBe(full("docs/workflow.md"));
  });

  test("makes its promises in three lines", () => {
    const lines = section(readme, "## What it promises").match(/^- /gm) ?? [];
    expect(lines.length).toBe(3);
  });

  test("lists what it does, one line per capability, each linking into docs/", () => {
    const lines = section(readme, "## What it does")
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(lines.length).toBeGreaterThanOrEqual(12);
    for (const line of lines) expect(line).toMatch(/\]\(docs\/[\w-]+\.md(#[\w-]+)?\)/);
    const text = lines.join("\n");
    for (const word of [
      "Pulumi",
      "OpenTofu",
      "Helm",
      "Kubernetes",
      "Renovate",
      "drift",
      "dependsOn",
      "preview page",
      "check",
      "showValues",
      "deploys: false",
      "dry-run",
    ]) {
      expect(text).toContain(word);
    }
  });

  // Build plan, slices 4.6 and 4.9: Helm and Kubernetes manifests landed
  // while the README was rewritten, so neither line says coming any more.
  test("says Helm and Kubernetes manifests are here, not coming", () => {
    const lines = section(readme, "## What it does").split("\n");
    for (const tool of ["- **Helm**", "- **Kubernetes manifests**"]) {
      expect(lines.find((line) => line.startsWith(tool))).toBeDefined();
      expect(lines.find((line) => line.startsWith(tool))).not.toMatch(/coming/i);
    }
  });

  test("ends with the links out: docs, examples, changelog, contributing, license", () => {
    const more = section(readme, "## More");
    for (const target of [
      "(docs/README.md)",
      "(https://github.com/sluiceway/examples)",
      "(CHANGELOG.md)",
      "(CONTRIBUTING.md)",
      "(LICENSE)",
    ]) {
      expect(more).toContain(target);
    }
  });
});

// Everything the README held moved into docs/, and nothing disappeared.
describe("the manual in docs/", () => {
  test.each([
    ["docs/workflow.md", "## What goes where"],
    ["docs/workflow.md", "## Check your setup"],
    ["docs/workflow.md", "## The workflow"],
    ["docs/workflow.md", "## Pin a commit"],
    ["docs/workflow.md", "## Self-hosted runners"],
    ["docs/workflow.md", "## With GitHub Environments"],
    ["docs/workflow.md", "## Merge and deploy"],
    ["docs/workflow.md", "## Stack dependencies"],
    ["docs/read-only-trial.md", "# Start read only"],
    ["docs/using-the-dashboard.md", "## Reading the job log"],
    ["docs/using-the-dashboard.md", "## Limits"],
    ["docs/reference.md", "## Modes"],
    ["docs/reference.md", "## Inputs"],
    ["docs/reference.md", "## Outputs"],
    ["docs/reference.md", "## Requirements"],
  ])("%s has %s", (path, heading) => {
    expect(read(path).split("\n")).toContain(heading);
  });

  // With dependsOn, settle dispatches the workflow and the resolve of that run
  // starts the queued stacks (slice 4.4). A workflow that drops the dispatch
  // from resolve's if: leaves them queued.
  test("docs/workflow.md says why resolve runs on workflow_dispatch", () => {
    const dependencies = section(read("docs/workflow.md"), "## Stack dependencies");
    expect(dependencies).toContain("workflow_dispatch");
    expect(dependencies).toContain("dependsOn");
  });
});
