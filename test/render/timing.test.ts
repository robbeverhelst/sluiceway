import { describe, expect, test } from "bun:test";
import { resolveTimingLine } from "../../src/render/timing.ts";

describe("the timing line of resolve", () => {
  test("names each part it measured, in the order of the work, in seconds", () => {
    expect(
      resolveTimingLine({
        total: 4120,
        parts: {
          dashboard: 410,
          config: 12,
          discovery: 95,
          records: 330,
          ticks: 640,
          opening: 480,
          body: 2150,
        },
      }),
    ).toBe(
      "Resolve took 4.1 s: reading the dashboard 0.4 s, reading the config 0.0 s, discovery 0.1 s, reading deployment records 0.3 s, judging ticks 0.6 s, opening records 0.5 s, writing the body 2.2 s.",
    );
  });

  test("leaves out a part that did not run, and names the time no part holds", () => {
    expect(resolveTimingLine({ total: 1500, parts: { body: 900, dashboard: 300 } })).toBe(
      "Resolve took 1.5 s: reading the dashboard 0.3 s, writing the body 0.9 s, the rest 0.3 s.",
    );
  });

  test("says how long the action took to start, when the step knows", () => {
    expect(resolveTimingLine({ total: 600, parts: { dashboard: 600 }, startup: 340 })).toBe(
      "Resolve took 0.6 s: reading the dashboard 0.6 s. Starting the action took 0.3 s before that.",
    );
  });

  test("with nothing measured it gives the total alone", () => {
    expect(resolveTimingLine({ total: 50, parts: {} })).toBe("Resolve took 0.1 s.");
  });
});
