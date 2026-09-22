import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, read } from "./docs.ts";
import { EXAMPLE_ACTION_REF, exampleDashboard } from "./example-dashboard.ts";

// The README shows a dashboard. It is what the renderer gives for the made-up
// rows of example-dashboard.ts, so it cannot fall behind the renderer again
// the way it did before nested paths (slice 2.15), the exact crate count
// (record 0047) and the destroy sign on a pole.

const readme = read("README.md");
const start = readme.indexOf("<details>\n<summary><b>Open the example dashboard</b>");
const end = readme.indexOf("\n</details>\n\n## How it works", start);
const shown = start === -1 || end === -1 ? "" : readme.slice(start, end + "\n</details>".length);

// A row escapes brackets and quotes inside <code> (slice 2.15).
const decoded = (text: string) =>
  text.replaceAll("&#91;", "[").replaceAll("&#93;", "]").replaceAll("&quot;", '"');

const IMAGES = `https://raw.githubusercontent.com/sluiceway/sluiceway/${EXAMPLE_ACTION_REF}/assets/mascot`;

describe("the example dashboard in the README", () => {
  test("is there", () => {
    expect(shown).not.toBe("");
  });

  test("is what the renderer gives for the example rows", () => {
    expect(shown).toBe(exampleDashboard());
  });

  // Build plan, section 8: 0.1.1 is the newest release, so the pictures come from its tag.
  test("takes its header pictures from the v0.1.1 tag", () => {
    expect(EXAMPLE_ACTION_REF).toBe("v0.1.1");
    const urls = [...shown.matchAll(/https:\/\/raw\.githubusercontent\.com\/[^"]+/g)].map(
      (match) => match[0],
    );
    expect(urls.length).toBe(2);
    for (const url of urls) expect(url.startsWith(`${IMAGES}/`)).toBe(true);
  });

  // Record 0047: one crate per pending stack. Record 0075: the example's
  // destroys are deletes, so the delete sign.
  test("shows one crate per pending stack and the delete sign", () => {
    const pending = Number(shown.match(/\*\*(\d+) pending\*\*/)?.[1]);
    expect(pending).toBeGreaterThan(1);
    expect(shown).toContain(`${IMAGES}/pending-${pending}-deletes-light.svg`);
    expect(shown).toContain(`${IMAGES}/pending-${pending}-deletes-dark.svg`);
    expect(shown).toContain(
      `alt="Sluiceway: ${pending} stacks are pending, some delete resources"`,
    );
    for (const theme of ["light", "dark"]) {
      expect(
        existsSync(resolve(ROOT, `assets/mascot/pending-${pending}-deletes-${theme}.svg`)),
      ).toBe(true);
    }
  });

  // Slice 2.15: a row names the path inside a property, never only its top.
  test("shows nested property paths", () => {
    const paths = [...shown.matchAll(/ · (<code>.*)<br>$/gm)].flatMap((match) =>
      [...(match[1] ?? "").matchAll(/<code>([^<]+)<\/code>/g)].map((code) =>
        decoded(code[1] ?? ""),
      ),
    );
    expect(paths.filter((path) => path.includes(".")).length).toBeGreaterThan(1);
    expect(paths.some((path) => /\[\d+\]/.test(path))).toBe(true);
    expect(paths.some((path) => path.includes('["'))).toBe(true);
  });

  test("carries no hidden marker and no pull request number of this repo", () => {
    expect(shown).not.toContain("<!--");
    // `#N` alone would link to this repo's pull request N. `&#91;` is an entity.
    expect(shown).not.toMatch(/(^|[^[&])#\d+(?![\d\]])/m);
  });
});
