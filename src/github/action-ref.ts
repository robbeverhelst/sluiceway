// The action's own version (build plan, section 3). The header images are
// served from the exact release tag of the running action, or its commit SHA,
// never from a moving tag, because a file must never change behind a url
// (record 0033). The footer's version line uses the same value.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ActionRefFacts {
  // `GITHUB_ACTION_REF`. Empty or absent for `uses: ./`.
  actionRef: string | undefined;
  // `version` from the package.json next to the action. It is read at run
  // time and not compiled into `dist/`, because release-please changes
  // package.json in its release pull request and cannot rebuild `dist/`.
  packageVersion: string | undefined;
  // `GITHUB_SHA`.
  sha: string;
}

const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const EXACT_TAG = /^v\d+\.\d+\.\d+$/;

export function isExactRef(ref: string): boolean {
  return FULL_SHA.test(ref) || EXACT_TAG.test(ref);
}

export function actionRef(facts: ActionRefFacts): string {
  // 3. `uses: ./` has no action ref. The action is the checked out commit.
  if (!facts.actionRef) return facts.sha;
  // 1. A full commit SHA or an exact version tag.
  if (isExactRef(facts.actionRef)) return facts.actionRef;
  // 2. A branch or a moving tag such as `v0`.
  if (!facts.packageVersion)
    throw new Error(
      `The action was started from the ref ${facts.actionRef}, which can move, and its package.json holds no version. The header images need an exact release tag or a commit SHA.`,
    );
  return `v${facts.packageVersion}`;
}

function packageVersion(path: string, readFile: (path: string) => string): string | undefined {
  try {
    const version: unknown = JSON.parse(readFile(path)).version;
    return typeof version === "string" && version !== "" ? version : undefined;
  } catch {
    return undefined;
  }
}

// The directory the action was downloaded to, from the address of the file
// that runs. A runner sets GITHUB_ACTION_PATH for composite actions only, so a
// JavaScript action has to find its own files (seen in the lab: the action at
// `_actions/<owner>/<repo>/<ref>/`, the working directory the workspace). The
// entry point hands in its own `import.meta.url`: `dist/index.js` in the
// bundle and `src/main.ts` in the source, both one directory below the
// action's own, next to package.json.
export function actionDirectory(entryUrl: string): string {
  return dirname(dirname(fileURLToPath(entryUrl)));
}

// Works the ref out once per job, from the environment as data. The file is
// read only when the rule needs it.
export function readActionRef(
  env: Readonly<Record<string, string | undefined>>,
  directory: string,
  readFile: (path: string) => string,
): string {
  const sha = env.GITHUB_SHA;
  if (!sha) throw new Error("GITHUB_SHA is not set, so the action cannot tell its own version.");
  const ref = env.GITHUB_ACTION_REF;
  const needsVersion = Boolean(ref) && !isExactRef(ref ?? "");
  return actionRef({
    actionRef: ref,
    packageVersion: needsVersion
      ? packageVersion(join(directory, "package.json"), readFile)
      : undefined,
    sha,
  });
}
