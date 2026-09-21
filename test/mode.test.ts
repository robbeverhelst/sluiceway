import { describe, expect, test } from "bun:test";
import { MODES, NotImplementedError, parseMode, run } from "../src/mode.ts";

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
      'The "mode" input is required. Use one of: scan, resolve, apply, settle, check.',
    );
  });

  test("names the valid modes when the input is unknown", () => {
    expect(() => parseMode("deploy")).toThrow(
      'Unknown mode "deploy". Use one of: scan, resolve, apply, settle, check.',
    );
  });

  test("does not accept a different case", () => {
    expect(() => parseMode("Scan")).toThrow('Unknown mode "Scan"');
  });
});

describe("run", () => {
  // Every mode is wired: the scan (slice 1.11), resolve (slice 2.4), apply
  // (slice 2.5), settle (slice 2.6) and the check (slice 2.12) have their own
  // tests under test/modes/.
  const wired: string[] = ["scan", "resolve", "apply", "settle", "check"];
  test("no mode is a stub any more", () => {
    expect([...MODES].filter((mode) => !wired.includes(mode))).toEqual([]);
  });

  test("settle is wired: outside a job it stops at the runner's environment", async () => {
    const result = run("settle");
    await expect(result).rejects.not.toBeInstanceOf(NotImplementedError);
  });

  test("apply is wired: outside a job it stops at its deployment-id input", async () => {
    await expect(run("apply", () => "")).rejects.toThrow(
      'The "deployment-id" input is required in apply mode.',
    );
  });
});

describe("the deployment-id input (record 0035)", () => {
  test("fails any mode but apply before the mode does anything", async () => {
    await expect(run("settle", () => "12")).rejects.toThrow(
      'The "deployment-id" input is only for apply mode, and this step runs settle mode.',
    );
  });
});
