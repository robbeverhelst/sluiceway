import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Config, ConfigError, parseConfig } from "./config.ts";

// At the repo root, and nowhere else.
export const CONFIG_FILE = "sluiceway.yaml";
const FILE = CONFIG_FILE;
// Never read. A config under this name would be passed over without a word,
// and its tick rule with it, so it is refused instead.
const WRONG_FILE = "sluiceway.yml";

// Reads the optional sluiceway.yaml at the root of the checked-out repo.
export function loadConfig(root: string): Config {
  if (existsSync(join(root, WRONG_FILE))) {
    throw new ConfigError([`found ${WRONG_FILE}. The file must be named ${FILE}. Rename it.`]);
  }
  return parseConfig(read(join(root, FILE)));
}

function read(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    if (code === "EISDIR") throw new ConfigError(["it is not a file."]);
    throw error;
  }
}
