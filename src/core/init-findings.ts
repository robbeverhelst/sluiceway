// The shape of what init learns from the files of a repo (record 0065): the
// stacks a new sluiceway.yaml can declare, and what the workflow has to
// install for the stacks there are. The words of init in render/ read it,
// so core/ holds it and reaches no adapters/ file for it, not even by a type
// import (issue 245). The finding itself knows tool files, so it sits with
// the adapters, in adapters/init-findings.ts.

// A directory of .tf or .tofu files that looks like a root module. With more
// than one var file, each gets a stack of its own with a workspace of the same
// name: two stacks of one root module in one workspace would share one state,
// and a deploy of one would undo the other.
export interface OpenTofuRoot {
  path: string;
  varFiles: string[];
}

// A local application chart. Files cannot say which release it is installed
// as or in which namespace, so both start as the chart's name.
export interface HelmChart {
  path: string;
  release: string;
}

export interface Declarable {
  opentofu: OpenTofuRoot[];
  helm: HelmChart[];
}

// The id of each stack an OpenTofu root becomes, as its entry declares it.
export function openTofuStacks(root: OpenTofuRoot): { name?: string; varFile?: string }[] {
  if (root.varFiles.length === 0) return [{}];
  const [only] = root.varFiles;
  if (root.varFiles.length === 1 && only !== undefined) return [{ varFile: only }];
  return root.varFiles.map((varFile) => ({ name: varFileName(varFile), varFile }));
}

function varFileName(file: string): string {
  return file.replace(/\.tfvars(\.json)?$/, "");
}

// What the workflow has to install, from the stacks the config gives.
export interface WorkflowFindings {
  pulumi: boolean;
  opentofu: boolean;
  helm: boolean;
  // Declared in a sluiceway.yaml that is there: files alone never declare one
  // (record 0060).
  kubectl: boolean;
  node: NodeFindings | undefined;
  // Pulumi projects in another language than JavaScript or YAML, by runtime:
  // `pulumi install` gets their packages.
  otherRuntimes: { runtime: string; paths: string[] }[];
  // Chart repositories a local chart's dependencies come from, which the
  // workflow has to add before a preview.
  helmRepositories: string[];
  // An env file of secret references (docs/credentials.md), per job.
  envFiles: EnvFiles | undefined;
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface NodeFindings {
  // Where to install, with which package manager: the directory of the
  // nearest lockfile of every Node project, once.
  installs: { directory: string; manager: PackageManager }[];
  // Node projects with no lockfile at or above them.
  withoutLockfile: string[];
  // A file that names the Node version.
  versionFile: string | undefined;
  // Yarn 2 or newer, which corepack installs.
  yarnBerry: boolean;
  // pnpm with no version in package.json for its setup action to read.
  pnpmWithoutVersion: boolean;
}

export interface EnvFiles {
  preview: string;
  deploy: string;
  // Other env files of references that init did not use.
  others: string[];
}
