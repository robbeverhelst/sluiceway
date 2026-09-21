import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { ROOT, read, USER_DOCS } from "./docs.ts";

// Slice 2.10: the user docs link to each other and into sections. A link that
// lands nowhere is a dead end for exactly the stranger the docs are for.

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

const links = USER_DOCS.flatMap((path) =>
  [
    ...read(path)
      .replace(/^```[\s\S]*?^```$/gm, "")
      .matchAll(/\]\(([^)\s]+)\)/g),
  ]
    .map((match) => match[1] ?? "")
    .filter((target) => !/^[a-z]+:/.test(target))
    .map((target) => ({ path, target })),
);

describe("the links of the user docs", () => {
  test("there are some to check", () => {
    expect(links.length).toBeGreaterThan(20);
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
