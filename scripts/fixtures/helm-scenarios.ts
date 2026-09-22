// The scenarios examples/helm-basic is driven through (records 0058 and
// 0069). Helm compares a chart with a release in a cluster, so the recorder
// needs one: a kind cluster made for it, which KUBECONFIG names. Each scenario
// starts with no release of the example installed, in namespaces that exist.
// An edit names text of the example word for word, so when the example
// changes and a scenario no longer fits, the recorder stops instead of
// recording something else.
import { join } from "node:path";
import type { Expectation, RecordOptions, Scenario, Step } from "./recorder.ts";

// The command lines are the ones the adapter runs (src/adapters/helm/).
interface HelmStack {
  cwd: string;
  release: string;
  namespace: string;
  chart: string;
  valuesFiles: string[];
  createNamespace?: boolean;
}

// What changes the deploy's command line (record 0069): Helm 4 renamed
// --atomic to --rollback-on-failure, and a release that Helm 4 applies
// server-side needs --force-conflicts to put drift back.
interface DeployFlags {
  major: number;
  forceConflicts?: boolean;
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
  threeWay: (stack: HelmStack) => [
    "helm",
    "diff",
    "upgrade",
    ...release(stack),
    "--install",
    "--reset-values",
    "--dry-run=server",
    "--three-way-merge",
    "--no-hooks",
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
  metadata: (stack: HelmStack) => [
    "helm",
    "get",
    "metadata",
    stack.release,
    `--namespace=${stack.namespace}`,
    "--output=json",
  ],
  deploy: (stack: HelmStack, flags: DeployFlags) => [
    "helm",
    "upgrade",
    ...release(stack),
    "--install",
    "--reset-values",
    flags.major >= 4 ? "--rollback-on-failure" : "--atomic",
    ...(flags.forceConflicts === true ? ["--force-conflicts"] : []),
    ...(stack.createNamespace === true ? ["--create-namespace"] : []),
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
// web, installed into a namespace the deploy makes (record 0069). It is not
// in the example's sluiceway.yaml: the recorder makes the example's
// namespaces before any scenario, and this one must not be there.
export const WEB_NEW_NAMESPACE: HelmStack = {
  ...WEB,
  namespace: "sluiceway-new",
  createNamespace: true,
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

const VALUES = "web/values.yaml";

function edit(find: string, replace: string, file = VALUES): Step {
  return { kind: "edit", file, find, replace };
}

// A change made behind the tool's back, the way a person with kubectl makes
// one. kubectl comes with the recorder's cluster.
function kubectl(...argv: string[]): Step {
  return {
    kind: "setup",
    cwd: ".",
    argv: ["kubectl", `--namespace=${WEB.namespace}`, ...argv],
  };
}

const newColor = edit("color: blue\n", "color: green\n");
const newPort = edit("port: 80\n", "port: 8080\n");
const newVersion = edit('version: "1.0.0"\n', 'version: "1.0.1"\n');
const extraOn = edit("token: CANARY-SECRET\n", "token: CANARY-SECRET\nextra:\n  enabled: true\n");
const unstableOn = edit("token: CANARY-SECRET\n", "token: CANARY-SECRET\nunstable: true\n");
const rotatedToken = edit("token: CANARY-SECRET\n", "token: CANARY-SECRET-ROTATED\n");

// Drift of web: a value of the ConfigMap and a label nobody set, the Service's
// target port, and the Secret deleted. The label is not the chart's, so a
// deploy keeps it and it is no drift.
const greetingDrifted = kubectl(
  "patch",
  "configmap",
  "web-settings",
  "--type=merge",
  '--patch={"data":{"greeting":"CANARY-VALUE drifted"},"metadata":{"labels":{"added-by-hand":"yes"}}}',
);
const targetPortDrifted = kubectl(
  "patch",
  "service",
  "web",
  "--type=json",
  '--patch=[{"op":"replace","path":"/spec/ports/0/targetPort","value":9090}]',
);
const secretDeleted = kubectl("delete", "secret", "web-token", "--wait");

// A hook that deletes itself once it ran, the way a chart's migration job
// does. It is never in the cluster between deploys.
const hookTemplate: Step = {
  kind: "write",
  file: "charts/web/templates/hook.yaml",
  content: [
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    "  name: {{ .Release.Name }}-hook",
    "  annotations:",
    "    helm.sh/hook: post-install,post-upgrade",
    "    helm.sh/hook-delete-policy: hook-succeeded",
    "data:",
    '  ran: "yes"',
    "",
  ].join("\n"),
};

// A chart that web depends on, so worker's dependency has a dependency of its
// own: a subchart of a subchart (record 0069).
const baseChart: Step[] = [
  {
    kind: "write",
    file: "charts/base/Chart.yaml",
    content: "apiVersion: v2\nname: base\ntype: application\nversion: 0.1.0\n",
  },
  {
    kind: "write",
    file: "charts/base/templates/configmap.yaml",
    content: [
      "apiVersion: v1",
      "kind: ConfigMap",
      "metadata:",
      "  name: {{ .Release.Name }}-base",
      "data:",
      '  layer: "base"',
      "",
    ].join("\n"),
  },
  edit(
    "version: 0.1.0\n",
    "version: 0.1.0\ndependencies:\n  - name: base\n    version: 0.1.0\n    repository: file://../base\n",
    "charts/web/Chart.yaml",
  ),
];

function start(steps: Step[]): Step[] {
  return [...uninstalled, ...steps];
}

// The scenarios for one helm version: the deploy's command line differs
// between Helm 3 and Helm 4 (record 0069).
export function helmScenarios(helmVersion: string): Scenario[] {
  const major = Number(/^v?(\d+)\./.exec(helmVersion)?.[1] ?? "0");
  const helm4 = major >= 4;

  // A deploy the way the adapter makes one, to put a release where a scenario
  // needs it.
  const installed = (stack: HelmStack = WEB): Step => ({
    kind: "setup",
    cwd: stack.cwd,
    argv: HELM.deploy(stack, { major }),
  });

  const diff = (expect: Expectation, suffix = "", stack: HelmStack = WEB): Step => ({
    kind: "record",
    id: `diff${suffix}`,
    cwd: stack.cwd,
    argv: HELM.diff(stack),
    stdout: expect.exit === "zero" ? "json" : "text",
    expect,
  });

  const threeWay = (expect: Expectation, suffix = "", stack: HelmStack = WEB): Step => ({
    kind: "record",
    id: `three-way${suffix}`,
    cwd: stack.cwd,
    argv: HELM.threeWay(stack),
    stdout: "json",
    expect,
  });

  const render = (suffix = "", stack: HelmStack = WEB): Step => ({
    kind: "record",
    id: `render${suffix}`,
    cwd: stack.cwd,
    argv: HELM.render(stack),
    stdout: "text",
    expect: { exit: "zero" },
  });

  // apply reads the version right before the deploy, for the flag the deploy
  // takes (record 0069).
  const version = (stack: HelmStack = WEB): Step => ({
    kind: "record",
    id: "version",
    cwd: stack.cwd,
    argv: HELM.version,
    stdout: "text",
    expect: { exit: "zero" },
  });

  const deploy = (expect: Expectation, stack: HelmStack = WEB, forceConflicts = false): Step => ({
    kind: "record",
    id: "deploy",
    cwd: stack.cwd,
    argv: HELM.deploy(stack, { major, forceConflicts }),
    stdout: "text",
    expect,
  });

  const afterDeploy = (
    name: string,
    description: string,
    before: Step[],
    edits: Step[],
    expect: Expectation,
  ): Scenario => ({
    name,
    description,
    steps: start([...before, installed(), ...edits, diff(expect)]),
  });

  // The drift check runs the preview's diff and the three-way diff, right
  // after the scan's own preview: the diff is recorded twice.
  const driftCheck = (threeWayExpect: Expectation, diffExpect: Expectation = { exit: "zero" }) => [
    diff(diffExpect),
    diff(diffExpect, "-again"),
    threeWay(threeWayExpect),
  ];

  return [
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
        "web deployed the way apply does it: the diff, the render the deploy is held to, the render again right before the deploy, the version for the deploy's flags, the deploy, and a diff after it.",
      steps: start([
        diff({ exit: "zero", ops: ["ADD"] }),
        render(),
        render("-again"),
        version(),
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
        version(),
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
    {
      name: "dependencies-nested",
      description:
        "worker's dependency web depends on base: web's dependencies are built first, then worker's, and the diff holds base's ConfigMap.",
      steps: start([
        ...baseChart,
        {
          kind: "record",
          id: "dependencies-web",
          cwd: "charts/web",
          argv: HELM.dependencies,
          stdout: "text",
          expect: { exit: "zero" },
        },
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
      name: "drift",
      description:
        "web deployed, then changed behind helm's back: a value of the ConfigMap and a label of its own, the Service's target port, and the Secret deleted. The diff sees nothing, the three-way diff against the live objects sees all but the label.",
      steps: start([
        installed(),
        greetingDrifted,
        targetPortDrifted,
        secretDeleted,
        ...driftCheck({ exit: "zero", ops: ["MODIFY", "ADD"] }),
      ]),
    },
    {
      name: "drift-and-change",
      description:
        "A value of the ConfigMap changed behind helm's back, and new values in the code for the same ConfigMap and the Service. Only the value changed by hand is drift.",
      steps: start([
        installed(),
        greetingDrifted,
        newColor,
        newPort,
        ...driftCheck({ exit: "zero", ops: ["MODIFY"] }, { exit: "zero", ops: ["MODIFY"] }),
      ]),
    },
    {
      name: "drift-hooks",
      description:
        "A chart with a hook that deletes itself once it ran, deployed, and nothing changed. The hook is not in the cluster, and it is no drift.",
      steps: start([hookTemplate, installed(), ...driftCheck({ exit: "zero" })]),
    },
    {
      name: "drift-repaired",
      description:
        "web drifted, and apply deploys over it: the fresh preview and its render, the drift check again, the render right before the deploy, the version, on Helm 4 how the release is applied, the deploy, and the drift check after it, which finds nothing.",
      steps: start([
        installed(),
        greetingDrifted,
        secretDeleted,
        diff({ exit: "zero" }),
        render(),
        diff({ exit: "zero" }, "-again"),
        threeWay({ exit: "zero", ops: ["MODIFY", "ADD"] }),
        render("-again"),
        version(),
        ...(helm4
          ? [
              {
                kind: "record",
                id: "metadata",
                cwd: WEB.cwd,
                argv: HELM.metadata(WEB),
                stdout: "json",
                expect: { exit: "zero" },
              } satisfies Step,
            ]
          : []),
        deploy({ exit: "zero" }, WEB, helm4),
        diff({ exit: "zero" }, "-after"),
        threeWay({ exit: "zero" }, "-after"),
      ]),
    },
    {
      name: "create-namespace",
      description:
        "web into a namespace that is not there, with createNamespace: the diff and the render work without it, and the deploy makes it.",
      steps: start([
        {
          kind: "setup",
          cwd: ".",
          argv: [
            "kubectl",
            "delete",
            "namespace",
            WEB_NEW_NAMESPACE.namespace,
            "--ignore-not-found",
            "--wait",
          ],
        },
        diff({ exit: "zero", ops: ["ADD"] }, "", WEB_NEW_NAMESPACE),
        render("", WEB_NEW_NAMESPACE),
        render("-again", WEB_NEW_NAMESPACE),
        version(WEB_NEW_NAMESPACE),
        deploy({ exit: "zero" }, WEB_NEW_NAMESPACE),
        diff({ exit: "zero" }, "-after", WEB_NEW_NAMESPACE),
        {
          kind: "setup",
          cwd: ".",
          argv: [
            "helm",
            "uninstall",
            WEB_NEW_NAMESPACE.release,
            `--namespace=${WEB_NEW_NAMESPACE.namespace}`,
            "--wait",
          ],
        },
        {
          kind: "setup",
          cwd: ".",
          argv: ["kubectl", "delete", "namespace", WEB_NEW_NAMESPACE.namespace, "--wait"],
        },
      ]),
    },
  ];
}

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
