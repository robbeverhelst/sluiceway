import { describe, expect, test } from "bun:test";
import { MODES, NotImplementedError, parseMode, run } from "../src/mode.ts";

// Where a runner puts the action, handed in by the entry point.
const ACTION = "/home/runner/work/_actions/sluiceway/sluiceway/v0";

describe("parseMode", () => {
  test.each([...MODES])("accepts %s", (mode) => {
    expect(parseMode(mode)).toBe(mode);
  });

  // Record 0042.
  test("check is the fifth mode", () => {
    expect(parseMode("check")).toBe("check");
  });

  test("ignores surrounding whitespace", () => {
    expect(parseMode(" scan\n")).toBe("scan");
  });

  test("names the valid modes when the input is empty", () => {
    expect(() => parseMode("")).toThrow(
      'The "mode" input is required. Use one of: scan, resolve, apply, settle, check, init.',
    );
  });

  test("names the valid modes when the input is unknown", () => {
    expect(() => parseMode("deploy")).toThrow(
      'Unknown mode "deploy". Use one of: scan, resolve, apply, settle, check, init.',
    );
  });

  test("does not accept a different case", () => {
    expect(() => parseMode("Scan")).toThrow('Unknown mode "Scan"');
  });
});

describe("run", () => {
  // Every mode is wired: the scan (slice 1.11), resolve (slice 2.4), apply
  // (slice 2.5), settle (slice 2.6), the check (slice 2.12) and init (slice
  // 4.14) have their own tests under test/modes/.
  const wired: string[] = ["scan", "resolve", "apply", "settle", "check", "init"];
  test("no mode is a stub any more", () => {
    expect([...MODES].filter((mode) => !wired.includes(mode))).toEqual([]);
  });

  test("settle is wired: outside a job it stops at the runner's environment", async () => {
    const result = run("settle", ACTION);
    await expect(result).rejects.not.toBeInstanceOf(NotImplementedError);
  });

  test("apply is wired: outside a job it stops at its deployment-id input", async () => {
    await expect(run("apply", ACTION, () => "")).rejects.toThrow(
      'The "deployment-id" input is required in apply mode.',
    );
  });
});

describe("the deployment-id input (record 0035)", () => {
  test("fails any mode but apply before the mode does anything", async () => {
    await expect(run("settle", ACTION, () => "12")).rejects.toThrow(
      'The "deployment-id" input is only for apply mode, and this step runs settle mode.',
    );
  });
});

// Slice 5.13 (record 0078): only scan, resolve and apply send.
describe("a notification input on a step that sends nothing", () => {
  test("is a warning that names it, and never an error about it", async () => {
    const warnings: string[] = [];
    const inputs = (name: string) =>
      name === "slack-webhook-url" ? "https://hooks.slack.com/services/SECRET" : "";
    const result = run("settle", ACTION, inputs, (message) => void warnings.push(message));
    // Outside a job, settle stops at the runner's environment.
    await expect(result).rejects.not.toThrow("slack");
    expect(warnings).toEqual([
      '"slack-webhook-url" is set on a step in settle mode, which sends no notification. Only scan, resolve and apply do. Take it out of this step.',
    ]);
  });
});
