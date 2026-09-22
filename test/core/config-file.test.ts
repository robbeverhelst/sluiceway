import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, parseConfig } from "../../src/core/config.ts";
import { configFileName, loadConfig } from "../../src/core/config-file.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sluiceway-config-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("loading sluiceway.yaml from the repo root", () => {
  test("a repo without the file gets every default", () => {
    expect(loadConfig(root)).toEqual(parseConfig(undefined));
  });

  test("the file at the root is read", () => {
    writeFileSync(join(root, "sluiceway.yaml"), "tickers: admin\n");
    expect(loadConfig(root).tickers).toBe("admin");
  });

  test("a bad file fails with the problems of the file", () => {
    writeFileSync(join(root, "sluiceway.yaml"), "tickerz: admin\n");
    expect(() => loadConfig(root)).toThrow(ConfigError);
  });

  // Slice 5.9: the second spelling is read like the first, and a problem in it
  // names the file it is in.
  test("sluiceway.yml is read as the config", () => {
    writeFileSync(join(root, "sluiceway.yml"), "tickers: admin\n");
    expect(loadConfig(root).tickers).toBe("admin");
    expect(configFileName(root)).toBe("sluiceway.yml");
  });

  test("a bad sluiceway.yml names itself", () => {
    writeFileSync(join(root, "sluiceway.yml"), "tickerz: admin\n");
    expect(() => loadConfig(root)).toThrow(/^sluiceway\.yml is not valid:\n- /);
  });

  test("both spellings at once are refused, because one of them would be dropped without a word", () => {
    writeFileSync(join(root, "sluiceway.yaml"), "tickers: write\n");
    writeFileSync(join(root, "sluiceway.yml"), "tickers: admin\n");
    expect(() => loadConfig(root)).toThrow(
      "sluiceway.yaml is not valid:\n- found both sluiceway.yaml and sluiceway.yml. Keep one of them.",
    );
  });

  test("without either file there is no config file", () => {
    expect(configFileName(root)).toBeUndefined();
  });

  test("a directory named sluiceway.yaml is refused, not read as no config", () => {
    mkdirSync(join(root, "sluiceway.yaml"));
    expect(() => loadConfig(root)).toThrow("sluiceway.yaml is not valid:\n- it is not a file.");
  });

  test("a file deeper in the repo is not the config", () => {
    mkdirSync(join(root, "apps"));
    writeFileSync(join(root, "apps", "sluiceway.yaml"), "tickerz: admin\n");
    expect(loadConfig(root)).toEqual(parseConfig(undefined));
  });
});
