// The scenarios examples/helm-basic is driven through (record 0058). Helm
// compares a chart with a release in a cluster, so the recorder needs one: a
// kind cluster made for it, which KUBECONFIG names. Each scenario starts with
// no release of the example installed, in namespaces that exist. An edit
// names text of the example word for word, so when the example changes and a
// scenario no longer fits, the recorder stops instead of recording something
// else.
import { join } from "node:path";
import type { Expectation, RecordOptions, Scenario, Step } from "./recorder.ts";

// The command lines are the ones the adapter runs (src/adapters/helm/).
interface HelmStack {
  cwd: string;
  release: string;
  namespace: string;
  chart: string;
  valuesFiles: string[];
}

const release = (stack: HelmStack) => [
  stack.release,
  stack.chart,
  `--namespace=${stack.namespace}`,
];
const values = (stack: HelmStack) => stack.valuesFiles.map((file) => `--values=${file}`);

export const HELM = {
  version: ["helm", "version", "--template={{.Version}}"],
  pluginVersion: ["helm", "diff", "version"],
  dependencies: ["helm", "dependency", "build", "."],
  diff: (stack: HelmStack) => [
    "helm",
    "diff",
    "upgrade",
    ...release(stack),
    "--install",
    "--reset-values",
    "--dry-run=server",
    "--output=structured",
    "--no-color",
    ...values(stack),
  ],
  render: (stack: HelmStack) => [
    "helm",
    "template",
    ...release(stack),
    "--dry-run=server",
    ...values(stack),
  ],
  deploy: (stack: HelmStack) => [
    "helm",
    "upgrade",
    ...release(stack),
    "--install",
    "--reset-values",
    "--atomic",
    "--hide-notes",
    ...values(stack),
  ],
  toolDiff: (stack: HelmStack) => [
    "helm",
    "diff",
    "upgrade",
    ...release(stack),
    "--install",
    "--reset-values",
    "--dry-run=server",
    "--output=diff",
    "--no-color",
    ...values(stack),
  ],
};

// The stacks of examples/helm-basic/sluiceway.yaml.
export const WEB: HelmStack = {
  cwd: "web",
  release: "web",
  namespace: "sluiceway-web",
  chart: "../charts/web",
  valuesFiles: ["values.yaml"],
};
export const WORKER: HelmStack = {
  cwd: "worker",
  release: "worker",
  namespace: "sluiceway-worker",
  chart: "../charts/worker",
  valuesFiles: ["values.yaml"],
};

export const HELM_NAMESPACES = [WEB.namespace, WORKER.namespace];

// Every scenario starts with no release of the example in the cluster.
const uninstalled: Step[] = [WEB, WORKER].map((stack) => ({
  kind: "setup",
  cwd: ".",
  argv: [
    "helm",
    "uninstall",
    stack.release,
    `--namespace=${stack.namespace}`,
    "--ignore-not-found",
    "--wait",
  ],
}));

// A deploy the way the adapter makes one, to put a release where a scenario
// needs it.
function installed(stack: HelmStack = WEB): Step {
  return { kind: "setup", cwd: stack.cwd, argv: HELM.deploy(stack) };
}

function diff(expect: Expectation, suffix = "", stack: HelmStack = WEB): Step {
  return {
    kind: "record",
    id: `diff${suffix}`,
    cwd: stack.cwd,
    argv: HELM.diff(stack),
    stdout: expect.exit === "zero" ? "json" : "text",
    expect,
  };
}

function render(suffix = "", stack: HelmStack = WEB): Step {
  return {
    kind: "record",
    id: `render${suffix}`,
    cwd: stack.cwd,
    argv: HELM.render(stack),
    stdout: "text",
    expect: { exit: "zero" },
  };
}

function deploy(expect: Expectation, stack: HelmStack = WEB): Step {
  return {
    kind: "record",
    id: "deploy",
    cwd: stack.cwd,
    argv: HELM.deploy(stack),
    stdout: "text",
    expect,
  };
}

const VALUES = "web/values.yaml";

function edit(find: string, replace: string, file = VALUES): Step {
  return { kind: "edit", file, find, replace };
}

const newColor = edit("color: blue\n", "color: green\n");
const newPort = edit("port: 80\n", "port: 8080\n");
const newVersion = edit('version: "1.0.0"\n', 'version: "1.0.1"\n');
const extraOn = edit("token: CANARY-SECRET\n", "token: CANARY-SECRET\nextra:\n  enabled: true\n");
const unstableOn = edit("token: CANARY-SECRET\n", "token: CANARY-SECRET\nunstable: true\n");
const rotatedToken = edit("token: CANARY-SECRET\n", "token: CANARY-SECRET-ROTATED\n");

function start(steps: Step[]): Step[] {
  return [...uninstalled, ...steps];
}

function afterDeploy(
  name: string,
  description: string,
  before: Step[],
  edits: Step[],
  expect: Expectation,
): Scenario {
  return {
    name,
    description,
    steps: start([...before, installed(), ...edits, diff(expect)]),
  };
}

export const HELM_SCENARIOS: Scenario[] = [
  {
    name: "version",
    description:
      "The version of helm and of its diff plugin, which the version check reads before any preview.",
    steps: [
      {
        kind: "record",
        id: "version",
        cwd: ".",
        argv: HELM.version,
        stdout: "text",
        expect: { exit: "zero" },
      },
      {
        kind: "record",
        id: "plugin-version",
        cwd: ".",
        argv: HELM.pluginVersion,
        stdout: "text",
        expect: { exit: "zero" },
      },
    ],
  },
  {
    name: "new-stack",
    description: "web before its first deploy: the release is not installed, so all is added.",
    steps: start([diff({ exit: "zero", ops: ["ADD"] })]),
  },
  afterDeploy("no-changes", "web, deployed, and nothing changed.", [], [], { exit: "zero" }),
  afterDeploy(
    "update",
    "New values: a key with a dot in a ConfigMap, a label with a dot and a slash, and a port in a list.",
    [],
    [newColor, newPort, newVersion],
    { exit: "zero", ops: ["MODIFY"] },
  ),
  afterDeploy("create", "A values switch that adds a ConfigMap.", [], [extraOn], {
    exit: "zero",
    ops: ["ADD"],
  }),
  afterDeploy(
    "delete",
    "The same switch turned off again: the ConfigMap goes.",
    [extraOn],
    [edit("extra:\n  enabled: true\n", "")],
    { exit: "zero", ops: ["REMOVE"] },
  ),
  afterDeploy(
    "mixed",
    "One ConfigMap added, one changed and one removed in one diff.",
    [extraOn],
    [edit("extra:\n  enabled: true\n", "unstable: true\n"), newColor],
    { exit: "zero", ops: ["ADD", "MODIFY", "REMOVE"] },
  ),
  afterDeploy(
    "changed-secret",
    "The token in the Secret rotated. The diff plugin redacts a Secret's data before it compares it.",
    [],
    [rotatedToken],
    { exit: "zero", ops: ["MODIFY"] },
  ),
  {
    name: "same-diff-twice",
    description: "The same diff of web twice, to see that the order of the entries holds.",
    steps: start([
      installed(),
      newColor,
      newPort,
      diff({ exit: "zero", ops: ["MODIFY"] }),
      diff({ exit: "zero", ops: ["MODIFY"] }, "-again"),
    ]),
  },
  {
    name: "program-error",
    description:
      "A values file that sets the greeting the chart requires to null: the render fails.",
    steps: start([edit("greeting: hello\n", "greeting: null\n"), diff({ exit: "nonzero" })]),
  },
  {
    name: "deploy",
    description:
      "web deployed the way apply does it: the diff, the render the deploy is held to, the render again right before the deploy, the deploy, and a diff after it.",
    steps: start([
      diff({ exit: "zero", ops: ["ADD"] }),
      render(),
      render("-again"),
      deploy({ exit: "zero" }),
      diff({ exit: "zero" }, "-after"),
    ]),
  },
  {
    name: "deploy-failed",
    description:
      "A diff that works and a deploy the API server refuses: a port out of range. The release is rolled back.",
    steps: start([
      installed(),
      edit("port: 80\n", "port: 99999\n"),
      diff({ exit: "zero", ops: ["MODIFY"] }),
      render(),
      render("-again"),
      deploy({ exit: "nonzero" }),
    ]),
  },
  {
    name: "unstable-render",
    description:
      "A template with a random value: two renders of the same chart and values differ, so the deploy is refused before it starts.",
    steps: start([unstableOn, diff({ exit: "zero", ops: ["ADD"] }), render(), render("-again")]),
  },
  {
    name: "log-diff",
    description:
      "The tool's own diff of new values and a rotated token, for the job log (record 0048).",
    steps: start([
      installed(),
      newColor,
      rotatedToken,
      {
        kind: "record",
        id: "tool-diff",
        cwd: WEB.cwd,
        argv: HELM.toolDiff(WEB),
        stdout: "text",
        expect: { exit: "zero" },
      },
    ]),
  },
  {
    name: "dependencies",
    description:
      "worker, whose chart depends on a local chart: helm dependency build in its chart directory, then a diff of all adds.",
    steps: start([
      {
        kind: "record",
        id: "dependencies",
        cwd: "charts/worker",
        argv: HELM.dependencies,
        stdout: "text",
        expect: { exit: "zero" },
      },
      diff({ exit: "zero", ops: ["ADD"] }, "", WORKER),
    ]),
  },
  {
    name: "dependencies-failed",
    description:
      "A dependency on a local chart that is not there: helm dependency build fails, so worker cannot be previewed.",
    steps: start([
      edit(
        "repository: file://../web\n",
        "repository: file://../gone\n",
        "charts/worker/Chart.yaml",
      ),
      {
        kind: "record",
        id: "dependencies",
        cwd: "charts/worker",
        argv: HELM.dependencies,
        stdout: "text",
        expect: { exit: "nonzero" },
      },
    ]),
  },
];

// Built from nothing, not from the environment of whoever runs the recorder.
// PATH comes through, so helm can be found, and KUBECONFIG and HELM_PLUGINS,
// so it reaches the recorder's own cluster and finds its diff plugin. HOME and
// helm's own directories point into the work directory, so no file of the
// user is read.
export function helmEnvironment(options: RecordOptions): Record<string, string> {
  const needed = (name: string): string => {
    const value = options.parentEnv[name];
    if (value === undefined || value === "") {
      throw new Error(`Recording the Helm fixtures needs ${name}. See CONTRIBUTING.md.`);
    }
    return value;
  };
  return {
    PATH: options.parentEnv.PATH ?? "",
    HOME: join(options.workDir, "home"),
    USER: "sluiceway",
    KUBECONFIG: needed("KUBECONFIG"),
    HELM_PLUGINS: needed("HELM_PLUGINS"),
    HELM_CACHE_HOME: join(options.workDir, "helm-cache"),
    HELM_CONFIG_HOME: join(options.workDir, "helm-config"),
    HELM_DATA_HOME: join(options.workDir, "helm-data"),
    NO_COLOR: "1",
  };
}

// What the recorder checks a diff for: the change type of every entry.
export function helmOps(document: unknown): string[] {
  if (!Array.isArray(document)) return [];
  return document.flatMap((entry) =>
    typeof entry === "object" && entry !== null && typeof entry.changeType === "string"
      ? [entry.changeType as string]
      : [],
  );
}
