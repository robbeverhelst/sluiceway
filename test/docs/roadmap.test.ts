import { describe, expect, test } from "bun:test";
import { BEFORE_1_0, END, generated, START, withGenerated } from "../../scripts/roadmap.ts";
import { read } from "./docs.ts";

// Slice 4.8: docs/roadmap.md says in plain words what comes before 1.0 and
// what after. What comes after is generated from docs/later.md, so the two
// never disagree.

const LATER = `# Not in v1

Intro.

## Deferred, door left open

Left out on purpose.

| What | Why not in v1 | Decided in |
|---|---|---|
| Teams in the tick rule | The token cannot read teams. | 0018 |
| A Helm adapter (a release as the stack) | First after OpenTofu. | 0006 |
| \`sluiceway.yml\` as a second spelling | One name. | Slice 1.2 |

## Rejected on principle

| What | Why | Decided in |
|---|---|---|
| Generic extra tool arguments | They break the hash. | 0015 |
| Relative times | Bytes must not change. | 0029 |

## Bigger efforts, each its own plan

| What | Note |
|---|---|
| GitLab and Bitbucket | A different product surface. |
| Docs site and Marketplace launch | Part of the launch. |
`;

describe("the generated part of the roadmap", () => {
  const list = generated(LATER);

  test("lists every deferred row in the order of later.md", () => {
    expect(list).toContain("- Teams in the tick rule\n- `sluiceway.yml` as a second spelling\n");
  });

  test("leaves out the rows that come before 1.0, which the page names by hand", () => {
    expect(list).not.toContain("Helm");
    expect(list).not.toContain("Docs site");
  });

  test("lists the bigger efforts with their note", () => {
    expect(list).toContain("- GitLab and Bitbucket. A different product surface.\n");
  });

  test("counts what was rejected on principle and names none of it", () => {
    expect(list).toContain("2 ideas were rejected on principle.");
    expect(list).not.toContain("Generic extra tool arguments");
  });

  test("is the same for the same later.md", () => {
    expect(generated(LATER)).toBe(list);
  });

  test("fails when later.md loses a table it reads", () => {
    expect(() => generated(LATER.replace("## Rejected on principle", "## Rejected"))).toThrow(
      "docs/later.md has no table under ## Rejected on principle.",
    );
  });
});

describe("withGenerated", () => {
  const page = `# Roadmap\n\nBy hand.\n\n${START}\nold list\n${END}\n\nAlso by hand.\n`;

  test("replaces only what sits between the two lines", () => {
    expect(withGenerated(page, LATER)).toBe(
      `# Roadmap\n\nBy hand.\n\n${START}\n${generated(LATER)}${END}\n\nAlso by hand.\n`,
    );
  });

  test("fails on a page without the two lines", () => {
    expect(() => withGenerated("# Roadmap\n", LATER)).toThrow(
      "docs/roadmap.md has no generated part.",
    );
  });
});

describe("docs/roadmap.md", () => {
  const roadmap = read("docs/roadmap.md");
  const later = read("docs/later.md");

  test("holds what bun run roadmap generates from docs/later.md", () => {
    // When this fails after a change to docs/later.md, run `bun run roadmap`.
    expect(roadmap).toBe(withGenerated(roadmap, later));
  });

  test("names every row that comes before 1.0 by hand, above the generated part", () => {
    const byHand = roadmap.slice(0, roadmap.indexOf(START));
    const words: Record<(typeof BEFORE_1_0)[number], string> = {
      "A Helm adapter": "Helm adapter",
      "Detecting dependencies from Pulumi stack references": "Pulumi stack references",
      "Docs site and Marketplace launch": "Marketplace",
      "Launch material": "`v1` moving tag",
    };
    for (const prefix of BEFORE_1_0) expect(byHand).toContain(words[prefix]);
  });

  test("links to later.md and the build plan", () => {
    expect(roadmap).toContain("](later.md");
    expect(roadmap).toContain("](build-plan.md");
  });
});
