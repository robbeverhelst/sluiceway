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

export const WORKFLOW_FILE = ".github/workflows/deploy-dashboard.yml";
export const EXPORT_ENV_FILE = ".github/scripts/export-env.sh";
export const EXPORT_ENV = exportEnvScript;

// A branch init could not read from the checkout.
export const DEFAULT_BRANCH = "main";

export interface WorkflowOptions {
  findings: WorkflowFindings;
  // The branch a push to scans. Undefined when init could not tell.
  branch: string | undefined;
  // dashboard.label, which the `if:` of resolve names.
  label: string;
  // mergeAndDeploy.authors is set, so resolve merges (record 0054).
  merges: boolean;
}

const RUNS_ON = "ubuntu-latest";

// The workflow of the README's step 2, with the steps that install what the
// stacks need filled in the way examples/workflows does it.
export function starterWorkflow(options: WorkflowOptions): string {
  const { findings, label } = options;
  const branch = options.branch ?? DEFAULT_BRANCH;
  const lines = [
    "# Written by sluiceway init from the files of this repo. Review every step",
    "# before you commit it: docs/example-workflows.md says what to change, and",
    "# init printed what it could not know.",
    "#",
    "# `@v0` follows every release until 1.0.0. To review every update yourself,",
    '# pin a full commit SHA instead, as the README\'s "Pin a commit" says.',
    "name: deploy-dashboard",
    "",
    "on:",
    "  push:",
    `    branches: [${quotedIfNeeded(branch)}]`,
    "  schedule:",
    '    - cron: "0 6 * * *"',
    "  workflow_dispatch:",
    "  issues:",
    "    types: [edited]",
    "",
    "permissions:",
    `  contents: ${options.merges ? "write" : "read"}`,
    "  issues: write",
    "  deployments: write",
    "  actions: write",
    "  pull-requests: read",
    "  checks: write",
    "",
    "jobs:",
    "  scan:",
    "    if: github.event_name != 'issues'",
    `    runs-on: ${RUNS_ON}`,
    "    concurrency: sluiceway-scan",
    "    steps:",
    "      - uses: actions/checkout@v7",
    ...toolSteps(findings, "scan"),
    ...credentialSteps(findings.envFiles, "scan"),
    "      - uses: sluiceway/sluiceway@v0",
    "        with:",
    "          mode: scan",
    "",
    "  resolve:",
    `    if: github.event_name == 'workflow_dispatch' || (github.event_name == 'issues' && contains(github.event.issue.labels.*.name, ${quoted(label)}))`,
    `    runs-on: ${RUNS_ON}`,
    "    concurrency: sluiceway-resolve",
    "    outputs:",
    "      matrix: ${{ steps.resolve.outputs.matrix }}",
    "    steps:",
    "      - uses: actions/checkout@v7",
    "      # No tool and no credentials in this job. It never runs the tool.",
    "      - id: resolve",
    "        uses: sluiceway/sluiceway@v0",
    "        with:",
    "          mode: resolve",
    "",
    "  apply:",
    "    needs: resolve",
    "    if: ${{ !cancelled() && needs.resolve.outputs.matrix != '' && needs.resolve.outputs.matrix != '[]' }}",
    "    strategy:",
    "      fail-fast: false",
    "      matrix:",
    "        include: ${{ fromJson(needs.resolve.outputs.matrix) }}",
    `    runs-on: ${RUNS_ON}`,
    "    timeout-minutes: 60",
    "    concurrency:",
    "      group: sluiceway-apply-${{ matrix.stack }}",
    "      queue: max",
    "    environment:",
    "      name: ${{ matrix.environment }}",
    "      deployment: false",
    "    steps:",
    "      - uses: actions/checkout@v7",
    ...toolSteps(findings, "apply"),
    ...credentialSteps(findings.envFiles, "apply"),
    "      - uses: sluiceway/sluiceway@v0",
    "        with:",
    "          mode: apply",
    "          deployment-id: ${{ matrix.deployment }}",
    "",
    "  settle:",
    "    needs: [resolve, apply]",
    "    if: always() && needs.resolve.outputs.matrix != '' && needs.resolve.outputs.matrix != '[]'",
    `    runs-on: ${RUNS_ON}`,
    "    steps:",
    "      - uses: actions/checkout@v7",
    "      - uses: sluiceway/sluiceway@v0",
    "        with:",
    "          mode: settle",
  ];
  return `${lines.join("\n")}\n`;
}

type Job = "scan" | "apply";

// Installs the language, the programs' packages and the tools, in that order.
function toolSteps(findings: WorkflowFindings, job: Job): string[] {
  return [
    ...(findings.node === undefined ? [] : nodeSteps(findings.node, job)),
    ...(findings.pulumi ? pulumiSteps(findings, job) : []),
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

function nodeSteps(node: NodeFindings, job: Job): string[] {
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
  const comment =
    job === "scan" ? ["      # Once for every program in the repo, not once per stack."] : [];
  return [...steps, ...comment, ...installs];
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

function pulumiSteps(findings: WorkflowFindings, job: Job): string[] {
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
    ...(job === "scan"
      ? [
          "      # The providers the programs use. The first run fills the cache.",
          "      - uses: actions/cache@v6",
        ]
      : ["      - uses: actions/cache/restore@v6"]),
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

// The secret names the steps read. The person creates them.
export const PREVIEW_TOKEN = "OP_PREVIEW_TOKEN";
export const DEPLOY_TOKEN = "OP_DEPLOY_TOKEN";

// Only a step init found the makings of in the repo: an env file of secret
// references, loaded as examples/workflows/secret-manager.yml does. Anything
// else is a comment where the person's own step goes.
function credentialSteps(envFiles: EnvFiles | undefined, job: Job): string[] {
  if (envFiles === undefined) {
    return job === "scan"
      ? [
          "      # Load your credentials and your state backend settings into the job",
          "      # environment here. Sluiceway passes the environment to the tool and",
          "      # never looks inside. Whatever loads a secret must also mask it.",
        ]
      : [
          "      # Same credential steps as in the scan job. These credentials must be",
          "      # able to change things.",
        ];
  }
  const file = job === "scan" ? envFiles.preview : envFiles.deploy;
  const token = job === "scan" ? PREVIEW_TOKEN : DEPLOY_TOKEN;
  return [
    "      # Leave this out when op is part of your runner image.",
    "      - uses: 1password/install-cli-action@v4",
    ...(job === "scan"
      ? [
          "      # One `op run` resolves the whole file. The service account of this job",
          "      # should see only the credentials that read.",
        ]
      : [
          "      # The token that reaches the credentials that change things is a secret",
          "      # of the environment above.",
        ]),
    "      - name: Load the environment",
    "        env:",
    `          OP_SERVICE_ACCOUNT_TOKEN: \${{ secrets.${token} }}`,
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
    "# you commit it: docs/configuration.md explains every key.",
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
      "Load the credentials and the state backend settings of your stacks in the scan and apply jobs, where the comments in the workflow say. init writes no credential step it did not find in the repo. docs/credentials.md has recipes.",
    );
  } else {
    needs.push(
      `Create the secret ${PREVIEW_TOKEN}, a 1Password service account token that resolves ${envFiles.preview} and reads only, and ${DEPLOY_TOKEN}, one that resolves ${envFiles.deploy}, as a secret of the environment of each stack.`,
    );
    if (envFiles.preview === envFiles.deploy) {
      needs.push(
        `Both jobs load ${envFiles.preview}. The scan needs credentials that read and nothing more: give it an env file of its own.`,
      );
    }
    if (envFiles.others.length > 0) {
      needs.push(
        `init did not use these env files of secret references: ${envFiles.others.join(", ")}.`,
      );
    }
  }
  if (findings.helm || findings.kubectl) {
    needs.push(
      "The scan and apply jobs need a kubeconfig for the cluster (docs/credentials.md, Helm and Kubernetes manifests).",
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
    `Every job runs on ${RUNS_ON}. For self-hosted runners change runs-on of scan and apply, with runner 2.328.0 or newer. resolve and settle hold no credentials and can stay on hosted runners.`,
    "apply deploys in the GitHub Environment of each stack, sluiceway unless sluiceway.yaml names another. Put the credentials that change things there, or remove the environment block where your plan has no environments.",
    "Review the files, run the check (mode: check) in a pull request, and commit them. init commits nothing.",
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
