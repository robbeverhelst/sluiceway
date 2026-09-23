import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { exampleBody } from "../../scripts/example-dashboard.ts";
import { DOCS } from "../../src/render/docs-site.ts";
import { ROOT, read } from "./docs.ts";

// Slice 5.19: every link Sluiceway writes where a user sees it points at the
// docs site, and only what has no page there points at the repo. The links
// come from the rendered output the snapshots hold (the body, the summary,
// the check, init's files and what it prints), the README's example
// dashboard, and every source file, so a link a mode or a comment builds by
// hand is held too. A page renamed on the site turns this repo's CI red.

const SITE = "https://docs.sluiceway.dev";

// What has no page on the site, so it stays in the repo.
const REPO_LINKS = [
  // The project itself: its code and its releases, in the dashboard footer.
  "https://github.com/sluiceway/sluiceway",
  // Where the job log sends a preview that failed inside Sluiceway, a bug.
  "https://github.com/sluiceway/sluiceway/issues",
  // The JSON schema of sluiceway.yaml that init's file names for editors.
  "https://raw.githubusercontent.com/sluiceway/sluiceway/main/schema/sluiceway.schema.json",
];
// The header pictures, served from the exact ref of the running action (record 0033).
const PICTURES =
  /^https:\/\/raw\.githubusercontent\.com\/sluiceway\/sluiceway\/[^/]+\/assets\/mascot\/[\w-]+\.(svg|png)$/;

const OURS =
  /https:\/\/(?:docs\.sluiceway\.dev|github\.com\/sluiceway|raw\.githubusercontent\.com\/sluiceway)[^\s)"'`<>\\]*/g;

function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(resolve(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter(keep)
    .map((name) => `${dir}/${name}`);
}

const SOURCES = [
  ...files("src", (name) => name.endsWith(".ts")),
  ...files("test", (name) => name.endsWith(".snap")),
];

const found = [
  ...SOURCES.map((path) => ({ path, text: read(path) })),
  { path: "the example dashboard", text: exampleBody() },
].flatMap(({ path, text }) =>
  [...text.matchAll(OURS)].map((match) => ({ path, url: match[0].replace(/[.,:;]+$/, "") })),
);
// The pages that the words of init and the footer name, built from the site's address.
for (const url of Object.values(DOCS)) found.push({ path: "src/render/docs-site.ts", url });

const onSite = (url: string) => url === SITE || url.startsWith(`${SITE}/`);

const toSite = found.filter(({ url }) => onSite(url) && url !== SITE);

async function page(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

describe("the links Sluiceway writes", () => {
  test("the dashboard footer's docs link goes to the site", () => {
    expect(exampleBody()).toContain(`· [docs](${SITE}/)</sub>`);
    expect(found.some(({ url }) => url.endsWith("#readme"))).toBe(false);
  });

  test("init's files and what it prints name pages on the site, not files in docs/", () => {
    const init = read("test/modes/__snapshots__/init.test.ts.snap");
    expect(init).not.toMatch(/docs\/[\w-]+\.md/);
    expect(init).not.toContain("README");
    for (const path of [
      "/guides/example-workflows/#what-to-change",
      "/guides/workflow/#pin-a-commit",
      "/guides/configuration/",
      "/guides/credentials/#recipes",
      "/guides/credentials/#helm",
    ])
      expect(init).toContain(`${SITE}${path}`);
  });

  test("every link off the site is on the short list of repo links", () => {
    const elsewhere = found.filter(({ url }) => !onSite(url));
    const unlisted = elsewhere.filter(
      ({ url }) => !REPO_LINKS.includes(url) && !PICTURES.test(url),
    );
    expect(unlisted.map(({ path, url }) => `${path}: ${url}`)).toEqual([]);
  });

  test("every page on the site they name is in the site's sitemap", async () => {
    const sitemap = await page(`${SITE}/sitemap-0.xml`);
    const pages = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]));
    expect(pages.size).toBeGreaterThan(20);
    expect(toSite.length).toBeGreaterThan(5);
    const missing = toSite.filter(({ url }) => !pages.has(url.split("#")[0]));
    expect(missing.map(({ path, url }) => `${path}: ${url}`)).toEqual([]);
  }, 30_000);

  test("every anchor they name is a heading on the live page", async () => {
    const byPage = new Map<string, Promise<string>>();
    const dead: string[] = [];
    for (const { path, url } of toSite.filter(({ url }) => url.includes("#"))) {
      const [at = "", anchor = ""] = url.split("#");
      if (!byPage.has(at)) byPage.set(at, page(at));
      if (!(await byPage.get(at))?.includes(`id="${anchor}"`)) dead.push(`${path}: ${url}`);
    }
    expect(dead).toEqual([]);
  }, 60_000);
});
