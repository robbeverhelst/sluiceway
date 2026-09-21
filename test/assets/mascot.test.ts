import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HEADER_STATES } from "../../src/render/header-state.ts";

// The file rules of records 0033 and 0039, checked in CI on every header
// image. The cap forces clean, hand-made SVG and keeps the header instant on a
// phone.

const DIR = resolve(import.meta.dir, "../../assets/mascot");
const MAX_BYTES = 10 * 1024;
// Pending has one picture per pending level (record 0039). Every other header
// state has one.
const PENDING_LEVELS = [1, 2, 3];
const PICTURES = HEADER_STATES.flatMap((state) =>
  state === "pending" ? PENDING_LEVELS.map((level) => `pending-${level}`) : [state],
);
const FILES = PICTURES.flatMap((picture) => [`${picture}-light.svg`, `${picture}-dark.svg`]);

function violations(name: string, svg: string): string[] {
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
  if (animated && name.startsWith("plain-")) found.push("plain is animated");
  if (animated && !/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(svg))
    found.push("animation stays on under prefers-reduced-motion");
  return found;
}

describe("the check itself", () => {
  const svg = (inside: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 160">${inside}</svg>`;

  test("passes a small self-contained file", () => {
    expect(violations("pending-light.svg", svg('<g clip-path="url(#c1)"/>'))).toEqual([]);
  });

  test("flags a file over 10 KB, and not one of exactly 10 KB", () => {
    const empty = svg("").length;
    expect(violations("pending-light.svg", svg(" ".repeat(10_240 - empty)))).toEqual([]);
    expect(violations("pending-light.svg", svg(" ".repeat(10_241 - empty)))).toEqual([
      "10241 bytes, over 10 KB",
    ]);
  });

  test("counts bytes, not characters", () => {
    expect(violations("pending-light.svg", svg("é".repeat(6_000)))).toEqual([
      `${svg("").length + 12_000} bytes, over 10 KB`,
    ]);
  });

  test("flags another view box", () => {
    expect(violations("a.svg", '<svg viewBox="0 0 440 120"></svg>')).toEqual([
      "view box is not 0 0 880 160",
    ]);
  });

  test("flags script, fonts, raster images and outside references", () => {
    expect(violations("a.svg", svg("<script>1</script>"))).toEqual(["script"]);
    expect(violations("a.svg", svg('<g onload="x()"/>'))).toEqual(["script"]);
    expect(violations("a.svg", svg("<style>@font-face{}</style>"))).toEqual(["font or import"]);
    expect(violations("a.svg", svg('<image href="#x"/>'))).toEqual([
      "raster image or foreign object",
    ]);
    expect(violations("a.svg", svg('<use href="https://example.com/x.svg#a"/>'))).toEqual([
      "outside reference",
    ]);
    expect(violations("a.svg", svg('<rect fill="url(other.svg#a)"/>'))).toEqual([
      "outside reference",
    ]);
  });

  test("flags text, which would be drawn in the reader's own font", () => {
    expect(violations("a.svg", svg("<text>sluiceway</text>"))).toEqual(["text"]);
  });

  test("flags animation in a plain file, and animation that ignores reduced motion", () => {
    const moving = "<style>.a{animation:a 2s infinite}</style>";
    const polite = `<style>.a{animation:a 2s infinite}@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>`;
    expect(violations("pending-dark.svg", svg(moving))).toEqual([
      "animation stays on under prefers-reduced-motion",
    ]);
    expect(violations("pending-dark.svg", svg(polite))).toEqual([]);
    expect(violations("plain-dark.svg", svg(polite))).toEqual(["plain is animated"]);
  });
});

test("there is one light and one dark file for every picture, and no other image", () => {
  const images = readdirSync(DIR).filter((name) => !name.endsWith(".md"));
  expect(images.sort()).toEqual([...FILES].sort());
  expect(FILES).toHaveLength(16);
});

test.each(FILES)("%s keeps the file rules", (name) => {
  expect(violations(name, readFileSync(join(DIR, name), "utf8"))).toEqual([]);
});
