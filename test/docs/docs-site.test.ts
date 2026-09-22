import { describe, expect, test } from "bun:test";
import { read } from "./docs.ts";

// Slice 5.16: the README links to the docs site, which builds its pages from
// docs/ in its own repo. A page renamed or dropped there would leave a dead
// link here, so every link is checked against the site's live sitemap, and
// every anchor against the live page.

const SITE = "https://docs.sluiceway.dev";

// The pages that send people to the site.
const PAGES = ["README.md", ".github/ISSUE_TEMPLATE/feature_request.yml"];

const links = PAGES.flatMap((path) =>
  [...read(path).matchAll(/https:\/\/docs\.sluiceway\.dev[^\s)"'>]*/g)].map((match) => ({
    path,
    url: match[0],
  })),
);

async function text(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

describe("the links to the docs site", () => {
  test("there are some, on every page that sends people there", () => {
    for (const path of PAGES) expect(links.some((link) => link.path === path)).toBe(true);
    expect(links.filter((link) => link.path === "README.md").length).toBeGreaterThan(20);
  });

  test("every page they name is in the site's sitemap", async () => {
    const sitemap = await text(`${SITE}/sitemap-0.xml`);
    const pages = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
    expect(pages.size).toBeGreaterThan(20);
    const missing = links.filter(({ url }) => !pages.has(url.split("#")[0]));
    expect(missing.map(({ path, url }) => `${path}: ${url}`)).toEqual([]);
  }, 30_000);

  test("every anchor they name is a heading on the live page", async () => {
    const withAnchor = links.filter(({ url }) => url.includes("#"));
    const byPage = new Map<string, Promise<string>>();
    const dead: string[] = [];
    for (const { path, url } of withAnchor) {
      const [page = "", anchor = ""] = url.split("#");
      if (!byPage.has(page)) byPage.set(page, text(page));
      const html = await byPage.get(page);
      if (!html?.includes(`id="${anchor}"`)) dead.push(`${path}: ${url}`);
    }
    expect(withAnchor.length).toBeGreaterThan(10);
    expect(dead).toEqual([]);
  }, 60_000);
});
