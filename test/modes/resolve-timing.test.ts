import { describe, expect, test } from "bun:test";
import { change, inSync, pending } from "./harness.ts";
import { ALICE, scanned, tick, wake } from "./resolve-harness.ts";

// The timing line of `resolve` (slice 5.23): where the time of its own work
// went, one line in the job log. The clock here moves one second for every
// request to GitHub, so a part's time is the number of requests it made.

const TABLE = {
  "a:prod": pending("a:prod", change("logs")),
  "b:prod": inSync("b:prod"),
};

function timingLines(lines: string[]): string[] {
  return lines.filter((line) => line.startsWith("Resolve took "));
}

describe("the timing line of resolve", () => {
  test("a tick gives one line that names every part of the work, in order", async () => {
    const h = await scanned(TABLE);
    h.context.now = () => new Date(h.github.requests.length * 1000);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    const [line, ...more] = timingLines(h.log.lines);
    expect(more).toEqual([]);
    expect(line).toMatch(
      /^Resolve took \d+\.\d s: reading the dashboard 1\.0 s, reading the config 0\.0 s, discovery 0\.0 s, reading deployment records [1-9]\d*\.0 s, judging ticks [1-9]\d*\.0 s, opening records [1-9]\d*\.0 s, writing the body [1-9]\d*\.0 s(, the rest \d+\.\d s)?\.$/,
    );
  });

  test("the parts add up to the requests the run made", async () => {
    const h = await scanned(TABLE);
    h.context.now = () => new Date(h.github.requests.length * 1000);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    const [line] = timingLines(h.log.lines);
    const total = Number(/^Resolve took (\d+\.\d) s/.exec(line ?? "")?.[1]);
    expect(total).toBe(h.github.requests.length);
    const parts = [...(line ?? "").matchAll(/ (\d+\.\d) s[,.]/g)].map((match) => Number(match[1]));
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
  });

  test("goes to the job log and not to the job summary", async () => {
    const h = await scanned(TABLE);
    h.context.now = () => new Date(h.github.requests.length * 1000);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(h.log.summaries.join("\n")).not.toContain("Resolve took");
  });

  test("says how long the action took to start, when the step knows", async () => {
    const h = await scanned(TABLE);
    h.context.now = () => new Date(h.github.requests.length * 1000);
    h.context.startup = 420;
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(timingLines(h.log.lines)[0]).toEndWith(" Starting the action took 0.4 s before that.");
  });

  test("with no box ticked it names the dashboard and the config only", async () => {
    const h = await scanned(TABLE);
    h.context.now = () => new Date(h.github.requests.length * 1000);
    h.github.editBody(h.number, `${h.github.issue(h.number).body}\n`, ALICE);

    await wake(h);

    expect(timingLines(h.log.lines)).toEqual([
      "Resolve took 1.0 s: reading the dashboard 1.0 s, reading the config 0.0 s.",
    ]);
  });

  test("an edit of another issue gives no line", async () => {
    const h = await scanned(TABLE);
    h.context.now = () => new Date(h.github.requests.length * 1000);

    await wake(h, {
      action: "edited",
      issue: { number: 99, state: "open", labels: [], user: ALICE, body: "hello" },
    });

    expect(timingLines(h.log.lines)).toEqual([]);
  });

  test("without a clock there is no line, and nothing else changes", async () => {
    const timed = await scanned(TABLE);
    timed.context.now = () => new Date(timed.github.requests.length * 1000);
    tick(timed, ALICE, ["a:prod"]);
    await wake(timed);

    const plain = await scanned(TABLE);
    tick(plain, ALICE, ["a:prod"]);
    await wake(plain);

    expect(timingLines(plain.log.lines)).toEqual([]);
    expect(plain.log.lines).toEqual(
      timed.log.lines.filter((line) => !line.startsWith("Resolve took ")),
    );
    expect(plain.github.issue(plain.number).body).toBe(timed.github.issue(timed.number).body);
    expect(plain.github.requests).toEqual(timed.github.requests);
  });
});
