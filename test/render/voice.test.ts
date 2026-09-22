import { describe, expect, test } from "bun:test";
import {
  DRY,
  GOOD_NEWS,
  INSTRUCTION_LINE,
  NOTHING_TO_DEPLOY,
  PREVIEW_FAILED_LINE,
  WARM,
} from "../../src/render/voice.ts";

// Three days in a row, UTC. 2026-09-21 is day 20,717 since 1970-01-01, and
// 20,717 is 2 more than a multiple of three.
const DAY = (date: string, time = "12:00:00Z") => new Date(`${date}T${time}`);

// The strings of records 0032 and 0075, copied from the records and not from
// the code.
describe("the voice lives in two lines", () => {
  test("the good-news line", () => {
    expect(WARM.goodNews(58, DAY("2026-09-19"))).toBe(
      "Gate closed, water calm. Nothing to deploy.",
    );
    expect(DRY.goodNews(58, DAY("2026-09-19"))).toBe(
      "Nothing to deploy. All 58 stacks are in sync.",
    );
  });

  test("the first-run line", () => {
    expect(WARM.firstRun).toBe(
      "The channel is dry. Add a stack to `sluiceway.yaml` and the next scan fills it.",
    );
    expect(DRY.firstRun).toBe(
      "No stacks found yet. Add one to `sluiceway.yaml` and the next scan lists it here.",
    );
  });

  test("a warm line never carries a number", () => {
    for (const day of ["2026-09-19", "2026-09-20", "2026-09-21"]) {
      expect(WARM.goodNews(58, DAY(day))).toBe(WARM.goodNews(1, DAY(day)));
      expect(WARM.goodNews(58, DAY(day)) + WARM.firstRun).not.toMatch(/\d/);
    }
  });

  test("the dry good-news line with one stack", () => {
    expect(DRY.goodNews(1, DAY("2026-09-19"))).toBe("Nothing to deploy. 1 stack is in sync.");
  });
});

// Record 0075: a set of three warm good-news lines, one per day in turn, so
// the same scan day always gives the same body.
describe("the good-news lines rotate by the day", () => {
  test("three lines, each one water image and then the fact", () => {
    expect(GOOD_NEWS).toEqual([
      "Gate closed, water calm. Nothing to deploy.",
      "Level water on both sides of the gate. Nothing to deploy.",
      "Still water upstream. Nothing to deploy.",
    ]);
  });

  test("three days in a row give the three lines in turn, and the fourth starts again", () => {
    expect(
      ["2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22"].map((day) =>
        WARM.goodNews(5, DAY(day)),
      ),
    ).toEqual([GOOD_NEWS[0], GOOD_NEWS[1], GOOD_NEWS[2], GOOD_NEWS[0]]);
  });

  test("the day is the UTC day: the first and the last minute of it give the same line", () => {
    expect(WARM.goodNews(5, DAY("2026-09-20", "00:00:00Z"))).toBe(GOOD_NEWS[1]);
    expect(WARM.goodNews(5, DAY("2026-09-20", "23:59:59Z"))).toBe(GOOD_NEWS[1]);
  });

  test("without a day it is the first line", () => {
    expect(WARM.goodNews(5, undefined)).toBe(GOOD_NEWS[0]);
    expect(WARM.goodNews(5, new Date("not a time"))).toBe(GOOD_NEWS[0]);
  });

  test("the dry line does not rotate", () => {
    expect(DRY.goodNews(5, DAY("2026-09-20"))).toBe(DRY.goodNews(5, DAY("2026-09-21")));
  });
});

describe("every other line is plain", () => {
  test("the words", () => {
    expect(INSTRUCTION_LINE).toBe("Tick a box to deploy that stack exactly as its row shows it.");
    expect(NOTHING_TO_DEPLOY).toBe("Nothing to deploy.");
    expect(PREVIEW_FAILED_LINE).toBe(
      "These stacks could not be previewed, so they cannot be deployed from here until a scan succeeds.",
    );
  });

  // The writing rules of record 0032 and the plan's rules of work.
  test("no exclamation mark, no em-dash, no emoji and no first person anywhere", () => {
    const all = [
      ...GOOD_NEWS,
      WARM.firstRun,
      DRY.goodNews(58, undefined),
      DRY.goodNews(1, undefined),
      DRY.firstRun,
      INSTRUCTION_LINE,
      NOTHING_TO_DEPLOY,
      PREVIEW_FAILED_LINE,
    ].join("\n");
    expect(all).not.toMatch(/[!\u2014\u2013]|:[a-z_]+:|\p{Extended_Pictographic}/u);
    expect(all).not.toMatch(/\b(I|I'm|me|my|we|our)\b/);
  });
});
