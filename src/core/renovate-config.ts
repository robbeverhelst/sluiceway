// Renovate's merge setting in a repo (record 0064): the `automergeStrategy`
// Renovate would merge with, read the way Renovate reads its config on
// GitHub. Pure: the glue hands in a reader of the checkout's files.
//
// Only this one key is read. `automergeType` does not change the method:
// Renovate asks GitHub for the same method whatever it is, and with `branch`
// it merges no pull request at all. Renovate's own presets set no
// `automergeStrategy`, so they are left alone. A preset of another repo, one
// at a tag, one with parameters, and one from a web address or npm would each
// be a read outside the checkout, so they are named and not read.

import { parseJson5 } from "./json5.ts";

// Where Renovate looks on GitHub, in its own order (Renovate's
// `configFilePatterns`, with the GitLab files it skips on GitHub left out).
// The first that exists is the config.
export const RENOVATE_CONFIG_FILES = [
  "renovate.json",
  "renovate.jsonc",
  "renovate.json5",
  ".github/renovate.json",
  ".github/renovate.jsonc",
  ".github/renovate.json5",
  ".renovaterc",
  ".renovaterc.json",
  ".renovaterc.jsonc",
  ".renovaterc.json5",
  // Its `renovate` key, and only when it has one.
  "package.json",
];

export interface RenovateMergeSetting {
  // As Renovate writes it: `auto`, `fast-forward`, `merge-commit`, `rebase` or
  // `squash`. Nothing when no file read sets it.
  strategy: string | undefined;
  // The config file, or nothing when the repo has none.
  file: string | undefined;
  // The presets in `extends` that were not read, as the config names them.
  unread: string[];
}

type ReadFile = (path: string) => string | undefined;

// How deep presets inside presets are followed. A merge setting sits in the
// first few.
const MAX_DEPTH = 10;

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parse(text: string): unknown {
  try {
    return parseJson5(text);
  } catch {
    return undefined;
  }
}

// A preset that lives in this repo, as the file to read and the path inside it.
interface LocalPreset {
  files: string[];
  keys: string[];
}

// Renovate's own presets: `:name`, or `<package>:name` such as
// `config:recommended`.
const INTERNAL = /^(?:[a-zA-Z]+)?:[\w.-]+$/;

function localPreset(
  name: string,
  repo: { owner: string; repo: string },
): LocalPreset | "internal" | undefined {
  if (INTERNAL.test(name)) return "internal";
  let rest: string;
  if (name.startsWith("github>")) rest = name.slice("github>".length);
  else if (name.startsWith("local>")) rest = name.slice("local>".length);
  else if (
    !name.startsWith("@") &&
    !name.includes(">") &&
    !/^[./]/.test(name) &&
    name.includes("/") &&
    !name.includes("://")
  )
    rest = name;
  else return undefined;
  if (/[#()]/.test(rest)) return undefined;

  let repoName: string;
  let path = "";
  let presetName: string;
  const slashes = rest.indexOf("//");
  if (slashes >= 0) {
    repoName = rest.slice(0, slashes);
    const inner = rest.slice(slashes + 2).split("/");
    presetName = inner.pop() ?? "";
    path = inner.length > 0 ? `${inner.join("/")}/` : "";
  } else {
    const colon = rest.indexOf(":");
    repoName = colon < 0 ? rest : rest.slice(0, colon);
    presetName = colon < 0 ? "default" : rest.slice(colon + 1);
  }
  if (repoName.toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase()) return undefined;
  const [fileName = "", ...keys] = presetName.split("/");
  if (fileName === "" || keys.length > 2) return undefined;
  const files =
    fileName === "default"
      ? [`${path}default.json`, `${path}renovate.json`]
      : [`${path}${/\.json[5c]?$/.test(fileName) ? fileName : `${fileName}.json`}`];
  return { files, keys };
}

export function renovateMergeSetting(
  readFile: ReadFile,
  repo: { owner: string; repo: string },
): RenovateMergeSetting {
  let file: string | undefined;
  let config: unknown;
  for (const name of RENOVATE_CONFIG_FILES) {
    const text = readFile(name);
    if (text === undefined) continue;
    if (name === "package.json") {
      const inner = objectOf(parse(text))?.renovate;
      if (inner === undefined) continue;
      config = inner;
    } else {
      config = parse(text);
    }
    file = name;
    break;
  }

  const unread: string[] = [];
  const seen = new Set<string>();

  // The strategy of one config: its own key wins, else the last preset in
  // `extends` that sets one, as Renovate merges them.
  const strategyOf = (value: unknown, depth: number): string | undefined => {
    const object = objectOf(value);
    if (!object) return undefined;
    let found: string | undefined;
    const extendsList = Array.isArray(object.extends) ? object.extends : [];
    for (const name of extendsList) {
      if (typeof name !== "string") continue;
      const preset = localPreset(name, repo);
      if (preset === "internal") continue;
      if (preset === undefined || depth >= MAX_DEPTH) {
        unread.push(name);
        continue;
      }
      const key = `${preset.files[0]}#${preset.keys.join("/")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = preset.files.map(readFile).find((one) => one !== undefined);
      let inner = text === undefined ? undefined : parse(text);
      for (const part of preset.keys) inner = objectOf(inner)?.[part];
      if (objectOf(inner) === undefined) {
        unread.push(name);
        continue;
      }
      found = strategyOf(inner, depth + 1) ?? found;
    }
    const own = object.automergeStrategy;
    return typeof own === "string" ? own : found;
  };

  return { strategy: strategyOf(config, 0), file, unread };
}
