import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HEADER_STATES } from "../../src/render/header-state.ts";
import { MAX_CRATES } from "../../src/render/pending-crates.ts";

// The file rules of records 0033, 0039, 0043, 0047, 0055, 0066 and 0075, checked in CI on every header
// image, and of record 0063 on the row spinner. The cap forces clean,
// hand-made SVG and keeps the header instant on a phone.

const DIR = resolve(import.meta.dir, "../../assets/mascot");
const MAX_BYTES = 10 * 1024;
// Pending has one picture per crate count up to the maximum and one past it
// (records 0047 and 0075). Failing, deploying and queued have the same, from
// 0 crates, because they show the pending stacks too (records 0066 and 0075).
// Every other header state has one, drift too: it shows only when nothing is
// pending (record 0055). There is no plain picture any more (record 0043).
const CRATES = [...Array.from({ length: MAX_CRATES }, (_, index) => index + 1), "more"];
const COUNTS: Partial<Record<(typeof HEADER_STATES)[number], (number | string)[]>> = {
  pending: CRATES,
  failing: [0, ...CRATES],
  deploying: [0, ...CRATES],
  queued: [0, ...CRATES],
};
const STATE_PICTURES = HEADER_STATES.flatMap(
  (state) => COUNTS[state]?.map((crates) => `${state}-${crates}`) ?? [state],
);
// Every counted picture exists three more times, with the delete sign, the
// replace sign, and both on the pole (records 0043, 0047, 0066 and 0075).
const SIGNED = STATE_PICTURES.filter((picture) => /-(\d+|more)$/.test(picture)).flatMap((picture) =>
  ["-deletes", "-replaces", "-deletes-replaces"].map((signs) => `${picture}${signs}`),
);
const PICTURES = [...STATE_PICTURES, ...SIGNED];
const FILES = PICTURES.flatMap((picture) => [`${picture}-light.svg`, `${picture}-dark.svg`]);
// The small picture at the start of a deploying or queued row (record 0063):
// square, and under 1 KB, because a dashboard can show several at once.
const SPINNER_FILES = ["spinner-light.svg", "spinner-dark.svg"];
const HEADER = { maxBytes: MAX_BYTES, viewBox: "0 0 880 160", cap: "10 KB" };
const SPINNER = { maxBytes: 1024, viewBox: "0 0 24 24", cap: "1 KB" };

function violations(svg: string, rules = HEADER): string[] {
  const found: string[] = [];
  const bytes = new TextEncoder().encode(svg).length;
  if (bytes > rules.maxBytes) found.push(`${bytes} bytes, over ${rules.cap}`);
  if (!new RegExp(`^<svg[^>]*\\sviewBox="${rules.viewBox}"`).test(svg))
    found.push(`view box is not ${rules.viewBox}`);
  if (/<script|\son[a-z]+\s*=/i.test(svg)) found.push("script");
  if (/@font-face|@import/i.test(svg)) found.push("font or import");
  // Text is drawn with whatever font the reader's system has. The wordmark
  // is paths, so it looks the same everywhere.
  if (/<text|font-family/i.test(svg)) found.push("text");
  if (/<image|<foreignObject/i.test(svg)) found.push("raster image or foreign object");

  // A reference may only point inside the file, and the one address in it is
  // the SVG namespace.
  const targets = [
    ...[...svg.matchAll(/url\(\s*['"]?([^'")]*)/g)].map((match) => match[1] ?? ""),
    ...[...svg.matchAll(/href\s*=\s*["']([^"']*)/g)].map((match) => match[1] ?? ""),
  ];
  const addresses = svg.match(/[a-z][a-z0-9+.-]*:\/\/[^"'\s)]*/gi) ?? [];
  if (
    targets.some((target) => !target.startsWith("#")) ||
    addresses.some((address) => address !== "http://www.w3.org/2000/svg")
  )
    found.push("outside reference");

  const animated = /animation|<animate|<set\s/.test(svg);
  if (animated && !/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(svg))
    found.push("animation stays on under prefers-reduced-motion");
  return found;
}

describe("the check itself", () => {
  const svg = (inside: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 160">${inside}</svg>`;

  test("passes a small self-contained file", () => {
    expect(violations(svg('<g clip-path="url(#c1)"/>'))).toEqual([]);
  });

  test("flags a file over 10 KB, and not one of exactly 10 KB", () => {
    const empty = svg("").length;
    expect(violations(svg(" ".repeat(10_240 - empty)))).toEqual([]);
    expect(violations(svg(" ".repeat(10_241 - empty)))).toEqual(["10241 bytes, over 10 KB"]);
  });

  test("counts bytes, not characters", () => {
    expect(violations(svg("é".repeat(6_000)))).toEqual([
      `${svg("").length + 12_000} bytes, over 10 KB`,
    ]);
  });

  test("flags another view box", () => {
    expect(violations('<svg viewBox="0 0 440 120"></svg>')).toEqual([
      "view box is not 0 0 880 160",
    ]);
  });

  test("flags script, fonts, raster images and outside references", () => {
    expect(violations(svg("<script>1</script>"))).toEqual(["script"]);
    expect(violations(svg('<g onload="x()"/>'))).toEqual(["script"]);
    expect(violations(svg("<style>@font-face{}</style>"))).toEqual(["font or import"]);
    expect(violations(svg('<image href="#x"/>'))).toEqual(["raster image or foreign object"]);
    expect(violations(svg('<use href="https://example.com/x.svg#a"/>'))).toEqual([
      "outside reference",
    ]);
    expect(violations(svg('<rect fill="url(other.svg#a)"/>'))).toEqual(["outside reference"]);
  });

  test("flags text, which would be drawn in the reader's own font", () => {
    expect(violations(svg("<text>sluiceway</text>"))).toEqual(["text"]);
  });

  test("flags animation that ignores reduced motion", () => {
    const moving = "<style>.a{animation:a 2s infinite}</style>";
    const polite = `<style>.a{animation:a 2s infinite}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>`;
    expect(violations(svg(moving))).toEqual(["animation stays on under prefers-reduced-motion"]);
    expect(violations(svg(polite))).toEqual([]);
  });
});

test("there is one light and one dark file for every picture and for the spinner, and no other image", () => {
  const images = readdirSync(DIR).filter((name) => !name.endsWith(".md"));
  expect(images.sort()).toEqual([...FILES, ...SPINNER_FILES].sort());
  // 21 pending, 22 failing, 22 deploying and 22 queued pictures, each also
  // with the delete sign, the replace sign and both, and first run, in sync
  // and drift: 351 pairs.
  expect(FILES).toHaveLength(702);
  for (const name of [
    "drift",
    "failing-0",
    "failing-more-deletes-replaces",
    "deploying-12-replaces",
    "pending-20-deletes",
    "queued-0",
    "queued-more-deletes",
  ])
    expect(FILES).toContain(`${name}-dark.svg`);
  expect(FILES).not.toContain("failing-light.svg");
  expect(FILES).not.toContain("drift-0-light.svg");
  expect(FILES).not.toContain("pending-4-destroys-light.svg");
});

// The picture says the count and the signs, so its own label does too, in the
// words of the dashboard's alt text (records 0047, 0066 and 0075).
test.each<[string, string]>([
  ["failing-0", "Sluiceway: something failed"],
  ["failing-1", "Sluiceway: something failed, 1 stack is pending"],
  [
    "failing-more-deletes-replaces",
    "Sluiceway: something failed, more than 20 stacks are pending, some changes delete or replace resources",
  ],
  ["deploying-0-deletes", "Sluiceway: deploying, some changes delete resources"],
  ["deploying-7", "Sluiceway: deploying, 7 stacks are pending"],
  ["pending-7", "Sluiceway: 7 stacks are pending"],
  ["pending-17-replaces", "Sluiceway: 17 stacks are pending, some replace resources"],
  ["queued-0", "Sluiceway: queued behind dependencies"],
  [
    "queued-3-replaces",
    "Sluiceway: queued behind dependencies, 3 stacks are pending, some changes replace resources",
  ],
])("%s is labelled with its count", (picture, label) => {
  for (const theme of ["light", "dark"])
    expect(readFileSync(join(DIR, `${picture}-${theme}.svg`), "utf8")).toContain(
      `aria-label="${label}"`,
    );
});

test.each(FILES)("%s keeps the file rules", (name) => {
  expect(violations(readFileSync(join(DIR, name), "utf8"))).toEqual([]);
});

describe("the spinner", () => {
  test("the check holds it to 1 KB and a square view box", () => {
    const small = (inside: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inside}</svg>`;
    expect(violations(small(""), SPINNER)).toEqual([]);
    expect(violations(small(" ".repeat(1_025 - small("").length)), SPINNER)).toEqual([
      "1025 bytes, over 1 KB",
    ]);
    expect(violations(small(""))).toEqual(["view box is not 0 0 880 160"]);
  });

  test.each(SPINNER_FILES)("%s keeps the file rules", (name) => {
    expect(violations(readFileSync(join(DIR, name), "utf8"), SPINNER)).toEqual([]);
  });

  test.each(SPINNER_FILES)("%s moves, and stands still under reduced motion", (name) => {
    const svg = readFileSync(join(DIR, name), "utf8");
    expect(svg).toMatch(/animation:/);
    expect(svg).toMatch(
      /@media \(prefers-reduced-motion:reduce\)\{\*\{animation:none!important\}\}/,
    );
  });
});
