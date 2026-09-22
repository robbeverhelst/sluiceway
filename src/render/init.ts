// The words of init (record 0065): the starter workflow, the starter
// sluiceway.yaml and what init prints. The facts come from
// adapters/init-findings.ts.

// The script of docs/credentials.md, as the examples ship it, so what init
// writes is the file the docs explain and the tests hold.
import exportEnvScript from "../../examples/workflows/export-env.sh" with { type: "text" };
import {
  type Declarable,
  type EnvFiles,
  type NodeFindings,
  openTofuStacks,
  type PackageManager,
  type WorkflowFindings,
} from "../adapters/init-findings.ts";
import { MERGE_SCAN_INPUT } from "../core/merge-scan.ts";
import { DOCS } from "./docs-site.ts";

export const WORKFLOW_FILE = ".github/workflows/deploy-dashboard.yml";
export const EXPORT_ENV_FILE = ".github/scripts/export-env.sh";
export const EXPORT_ENV = exportEnvScript;

// A branch init could not read from the checkout.
export const DEFAULT_BRANCH = "main";

export interface WorkflowOptions {
  findings: WorkflowFindings;
  // The branch a push to scans. Undefined when init could not tell.
  branch: string | undefined;
  // mergeAndDeploy.authors is set, so the job merges with contents: write
  // and the scan after the merge is narrowed through the dispatch input
  // (records 0054, 0064).
  merges: boolean;
}

const RUNS_ON = "ubuntu-latest";

// The one-step workflow of the README (record 0077), with the steps that
// install what the stacks need filled in the way examples/workflows does it.
// One job, one Sluiceway step with no mode: it picks what to run from the
// event, so there is no if:, no needs: and no label to keep in step with
// sluiceway.yaml.
export function starterWorkflow(options: WorkflowOptions): string {
  const { findings, merges } = options;
  const branch = options.branch ?? DEFAULT_BRANCH;
  const lines = [
    "# Written by sluiceway init from the files of this repo. Review every step",
    "# before you commit it, and change what init printed it could not know:",
    `# ${DOCS.exampleWorkflows}`,
    "#",
    "# `@v0` follows every release until 1.0.0. To review every update yourself,",
    `# pin a full commit SHA instead: ${DOCS.pinACommit}`,
    "name: deploy-dashboard",
    "",
    "on:",
    "  push:",
    `    branches: [${quotedIfNeeded(branch)}]`,
    "  schedule:",
    '    - cron: "0 6 * * *"',
    "  workflow_dispatch:",
    // The narrowed scan after a merge from the dashboard (record 0064).
    ...(merges
      ? [
          "    inputs:",
          `      ${MERGE_SCAN_INPUT}:`,
          "        description: Set by Sluiceway after a merge from the dashboard. Leave it empty.",
          "        required: false",
        ]
      : []),
    "  issues:",
    "    types: [edited]",
    "",
    "permissions:",
    // The job merges with the workflow token (record 0054).
    ...PERMISSIONS.map((line) =>
      merges && line.startsWith("contents:") ? "  contents: write" : `  ${line}`,
    ),
    "",
    "jobs:",
    "  sluiceway:",
    `    runs-on: ${RUNS_ON}`,
    "    timeout-minutes: 60",
    "    # One run at a time and none dropped. An edit of any other issue gets a",
    "    # group of its own, so it never waits for a scan or a deploy.",
    "    concurrency:",
    "      group: sluiceway-${{ github.event.issue.number }}",
    "      queue: max",
    "    steps:",
    "      - uses: actions/checkout@v7",
    ...toolSteps(findings),
    ...credentialSteps(findings.envFiles),
    "      # It reads the event of the run: it scans, or deploys what a tick asks for.",
    "      - uses: sluiceway/sluiceway@v0",
  ];
  return `${lines.join("\n")}\n`;
}

const PERMISSIONS = [
  "contents: read",
  "issues: write",
  "deployments: write",
  "actions: write",
  "pull-requests: read",
  "checks: write",
];

// Installs the language, the programs' packages and the tools, in that order.
function toolSteps(findings: WorkflowFindings): string[] {
  return [
    ...(findings.node === undefined ? [] : nodeSteps(findings.node)),
    ...(findings.pulumi ? pulumiSteps(findings) : []),
    ...(findings.opentofu ? OPENTOFU_STEPS : []),
    ...(findings.helm ? helmSteps(findings.helmRepositories) : []),
    ...(findings.kubectl ? KUBECTL_STEPS : []),
  ];
}

const LOCKFILE: Record<PackageManager, string> = {
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
  bun: "bun.lock",
};

function nodeSteps(node: NodeFindings): string[] {
  const managers = [...new Set(node.installs.map(({ manager }) => manager))];
  const [only] = managers;
  // setup-node caches one package manager's downloads, and not bun's.
  const cache = managers.length === 1 && only !== undefined && only !== "bun" ? only : undefined;
  const nested = node.installs.some(({ directory }) => directory !== ".");
  const steps = [
    ...(node.yarnBerry ? ["      - run: corepack enable"] : []),
    ...(managers.includes("pnpm") ? ["      - uses: pnpm/action-setup@v6"] : []),
    "      - uses: actions/setup-node@v7",
    "        with:",
    node.versionFile === undefined
      ? "          node-version: lts/*"
      : `          node-version-file: ${node.versionFile}`,
    ...(cache === undefined ? [] : [`          cache: ${cache}`]),
    ...(cache !== undefined && nested
      ? [`          cache-dependency-path: ${quoted(`**/${LOCKFILE[cache]}`)}`]
      : []),
    ...(managers.includes("bun") ? ["      - uses: oven-sh/setup-bun@v2"] : []),
  ];
  const installs = node.installs.flatMap(({ directory, manager }) => [
    `      - run: ${installCommand(manager, node.yarnBerry)}`,
    ...(directory === "." ? [] : [`        working-directory: ${directory}`]),
  ]);
  if (installs.length === 0) return steps;
  return [...steps, "      # Once for every program in the repo, not once per stack.", ...installs];
}

function installCommand(manager: PackageManager, yarnBerry: boolean): string {
  switch (manager) {
    case "npm":
      return "npm ci";
    case "pnpm":
      return "pnpm install --frozen-lockfile";
    case "yarn":
      return yarnBerry ? "yarn install --immutable" : "yarn install --frozen-lockfile";
    case "bun":
      return "bun install --frozen-lockfile";
  }
}

function pulumiSteps(findings: WorkflowFindings): string[] {
  const managers = [...new Set(findings.node?.installs.map(({ manager }) => manager) ?? [])];
  const keyFiles =
    managers.length > 0
      ? managers.map((manager) => `'**/${LOCKFILE[manager]}'`)
      : ["'**/Pulumi.yaml'", "'**/Pulumi.yml'", "'**/Pulumi.json'"];
  const others = findings.otherRuntimes.flatMap(({ runtime, paths }) => [
    `      # The packages of the ${runtime} programs, with the ${runtime} the runner has.`,
    ...paths.flatMap((path) => [
      "      - run: pulumi install",
      ...(path === "." ? [] : [`        working-directory: ${path}`]),
    ]),
  ]);
  return [
    "      - uses: pulumi/actions@v7 # without a command this only installs the CLI",
    "        with:",
    "          pulumi-version: ^3.229.0",
    "      # The providers the programs use. The first run fills the cache.",
    "      - uses: actions/cache@v6",
    "        with:",
    "          path: ~/.pulumi/plugins",
    `          key: pulumi-plugins-\${{ runner.os }}-\${{ hashFiles(${keyFiles.join(", ")}) }}`,
    ...others,
  ];
}

// As docs/credentials.md shows them.
export const OPENTOFU_STEPS = [
  "      - uses: opentofu/setup-opentofu@a1320f892987e89d278cc92dc5adc984fb93aca4 # v2.0.2",
  "        with:",
  "          tofu_version: 1.12.6",
  "          tofu_wrapper: false",
];

export const HELM_STEPS = [
  "      - uses: azure/setup-helm@9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310 # v5.0.1",
  "        with:",
  "          version: v4.3.0",
  "      - name: Install the diff plugin",
  "        run: helm plugin install https://github.com/databus23/helm-diff --version v3.15.13 --verify=false",
];

export const KUBECTL_STEPS = [
  "      - uses: azure/setup-kubectl@v5",
  "        with:",
  "          version: v1.37.0",
];

function helmSteps(repositories: string[]): string[] {
  if (repositories.length === 0) return HELM_STEPS;
  return [
    ...HELM_STEPS,
    "      # The repositories the dependencies of the local charts come from.",
    "      - name: Add the chart repositories",
    "        run: |",
    ...repositories.map(
      (repository, index) => `          helm repo add dependency-${index + 1} ${repository}`,
    ),
  ];
}

// The secret the loading step reads. The person creates it.
export const TOKEN_SECRET = "OP_SERVICE_ACCOUNT_TOKEN";

// Only a step init found the makings of in the repo: an env file of secret
// references, loaded as examples/workflows/secret-manager.yml does. Anything
// else is a comment where the person's own step goes. One job previews and
// deploys, so it loads the file that deploys (record 0077).
function credentialSteps(envFiles: EnvFiles | undefined): string[] {
  if (envFiles === undefined) {
    return [
      "      # Load your credentials and your state backend settings into the job",
      "      # environment here. Sluiceway passes the environment to the tool and",
      "      # never looks inside. Whatever loads a secret must also mask it.",
    ];
  }
  const file = envFiles.deploy;
  return [
    "      # Leave this out when op is part of your runner image.",
    "      - uses: 1password/install-cli-action@v4",
    "      # One `op run` resolves the whole file. These credentials preview and",
    "      # deploy, so they must be able to change things.",
    "      - name: Load the environment",
    "        env:",
    `          OP_SERVICE_ACCOUNT_TOKEN: \${{ secrets.${TOKEN_SECRET} }}`,
    `        run: op run --env-file=${file} --no-masking -- bash ${EXPORT_ENV_FILE} ${file}`,
  ];
}

export interface ConfigOptions {
  declarable: Declarable;
  // Globs of the check's fixed list that cover a file no stack claims.
  unrelated: string[];
  // Directories with files no stack claims and no glob above covers, and a
  // stack path to show the inputs hint on.
  unclaimed: { directories: string[]; stack: string } | undefined;
}

// How many directories the inputs hint names.
const HINTED = 10;

const SCHEMA =
  "# yaml-language-server: $schema=https://raw.githubusercontent.com/sluiceway/sluiceway/main/schema/sluiceway.schema.json";

export function starterConfig({ declarable, unrelated, unclaimed }: ConfigOptions): string {
  const { opentofu, helm } = declarable;
  const lines = [
    SCHEMA,
    "#",
    "# Written by sluiceway init from the files of this repo. Review it before",
    `# you commit it. Every key is explained at ${DOCS.configuration}`,
  ];
  if (opentofu.length + helm.length > 0) {
    lines.push("", "stacks:");
    for (const root of opentofu) {
      const stacks = openTofuStacks(root);
      lines.push(
        stacks.length > 1
          ? `  # An OpenTofu root module with a var file per stack, each in a workspace of its name.`
          : "  # An OpenTofu root module.",
      );
      for (const { name, varFile } of stacks) {
        lines.push(`  - path: ${quotedIfNeeded(root.path)}`);
        if (name !== undefined) lines.push(`    name: ${quotedIfNeeded(name)}`);
        lines.push("    tool: opentofu");
        if (varFile !== undefined) {
          lines.push("    options:");
          if (name !== undefined) lines.push(`      workspace: ${quotedIfNeeded(name)}`);
          lines.push(`      varFiles: [${quotedIfNeeded(varFile)}]`);
        }
      }
    }
    for (const chart of helm) {
      lines.push(
        "  # A local chart. Set the release and the namespace it runs as, and its",
        "  # values files: init named both after the chart.",
        `  - path: ${quotedIfNeeded(chart.path)}`,
        "    tool: helm",
        "    options:",
        `      release: ${chart.release}`,
        `      namespace: ${chart.release}`,
        "      chart: .",
      );
    }
  }
  if (unrelated.length > 0) {
    lines.push(
      "",
      "# Files that look like docs and tooling. A push that changes only these",
      "# previews nothing. Take out any that one of your programs reads.",
      "scan:",
      "  unrelated:",
      ...unrelated.map((glob) => `    - ${JSON.stringify(glob)}`),
    );
  }
  if (unclaimed !== undefined) {
    const [first] = unclaimed.directories;
    lines.push(
      "",
      "# No stack claims the files in these directories, so a push that changes",
      "# one of them previews every stack:",
      ...unclaimed.directories.slice(0, HINTED).map((directory) => `#   ${directory}/`),
      ...(unclaimed.directories.length > HINTED
        ? [`#   and ${unclaimed.directories.length - HINTED} more, which the check lists`]
        : []),
      "# When a stack reads one, name it under inputs in that stack's entry:",
      "#",
      "#   stacks:",
      `#     - path: ${unclaimed.stack}`,
      "#       inputs:",
      `#         - "${first}/**"`,
    );
  }
  return `${lines.join("\n")}\n`;
}

// What init says it did, and what is left for a person (record 0065).
export const NOT_A_REPO_ROOT =
  "This is not the root of a git repo. Run init in the top directory of your checkout.";

export function noStacksText(): string {
  return "init found no stack to set up: no Pulumi project, no OpenTofu root module and no Helm chart. It wrote nothing.";
}

export function workflowExistsText(paths: string[]): string {
  return `A workflow runs Sluiceway already: ${paths.join(", ")}. init never overwrites one, and wrote nothing. Run the check (mode: check) to see what it lacks.`;
}

export function wroteText(file: string): string {
  return `Wrote ${file}.`;
}

export const KEPT_CONFIG = "Kept sluiceway.yaml as it is, and set the workflow up from it.";
export const NEEDS_A_PERSON = "Still to do by a person:";

export interface NeedsInput {
  findings: WorkflowFindings;
  declarable: Declarable;
  branchGuessed: boolean;
}

export function needsText({ findings, declarable, branchGuessed }: NeedsInput): string[] {
  const needs: string[] = [];
  const { envFiles, node } = findings;
  if (envFiles === undefined) {
    needs.push(
      `Load the credentials and the state backend settings of your stacks where the comment in the workflow says, with credentials that can deploy. init writes no credential step it did not find in the repo. Recipes: ${DOCS.credentials}`,
    );
  } else {
    needs.push(
      `Create the secret ${TOKEN_SECRET}, a 1Password service account token that resolves ${envFiles.deploy}.`,
    );
    const unused = [
      ...(envFiles.preview === envFiles.deploy ? [] : [envFiles.preview]),
      ...envFiles.others,
    ];
    if (unused.length > 0) {
      needs.push(
        `init did not use ${unused.join(", ")}: one job previews and deploys, with the credentials of ${envFiles.deploy}. For credentials that only read in scans, use the split workflow: ${DOCS.splitWorkflow}`,
      );
    }
  }
  if (findings.helm || findings.kubectl) {
    needs.push(
      `The job needs a kubeconfig for the cluster: ${[
        ...(findings.helm ? [DOCS.credentialsHelm] : []),
        ...(findings.kubectl ? [DOCS.credentialsKubectl] : []),
      ].join(" and ")}`,
    );
  }
  if (declarable.helm.length > 0) {
    needs.push(
      `sluiceway.yaml names each Helm release and its namespace after the chart: ${declarable.helm.map(({ path }) => path).join(", ")}. Set both to where the release runs, and add its values files. The namespace must exist.`,
    );
  }
  if (findings.helmRepositories.length > 0) {
    needs.push(
      "The workflow adds the chart repositories the local charts depend on. Log in to any that is private before that step.",
    );
  }
  const workspaces = declarable.opentofu.filter(({ varFiles }) => varFiles.length > 1);
  if (workspaces.length > 0) {
    needs.push(
      `${workspaces.map(({ path }) => path).join(", ")}: one stack per var file, each in a workspace of the same name. Change workspace where yours is named otherwise.`,
    );
  }
  if (node !== undefined && node.withoutLockfile.length > 0) {
    needs.push(
      `No lockfile for the Node programs in ${node.withoutLockfile.join(", ")}: add one, or install their packages in the workflow yourself.`,
    );
  }
  if (node?.pnpmWithoutVersion) {
    needs.push(
      "pnpm/action-setup reads the pnpm version from packageManager in package.json, which names none. Add it there, or set version on the step.",
    );
  }
  for (const { runtime } of findings.otherRuntimes) {
    needs.push(
      `The ${runtime} programs run on the ${runtime} the runner has. Add its setup action before pulumi install to pin a version.`,
    );
  }
  if (branchGuessed) {
    needs.push(
      `The workflow scans after a push to ${DEFAULT_BRANCH}: init could not read the default branch. Change it if yours is another.`,
    );
  }
  needs.push(
    `The job runs on ${RUNS_ON} with timeout-minutes: 60. Raise it when a scan or a deploy of yours takes longer, since one run can hold both. For a self-hosted runner change runs-on, with runner 2.328.0 or newer.`,
    "Review the files, run the check in a pull request, and commit them. init commits nothing.",
  );
  return needs;
}

function quoted(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

// A plain YAML scalar where one reads as the same text, quoted otherwise.
function quotedIfNeeded(text: string): string {
  return /^[A-Za-z0-9_][\w./-]*$/.test(text) && !/^(true|false|null|yes|no|on|off|~)$/i.test(text)
    ? text
    : JSON.stringify(text);
}
