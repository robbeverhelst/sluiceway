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
  // The scan (slice 1.11), resolve (slice 2.4), settle (slice 2.6) and the
  // check (slice 2.12) are wired and have their own tests under test/modes/.
  const wired = ["scan", "resolve", "settle", "check"];
  const stubs = MODES.filter((mode) => !wired.includes(mode));

  test.each(stubs)("%s fails as not implemented yet", async (mode) => {
    const result = run(mode);
    await expect(result).rejects.toBeInstanceOf(NotImplementedError);
    await expect(result).rejects.toThrow(`Mode "${mode}" is not implemented yet.`);
  });

  test("settle is wired: outside a job it stops at the runner's environment", async () => {
    const result = run("settle");
    await expect(result).rejects.not.toBeInstanceOf(NotImplementedError);
  });
});
