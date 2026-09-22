import { describe, expect, test } from "bun:test";
import { parseJson5 } from "../../src/core/json5.ts";

// Renovate reads its config files as JSONC, and as JSON5 when that fails or
// the file is named `.json5` (slice 4.13). Sluiceway reads them with one
// small JSON5 reader, which also reads all of JSON and JSONC.

describe("reading JSON5", () => {
  test("reads plain JSON as JSON.parse does", () => {
    const text = '{"a": [1, -2.5e3, true, false, null, "x\\u00e9\\n"], "b": {}}';
    expect(parseJson5(text)).toEqual(JSON.parse(text));
  });

  test("reads comments, trailing commas, unquoted keys and single quotes", () => {
    const text = `// Renovate's config
{
  /* the merge method */
  automergeStrategy: 'rebase',
  "extends": ["config:recommended",],
  $schema: 'https://docs.renovatebot.com/renovate-schema.json',
}`;
    expect(parseJson5(text)).toEqual({
      automergeStrategy: "rebase",
      extends: ["config:recommended"],
      $schema: "https://docs.renovatebot.com/renovate-schema.json",
    });
  });

  test("reads the numbers and strings JSON5 adds", () => {
    expect(parseJson5("[0x1F, .5, 5., +1, Infinity, -Infinity]")).toEqual([
      31,
      0.5,
      5,
      1,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
    expect(Number.isNaN(parseJson5("NaN"))).toBe(true);
    expect(parseJson5("'it\\'s \"quoted\"'")).toBe('it\'s "quoted"');
    expect(parseJson5("'one \\\ntwo'")).toBe("one two");
  });

  test("throws on text that is not JSON5", () => {
    for (const text of [
      "",
      "{",
      "{a b}",
      "[1 2]",
      "{'a': 1,,}",
      "'open",
      "1 2",
      "{a: undefined}",
    ]) {
      expect(() => parseJson5(text)).toThrow();
    }
  });

  test("keeps a key named __proto__ as data", () => {
    const parsed = parseJson5('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
  });
});
