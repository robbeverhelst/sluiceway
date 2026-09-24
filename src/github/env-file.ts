// The env file as a step reads it (record 0100): the one file the `env-file`
// input names, read once by the glue of a mode that runs the tool, before
// anything else. Every value is masked first, the job log gets the names and
// never a value, and the tool's environment is the job's with the file's
// values on top. Sluiceway's own facts (the repo, the run, its inputs) come
// from the runner's environment and never from the file.

import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { masks, parseEnvFile } from "../core/env-file.ts";
import { envFileGroupTitle, envFileLines } from "../render/env-file.ts";
import type { JobLog } from "./job-log.ts";

export interface EnvFileLoad {
  // What the input says, or nothing.
  input: string | undefined;
  // The directory of the checked-out repo, which a relative path is under.
  root: string;
  // The environment of the job, as the glue read it once.
  env: Record<string, string | undefined>;
  // `core.setSecret`: the runner then writes *** wherever the value would
  // appear in the job log.
  mask: (value: string) => void;
  log: Pick<JobLog, "group">;
}

export function loadEnvFile(load: EnvFileLoad): Record<string, string | undefined> {
  const { input, root, env } = load;
  if (input === undefined) return env;
  const path = isAbsolute(input) ? input : resolve(root, input);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT") {
      throw new Error(
        `The "env-file" input names ${input}, and there is no such file${isAbsolute(input) ? "" : " in the checkout"}.`,
      );
    }
    throw new Error(
      `The "env-file" input names ${input}, and it could not be read as a file (${typeof code === "string" ? code : "unknown error"}).`,
    );
  }
  const parsed = parseEnvFile(text);
  if (!parsed.ok) throw new Error(`The env file ${input} cannot be loaded. ${parsed.problem}`);
  const { values } = parsed;
  // Masks first, before a line of the log could hold a value.
  for (const value of Object.values(values)) for (const mask of masks(value)) load.mask(mask);
  const replaced = Object.keys(values).filter((name) => env[name] !== undefined);
  load.log.group(envFileGroupTitle(input), envFileLines(values, replaced));
  return { ...env, ...values };
}
