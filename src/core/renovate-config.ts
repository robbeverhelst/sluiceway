// Renovate's merge setting in a repo (record 0064): the `automergeStrategy`
// Renovate would merge with, read the way Renovate reads its config on
// GitHub. Pure: the glue hands in a reader of the checkout's files, and one
// of files in GitHub repos.
//
// Only this one key is read. `automergeType` does not change the method:
// Renovate asks GitHub for the same method whatever it is, and with `branch`
// it merges no pull request at all. Renovate's own presets set no
// `automergeStrategy`, so they are left alone. A preset in this repo is read
// from the checkout. A preset of another GitHub repo, or one at a tag, is
// read through the GitHub API (record 0071). One with parameters, a relative
// one, and one from a web address, npm or another platform are named and not
// read: the last three would be a network call that is not GitHub's.

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

// A file of a GitHub repo, at a tag or on its default branch. Nothing for a
// file that is not there. Throws when GitHub gives no answer, such as for a
// private repo the workflow token cannot read.
export interface RemoteFile {
  owner: string;
  repo: string;
  path: string;
  ref: string | undefined;
}
export type ReadRemoteFile = (file: RemoteFile) => Promise<string | undefined>;

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

// A preset in a GitHub repo, as the files to try in turn and the path inside
// the first one there. `local` is a preset in this repo on the checked-out
// commit.
interface RepoPreset {
  owner: string;
  repo: string;
  ref: string | undefined;
  local: boolean;
  files: string[];
  keys: string[];
}

// Renovate's own presets: `:name`, or `<package>:name` such as
// `config:recommended`.
const INTERNAL = /^(?:[a-zA-Z]+)?:[\w.-]+$/;

function repoPreset(
  name: string,
  repo: { owner: string; repo: string },
): RepoPreset | "internal" | undefined {
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
  // A tag is the ref to read at. Parameters would need Renovate's templating.
  let ref: string | undefined;
  const hash = rest.indexOf("#");
  if (hash >= 0) {
    ref = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
    if (ref === "") return undefined;
  }
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
  const [owner = "", repoPart = "", ...extra] = repoName.split("/");
  if (owner === "" || repoPart === "" || extra.length > 0) return undefined;
  const local =
    ref === undefined && repoName.toLowerCase() === `${repo.owner}/${repo.repo}`.toLowerCase();
  const [fileName = "", ...keys] = presetName.split("/");
  if (fileName === "" || keys.length > 2) return undefined;
  const files =
    fileName === "default"
      ? [`${path}default.json`, `${path}renovate.json`]
      : [`${path}${/\.json[5c]?$/.test(fileName) ? fileName : `${fileName}.json`}`];
  return { owner, repo: repoPart, ref, local, files, keys };
}

export async function renovateMergeSetting(
  readFile: ReadFile,
  repo: { owner: string; repo: string },
  // Without it, only the presets in the checkout are read.
  readRemote?: ReadRemoteFile,
): Promise<RenovateMergeSetting> {
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

  // The text of the first file of a preset that is there, or nothing.
  const readPreset = async (preset: RepoPreset): Promise<string | undefined> => {
    for (const path of preset.files) {
      const text = preset.local
        ? readFile(path)
        : await readRemote?.({ owner: preset.owner, repo: preset.repo, path, ref: preset.ref });
      if (text !== undefined) return text;
    }
    return undefined;
  };

  // The strategy of one config: its own key wins, else the last preset in
  // `extends` that sets one, as Renovate merges them.
  const strategyOf = async (value: unknown, depth: number): Promise<string | undefined> => {
    const object = objectOf(value);
    if (!object) return undefined;
    let found: string | undefined;
    const extendsList = Array.isArray(object.extends) ? object.extends : [];
    for (const name of extendsList) {
      if (typeof name !== "string") continue;
      const preset = repoPreset(name, repo);
      if (preset === "internal") continue;
      if (preset === undefined || depth >= MAX_DEPTH || (!preset.local && !readRemote)) {
        unread.push(name);
        continue;
      }
      const key = [preset.owner, preset.repo, preset.ref ?? "", preset.local, preset.files[0]]
        .join("\n")
        .toLowerCase()
        .concat(`#${preset.keys.join("/")}`);
      if (seen.has(key)) continue;
      seen.add(key);
      let text: string | undefined;
      try {
        text = await readPreset(preset);
      } catch {
        text = undefined;
      }
      let inner = text === undefined ? undefined : parse(text);
      for (const part of preset.keys) inner = objectOf(inner)?.[part];
      if (objectOf(inner) === undefined) {
        unread.push(name);
        continue;
      }
      found = (await strategyOf(inner, depth + 1)) ?? found;
    }
    const own = object.automergeStrategy;
    return typeof own === "string" ? own : found;
  };

  return { strategy: await strategyOf(config, 0), file, unread };
}
