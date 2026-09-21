import { describe, expect, test } from "bun:test";
import { globMatcher, globOf } from "../../src/core/glob.ts";

// The `ignore` glob a summary hands a person for one stack (slice 2.13). It
// has to take that stack off the dashboard and no other, read the way
// sluiceway.yaml reads every glob.

describe("the glob that matches one stack id and nothing else", () => {
  test("an ordinary stack id is its own glob", () => {
    expect(globOf("network:dev")).toBe("network:dev");
    expect(globOf(".:dev")).toBe(".:dev");
  });

  test("the characters a glob acts on are escaped", () => {
    expect(globOf("apps/[x]:dev")).toBe("apps/\\[x\\]:dev");
    expect(globOf("a*b?:c")).toBe("a\\*b\\?:c");
    expect(globOf("!a:b")).toBe("\\!a:b");
  });

  const ODD = [
    "network:dev",
    ".:dev",
    "apps/[x]:dev",
    "a(b):c",
    "a@(b|c):d",
    "!a:b",
    "+(a):b",
    "a{b,c}:d",
    "a*b:c",
    "a?b:c",
    "a\\b:c",
    "a b/#c:d",
  ];

  for (const id of ODD) {
    test(`${JSON.stringify(id)} matches itself and not its neighbours`, () => {
      const matches = globMatcher([globOf(id)]);
      expect(matches(id)).toBe(true);
      for (const other of [`${id}x`, `x${id}`, `${id}/x`, "a:b", "ab:c", "abc:d", "network:prod"]) {
        if (other !== id) expect(matches(other)).toBe(false);
      }
    });
  }
});
