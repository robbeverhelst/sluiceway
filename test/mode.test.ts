import { describe, expect, test } from "bun:test";
import { MODES, NotImplementedError, parseMode, run } from "../src/mode.ts";

describe("parseMode", () => {
  test.each([...MODES])("accepts %s", (mode) => {
    expect(parseMode(mode)).toBe(mode);
  });

  test("ignores surrounding whitespace", () => {
    expect(parseMode(" scan\n")).toBe("scan");
  });

  test("names the valid modes when the input is empty", () => {
    expect(() => parseMode("")).toThrow(
      'The "mode" input is required. Use one of: scan, resolve, apply, settle.',
    );
  });

  test("names the valid modes when the input is unknown", () => {
    expect(() => parseMode("deploy")).toThrow(
      'Unknown mode "deploy". Use one of: scan, resolve, apply, settle.',
    );
  });

  test("does not accept a different case", () => {
    expect(() => parseMode("Scan")).toThrow('Unknown mode "Scan"');
  });
});

describe("run", () => {
  // The scan (slice 1.11) and resolve (slice 2.4) are wired and have their own
  // tests under test/modes/.
  const stubs = MODES.filter((mode) => mode !== "scan" && mode !== "resolve");

  test.each(stubs)("%s fails as not implemented yet", async (mode) => {
    const result = run(mode);
    await expect(result).rejects.toBeInstanceOf(NotImplementedError);
    await expect(result).rejects.toThrow(`Mode "${mode}" is not implemented yet.`);
  });
});
