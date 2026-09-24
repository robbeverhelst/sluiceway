// The env file as a step reads it (record 0100): the one file the `env-file`
// input names, read once by the glue of a mode that runs the tool, before
// anything else. Every value is masked first, the job log gets the names and
// never a value, and the tool's environment is the job's with the file's
// values on top. Sluiceway's own facts (the repo, the run, its inputs) come
// from the runner's environment and never from the file.
//
// The env file of a stack (record 0103): the file a `stacks` entry names with
// `envFile`, which the tool gets for that stack alone, on top of the
// environment of the step. The same read, the same masks and the same words
// in the job log, once per file however many stacks name it. A file that
// cannot be loaded fails the preview of its stacks and nothing else, so the
// loader of a stack's file never throws.

import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { masks, parseEnvFile, type StackEnv, type StackEnvLoader } from "../core/env-file.ts";
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
  const read = readEnvFile(input, root, 'The "env-file" input');
  if (!read.ok) throw new Error(read.problem);
  const { values } = read;
  // Masks first, before a line of the log could hold a value.
  for (const value of Object.values(values)) for (const mask of masks(value)) load.mask(mask);
  const replaced = Object.keys(values).filter((name) => env[name] !== undefined);
  load.log.group(envFileGroupTitle(input), envFileLines(values, replaced));
  return { ...env, ...values };
}

export type StackEnvFilesLoad = Omit<EnvFileLoad, "input">;

// The loader of a job: every file once, masked before it is named, and the
// environment of each stack asked for, by stack id.
export function stackEnvFiles(load: StackEnvFilesLoad): StackEnvLoader {
  const { root, env } = load;
  const loaded = new Map<string, StackEnv>();
  return (stacks) => {
    const envs = new Map<string, StackEnv>();
    for (const { id, envFile } of stacks) {
      if (envFile === undefined) {
        envs.set(id, { ok: true, env });
        continue;
      }
      let own = loaded.get(envFile);
      if (own === undefined) {
        own = loadStackEnvFile(
          load,
          envFile,
          stacks.flatMap((one) => (one.envFile === envFile ? [one.id] : [])),
        );
        loaded.set(envFile, own);
      }
      envs.set(id, own);
    }
    return envs;
  };
  function loadStackEnvFile(
    load: StackEnvFilesLoad,
    envFile: string,
    stackIds: string[],
  ): StackEnv {
    const read = readEnvFile(envFile, root, "The envFile of the stack");
    if (!read.ok) return { ok: false, detail: [read.problem] };
    const { values } = read;
    for (const value of Object.values(values)) for (const mask of masks(value)) load.mask(mask);
    const replaced = Object.keys(values).filter((name) => env[name] !== undefined);
    load.log.group(
      `${envFileGroupTitle(envFile)} for ${stackIds.join(", ")}`,
      envFileLines(values, replaced),
    );
    return { ok: true, env: { ...env, ...values } };
  }
}

type ReadEnvFile = { ok: true; values: Record<string, string> } | { ok: false; problem: string };

// One file, by the rules of record 0100. `who` names what asked for it, for
// the words of a file that is not there.
function readEnvFile(input: string, root: string, who: string): ReadEnvFile {
  const path = isAbsolute(input) ? input : resolve(root, input);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        problem: `${who} names ${input}, and there is no such file${isAbsolute(input) ? "" : " in the checkout"}.`,
      };
    }
    return {
      ok: false,
      problem: `${who} names ${input}, and it could not be read as a file (${typeof code === "string" ? code : "unknown error"}).`,
    };
  }
  const parsed = parseEnvFile(text);
  if (!parsed.ok)
    return { ok: false, problem: `The env file ${input} cannot be loaded. ${parsed.problem}` };
  return parsed;
}
