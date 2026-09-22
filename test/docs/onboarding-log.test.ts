import { describe, expect, test } from "bun:test";
import { ROOT, read } from "./docs.ts";

// Slice 4.8: records, slices, code and tests cite the onboarding log by the
// number of a hurdle, so a number names one hurdle and never two.

const log = read("docs/onboarding-log.md");

// The number in the first cell of every row of the log's tables.
const numbers = [...log.matchAll(/^\| (\d+) \|/gm)].map((match) => Number(match[1]));

// Every place in the repo that cites a hurdle by number: "hurdle 21",
// "hurdles 9 and 14", "hurdles 3, 5 and 11", but not the record in "hurdle
// 16, 0025". The log itself is left out, and
// so is the changelog, which quotes old commit messages.
const citations = ["*.md", "docs/**/*.md", "src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts"]
  .flatMap((glob) => [...new Bun.Glob(glob).scanSync(ROOT)])
  .filter((path) => path !== "docs/onboarding-log.md" && path !== "CHANGELOG.md")
  .flatMap((path) =>
    [...read(path).matchAll(/\bhurdles? ([1-9]\d?(?:(?:, | and )[1-9]\d?\b)*)/gi)].flatMap(
      (match) =>
        (match[1] ?? "").split(/, | and /).map((number) => ({ path, number: Number(number) })),
    ),
  );

describe("the numbers of the onboarding log", () => {
  test("run from 1 without a gap or a number used twice", () => {
    expect(numbers.length).toBeGreaterThan(20);
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });

  test("every hurdle cited by number exists", () => {
    expect(citations.length).toBeGreaterThan(20);
    const missing = citations.filter(({ number }) => !numbers.includes(number));
    expect(missing.map(({ path, number }) => `${path}: hurdle ${number}`)).toEqual([]);
  });
});
