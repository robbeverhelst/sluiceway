import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HEADER_STATES } from "../../src/render/header-state.ts";
import { MAX_CRATES } from "../../src/render/pending-crates.ts";

// The file rules of records 0033, 0039, 0043 and 0047, checked in CI on every header
// image. The cap forces clean, hand-made SVG and keeps the header instant on a
// phone.

const DIR = resolve(import.meta.dir, "../../assets/mascot");
const MAX_BYTES = 10 * 1024;
// Pending has one picture per crate count up to the maximum and one past it
// (record 0047). Every other header state has one. There is no plain picture
// any more (record 0043).
const CRATES = [...Array.from({ length: MAX_CRATES }, (_, index) => index + 1), "more"];
const STATE_PICTURES = HEADER_STATES.flatMap((state) =>
  state === "pending" ? CRATES.map((crates) => `pending-${crates}`) : [state],
);
// The pictures of a state that can hold a pending or deploying row exist once
// more with the destroy sign painted on the wall (record 0043).
const SIGNED = STATE_PICTURES.filter(
  (picture) => picture.startsWith("pending-") || picture === "deploying",
).map((picture) => `${picture}-destroys`);
const PICTURES = [...STATE_PICTURES, ...SIGNED];
const FILES = PICTURES.flatMap((picture) => [`${picture}-light.svg`, `${picture}-dark.svg`]);

function violations(svg: string): string[] {
  const found: string[] = [];
  const bytes = new TextEncoder().encode(svg).length;
  if (bytes > MAX_BYTES) found.push(`${bytes} bytes, over 10 KB`);
  if (!/^<svg[^>]*\sviewBox="0 0 880 160"/.test(svg)) found.push("view box is not 0 0 880 160");
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

test("there is one light and one dark file for every picture, and no other image", () => {
  const images = readdirSync(DIR).filter((name) => !name.endsWith(".md"));
  expect(images.sort()).toEqual([...FILES].sort());
  expect(FILES).toHaveLength(62);
});

test.each(FILES)("%s keeps the file rules", (name) => {
  expect(violations(readFileSync(join(DIR, name), "utf8"))).toEqual([]);
});
