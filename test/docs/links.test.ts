import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { ROOT, read } from "./docs.ts";

// Slice 2.10: the user docs link to each other and into sections. A link that
// lands nowhere is a dead end for exactly the stranger the docs are for.
// Slice 4.8: every page, the records, the plan and the logs too, because a
// dead link in a record sends the next builder to a rule that is not there.
// The changelog is left out: release-please writes it.
const PAGES = [
  ...new Bun.Glob("*.md").scanSync(ROOT),
  ...new Bun.Glob("{docs,examples,assets,src}/**/*.md").scanSync(ROOT),
]
  .filter((path) => path !== "CHANGELOG.md")
  .sort();

// The anchor GitHub gives a heading: lower case, punctuation dropped, spaces
// turned into hyphens.
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

function anchors(path: string): string[] {
  const outsideFences = read(path).replace(/^```[\s\S]*?^```$/gm, "");
  return [...outsideFences.matchAll(/^#{1,6} (.+)$/gm)].map((match) => slug(match[1] ?? ""));
}

// The README rewrite: the pictures on top are HTML, `src` and `srcset`, and
// an HTML link is a link too.
const links = PAGES.flatMap((path) => {
  const text = read(path)
    .replace(/^```[\s\S]*?^```$/gm, "")
    // A link inside inline code is an example of a format, such as
    // `[preview](url)`, and not a link.
    .replace(/`[^`\n]*`/g, "");
  return [
    ...[...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? ""),
    ...[...text.matchAll(/\b(?:src|srcset|href)="([^"\s]+)"/g)].map((match) => match[1] ?? ""),
  ]
    .filter((target) => !/^[a-z]+:/.test(target))
    .map((target) => ({ path, target }));
});

describe("the links of every page", () => {
  test("there are some to check, on every page of docs/ and the records too", () => {
    expect(links.length).toBeGreaterThan(20);
    expect(links).toContainEqual({ path: "README.md", target: "assets/mascot/in-sync-light.svg" });
    for (const page of [
      "docs/workflow.md",
      "docs/read-only-trial.md",
      "docs/using-the-dashboard.md",
      "docs/reference.md",
    ]) {
      expect(links.some(({ path }) => path === page)).toBe(true);
    }
    expect(PAGES).toContain("docs/build-plan.md");
    expect(PAGES.filter((path) => path.startsWith("docs/adr/")).length).toBeGreaterThan(50);
  });

  test("every relative link names a file that exists", () => {
    const dead = links.filter(({ path, target }) => {
      const file = target.split("#")[0] ?? "";
      return file !== "" && !existsSync(resolve(ROOT, dirname(path), file));
    });
    expect(dead.map(({ path, target }) => `${path}: ${target}`)).toEqual([]);
  });

  test("every link into a section names a heading that exists", () => {
    const dead = links.filter(({ path, target }) => {
      const [file = "", anchor] = target.split("#");
      if (anchor === undefined) return false;
      const into = file === "" ? path : relative(ROOT, join(ROOT, dirname(path), file));
      return into.endsWith(".md") && !anchors(into).includes(anchor);
    });
    expect(dead.map(({ path, target }) => `${path}: ${target}`)).toEqual([]);
  });
});
