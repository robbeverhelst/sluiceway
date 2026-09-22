// The init mode (record 0065). From the files of the checkout it writes a
// starter workflow and a sluiceway.yaml into the checkout, and says what it
// wrote and what is left for a person. It never commits and never opens a
// pull request: the person reviews the files. Like the check, it reads files
// and nothing else: no tool, no credential, no GitHub call.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Adapter } from "../adapters/adapter.ts";
import { findDeclarable, findForWorkflow, type Read } from "../adapters/init-findings.ts";
import { checkSetup } from "../core/check.ts";
import { type Config, parseConfig } from "../core/config.ts";
import { CONFIG_FILE, hasConfigFile, loadConfig } from "../core/config-file.ts";
import { repoFiles } from "../core/repo-files.ts";
import { stackId } from "../core/stack.ts";
import { checkWorkflows, readWorkflowFiles } from "../core/workflow-check.ts";
import type { JobLog } from "../github/job-log.ts";
import { foundText } from "../render/check.ts";
import {
  EXPORT_ENV,
  EXPORT_ENV_FILE,
  KEPT_CONFIG,
  NEEDS_A_PERSON,
  NOT_A_REPO_ROOT,
  needsText,
  noStacksText,
  starterConfig,
  starterWorkflow,
  WORKFLOW_FILE,
  workflowExistsText,
  wroteText,
} from "../render/init.ts";

export interface InitContext {
  // The directory of the checked-out repo.
  root: string;
  adapter: Pick<Adapter, "discover">;
  log: JobLog;
}

export async function init(context: InitContext): Promise<void> {
  const { root, log } = context;
  // Files written anywhere else would be read by nobody.
  if (!existsSync(join(root, ".git"))) throw new Error(NOT_A_REPO_ROOT);

  // A config that is there is the person's: it is read the way a scan reads
  // it, and kept as it is.
  const configKept = hasConfigFile(root);
  const existing = loadConfig(root);

  // One workflow runs Sluiceway, and init never overwrites a file.
  const running = checkWorkflows(readWorkflowFiles(root), existing)
    .workflows.filter(({ jobs }) =>
      jobs.some(({ runs }) => runs.some((mode) => mode !== "check" && mode !== "init")),
    )
    .map(({ path }) => path);
  const taken = [...new Set([...running, ...(exists(root, WORKFLOW_FILE) ? [WORKFLOW_FILE] : [])])];
  if (taken.length > 0) throw new Error(workflowExistsText(taken.sort()));

  const files = await repoFiles(root);
  const read: Read = (file) => {
    try {
      return readFileSync(join(root, file), "utf8");
    } catch {
      return undefined;
    }
  };

  const found = await context.adapter.discover(root, existing);
  const declarable = configKept
    ? { opentofu: [], helm: [] }
    : findDeclarable(
        files,
        read,
        found.map(({ path }) => path),
      );

  // The config as init would write it, first without scan.unrelated, to find
  // which files its stacks leave unclaimed.
  let config: Config = existing;
  let configText: string | undefined;
  let stacks = found;
  if (!configKept) {
    const declared = starterConfig({ declarable, unrelated: [], unclaimed: undefined });
    config = parseConfig(declared);
    stacks = await context.adapter.discover(root, config);
  }
  if (stacks.length === 0) throw new Error(noStacksText());

  const findings = findForWorkflow(stacks, files, read);
  const written = [
    WORKFLOW_FILE,
    ...(configKept ? [] : [CONFIG_FILE]),
    ...(findings.envFiles !== undefined && !exists(root, EXPORT_ENV_FILE) ? [EXPORT_ENV_FILE] : []),
  ];

  if (!configKept) {
    const report = checkSetup(config, stacks, [...new Set([...files, ...written])].sort());
    const unrelated = report.suggested;
    // Directories of files that neither a stack nor a suggested glob claims.
    const covered = checkSetup(
      parseConfig(starterConfig({ declarable, unrelated, unclaimed: undefined })),
      stacks,
      files,
    );
    // The root's own files are the shared ones a full scan is for (record
    // 0010), so only directories get the hint.
    const directories = [
      ...new Set(
        covered.unclaimed.flatMap(({ files: unclaimed }) =>
          unclaimed.map((file) => dirname(file)).filter((directory) => directory !== "."),
        ),
      ),
    ].sort();
    const [first] = directories;
    configText = starterConfig({
      declarable,
      unrelated,
      unclaimed:
        first === undefined
          ? undefined
          : {
              directories,
              stack: nearest(
                first,
                stacks.map(({ path }) => path),
              ),
            },
    });
    // What init writes is what a scan reads: the same loading and discovery.
    config = parseConfig(configText);
    stacks = await context.adapter.discover(root, config);
  }

  const branch = defaultBranch(root);
  const workflow = starterWorkflow({
    findings,
    branch,
    merges: config.mergeAndDeploy.authors.length > 0,
  });

  write(root, WORKFLOW_FILE, workflow);
  if (configText !== undefined) write(root, CONFIG_FILE, configText);
  if (written.includes(EXPORT_ENV_FILE)) write(root, EXPORT_ENV_FILE, EXPORT_ENV);

  log.info(foundText(stacks.length));
  log.group(
    "Stacks",
    stacks.map((stack) => stackId(stack)),
  );
  for (const file of written) log.info(wroteText(file));
  if (configKept) log.info(KEPT_CONFIG);
  log.group(
    NEEDS_A_PERSON,
    needsText({ findings, declarable, branchGuessed: branch === undefined }).map(
      (need) => `- ${need}`,
    ),
  );
}

// The stack path that shares the most leading directories with this one, the
// first of them on a tie, for the example in the inputs hint.
function nearest(directory: string, paths: string[]): string {
  const shared = (path: string) => {
    const a = directory.split("/");
    const b = path.split("/");
    let count = 0;
    while (count < a.length && a[count] === b[count]) count++;
    return count;
  };
  return paths.reduce((best, path) => (shared(path) > shared(best) ? path : best));
}

function exists(root: string, file: string): boolean {
  return existsSync(join(root, file));
}

function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text, { flag: "wx" });
}

// The default branch as a clone records it, from the files of .git alone. A
// checkout of a workflow has no such file.
function defaultBranch(root: string): string | undefined {
  const file = join(root, ".git", "refs", "remotes", "origin", "HEAD");
  try {
    if (!statSync(join(root, ".git")).isDirectory()) return undefined;
    const match = /^ref: refs\/remotes\/origin\/(\S+)\s*$/.exec(readFileSync(file, "utf8"));
    return match?.[1];
  } catch {
    return undefined;
  }
}
