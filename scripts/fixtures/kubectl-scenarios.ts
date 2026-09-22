// The scenarios examples/kubernetes-basic is driven through (record 0060).
// Each one starts from a fresh copy of the example and a fresh namespace in a
// kind cluster, the only cluster the recorder talks to. An edit names text of
// the example word for word, so when the example changes and a scenario no
// longer fits, the recorder stops instead of recording something else.
import { join } from "node:path";
import { PREVIEW_DIFF } from "../../src/adapters/kubectl/commands.ts";
import {
  inventoryName,
  type ListedObject,
  stubs,
  withInventory,
} from "../../src/adapters/kubectl/inventory.ts";
import type { Expectation, RecordOptions, Scenario, Step } from "./recorder.ts";
import { PLAN_FILE, PRUNE_FILE } from "./recorder.ts";

// The namespace of the example. Every scenario makes it anew.
export const EXAMPLE_NAMESPACE = "sluiceway-example";

// The file name the adapter gives a rendered set.
export const RENDERED_SET = "manifests.yaml";

// The command lines are the ones the adapter runs (src/adapters/kubectl/).
const WEB_TARGET = [`--namespace=${EXAMPLE_NAMESPACE}`];
export const KUBECTL = {
  version: ["kubectl", "version", "--client", "--output=json"],
  kustomize: ["kubectl", "kustomize", "."],
  diff: (target: string[]) => ["kubectl", "diff", "--server-side", ...target, "-f", PLAN_FILE],
  apply: (target: string[]) => ["kubectl", "apply", "--server-side", ...target, "-f", PLAN_FILE],
  // Part 2 (record 0070).
  drift: (target: string[]) => [
    "kubectl",
    "diff",
    "--server-side",
    ...target,
    "--show-managed-fields",
    "-f",
    PLAN_FILE,
  ],
  inventory: (name: string, target: string[]) => [
    "kubectl",
    "get",
    "configmap",
    name,
    ...target,
    "--ignore-not-found",
    "--output=json",
  ],
  live: (target: string[]) => [
    "kubectl",
    "get",
    ...target,
    "--ignore-not-found",
    "--show-managed-fields",
    "--output=json",
    "-f",
    PRUNE_FILE,
  ],
  delete: (target: string[]) => [
    "kubectl",
    "delete",
    ...target,
    "--ignore-not-found",
    "-f",
    PRUNE_FILE,
  ],
};

// The stacks of examples/kubernetes-basic/sluiceway.yaml.
interface KubectlStack {
  cwd: string;
  target: string[];
  kustomization: boolean;
}
const WEB: KubectlStack = { cwd: "web", target: WEB_TARGET, kustomization: false };
const CACHE: KubectlStack = { cwd: "cache", target: [], kustomization: true };

const PREVIEW_ENV = { KUBECTL_EXTERNAL_DIFF: PREVIEW_DIFF };

// A fresh namespace, so no scenario sees what another one left.
const freshNamespace: Step[] = [
  {
    kind: "setup",
    cwd: ".",
    argv: ["kubectl", "delete", "namespace", EXAMPLE_NAMESPACE, "--ignore-not-found", "--wait"],
  },
  { kind: "setup", cwd: ".", argv: ["kubectl", "create", "namespace", EXAMPLE_NAMESPACE] },
];

const goneNamespace: Step = {
  kind: "setup",
  cwd: ".",
  argv: ["kubectl", "delete", "namespace", EXAMPLE_NAMESPACE, "--ignore-not-found", "--wait"],
};

// The rendered set of the stack in the plan file, recorded or not.
function rendered(stack: KubectlStack, record?: string): Step {
  if (!stack.kustomization) return { kind: "bundle", cwd: stack.cwd };
  if (record === undefined) {
    return { kind: "setup", cwd: stack.cwd, argv: KUBECTL.kustomize, stdoutToPlan: true };
  }
  return {
    kind: "record",
    id: record,
    cwd: stack.cwd,
    argv: KUBECTL.kustomize,
    stdout: "text",
    expect: { exit: "zero" },
    stdoutToPlan: true,
  };
}

// A deploy the plain way, to put a stack where a scenario needs it.
function deployed(stack: KubectlStack): Step[] {
  return [rendered(stack), { kind: "setup", cwd: stack.cwd, argv: KUBECTL.apply(stack.target) }];
}

// The preview: the rendered set, recorded for a kustomization, then the diff.
function preview(stack: KubectlStack, expect: Expectation, suffix = ""): Step[] {
  return [
    rendered(stack, `kustomize${suffix}`),
    {
      kind: "record",
      id: `diff${suffix}`,
      cwd: stack.cwd,
      argv: KUBECTL.diff(stack.target),
      stdout: "diff",
      expect,
      env: PREVIEW_ENV,
    },
  ];
}

function apply(stack: KubectlStack, expect: Expectation): Step {
  return {
    kind: "record",
    id: "apply",
    cwd: stack.cwd,
    argv: KUBECTL.apply(stack.target),
    stdout: "text",
    expect,
  };
}

function edit(file: string, find: string, replace: string): Step {
  return { kind: "edit", file, find, replace };
}

// kubectl diff's exit codes: 1 is differences, above 1 is an error.
const DIFFERENCES = (ops: string[]): Expectation => ({ exit: "nonzero", ops });
const NONE: Expectation = { exit: "zero" };
const ERROR: Expectation = { exit: "nonzero" };

const newGreeting = edit(
  "web/configmap.yaml",
  "greeting: CANARY-VALUE, hello",
  "greeting: CANARY-VALUE, good morning",
);
const moreReplicas = edit("web/deployment.yaml", "replicas: 1", "replicas: 2");
const newImage = edit(
  "web/deployment.yaml",
  "image: registry.k8s.io/pause:3.10",
  "image: registry.k8s.io/pause:3.9",
);
const newPort = edit("web/service.json", '"targetPort": 8080', '"targetPort": 8081');
const rotatedSecret = edit(
  "web/secret.yaml",
  "password: CANARY-SECRET",
  "password: CANARY-SECRET-ROTATED",
);
const addedConfigMap: Step = {
  kind: "write",
  file: "web/extra.yaml",
  content: `apiVersion: v1
kind: ConfigMap
metadata:
  name: web-extra
data:
  motd: CANARY-VALUE
`,
};

function afterDeploy(
  name: string,
  description: string,
  edits: Step[],
  expect: Expectation,
  stack = WEB,
): Scenario {
  return {
    name,
    description,
    steps: [...freshNamespace, ...deployed(stack), ...edits, ...preview(stack, expect)],
  };
}

// Part 2 (record 0070). web with pruning: the stack id is web, and the
// recorder has no repository, so the inventory's name is the one the adapter
// gives a stack web outside a repository.
const INVENTORY = inventoryName("web");
const PRUNED_WEB: KubectlStack = { cwd: "web", target: WEB_TARGET, kustomization: false };
// web with its own field manager, taking fields that others hold.
const FORCED_WEB: KubectlStack = {
  cwd: "web",
  target: [...WEB_TARGET, "--force-conflicts", "--field-manager=sluiceway-web"],
  kustomization: false,
};

// The rendered set of web with its inventory, as the adapter writes it, with
// the objects still to be pruned listed too.
function prunedSet(pruned: ListedObject[] = []): Step {
  return {
    kind: "bundle",
    cwd: "web",
    append: (bundled) => withInventory(bundled, INVENTORY, "web", pruned),
  };
}

function recorded(
  id: string,
  stack: KubectlStack,
  argv: string[],
  expect: Expectation,
  format: "text" | "diff" = "text",
): Step {
  return {
    kind: "record",
    id,
    cwd: stack.cwd,
    argv,
    stdout: format,
    expect,
    ...(format === "diff" ? { env: PREVIEW_ENV } : {}),
  };
}

// The ConfigMap of web, as the inventory lists it (the manifest names no
// namespace), and as the live object names it.
const SETTINGS: ListedObject = { apiVersion: "v1", kind: "ConfigMap", name: "web-settings" };
const LIVE_SETTINGS: ListedObject = { ...SETTINGS, namespace: EXAMPLE_NAMESPACE };

const PART_2: Scenario[] = [
  {
    name: "prune-first",
    description:
      "web with pruning before its first deploy: no inventory yet, and every object and the inventory are creates.",
    steps: [
      ...freshNamespace,
      recorded("inventory", PRUNED_WEB, KUBECTL.inventory(INVENTORY, WEB_TARGET), NONE),
      prunedSet(),
      recorded("diff", PRUNED_WEB, KUBECTL.diff(WEB_TARGET), DIFFERENCES(["create"]), "diff"),
    ],
  },
  {
    name: "prune",
    description:
      "web deployed with pruning, then its ConfigMap taken out of the manifests: the preview finds it through the inventory, the deploy deletes it, and the preview after lists it no more.",
    steps: [
      ...freshNamespace,
      prunedSet(),
      { kind: "setup", cwd: "web", argv: KUBECTL.apply(WEB_TARGET) },
      { kind: "remove", file: "web/configmap.yaml" },
      recorded("inventory", PRUNED_WEB, KUBECTL.inventory(INVENTORY, WEB_TARGET), NONE),
      { kind: "prune-file", content: stubs([SETTINGS]) },
      recorded("live", PRUNED_WEB, KUBECTL.live(WEB_TARGET), NONE),
      prunedSet([SETTINGS]),
      recorded("diff", PRUNED_WEB, KUBECTL.diff(WEB_TARGET), NONE, "diff"),
      recorded("apply", PRUNED_WEB, KUBECTL.apply(WEB_TARGET), NONE),
      { kind: "prune-file", content: stubs([LIVE_SETTINGS]) },
      recorded("delete", PRUNED_WEB, KUBECTL.delete(WEB_TARGET), NONE),
      recorded("inventory-after", PRUNED_WEB, KUBECTL.inventory(INVENTORY, WEB_TARGET), NONE),
      { kind: "prune-file", content: stubs([SETTINGS]) },
      recorded("live-after", PRUNED_WEB, KUBECTL.live(WEB_TARGET), NONE),
      prunedSet(),
      recorded("diff-after", PRUNED_WEB, KUBECTL.diff(WEB_TARGET), DIFFERENCES(["update"]), "diff"),
    ],
  },
  {
    name: "drift-deleted",
    description:
      "web deployed with pruning, then its ConfigMap deleted by hand: the preview shows a create, and the drift check knows the stack deployed it.",
    steps: [
      ...freshNamespace,
      prunedSet(),
      { kind: "setup", cwd: "web", argv: KUBECTL.apply(WEB_TARGET) },
      {
        kind: "setup",
        cwd: ".",
        argv: [
          "kubectl",
          "delete",
          "configmap",
          "web-settings",
          `--namespace=${EXAMPLE_NAMESPACE}`,
          "--wait",
        ],
      },
      recorded("inventory", PRUNED_WEB, KUBECTL.inventory(INVENTORY, WEB_TARGET), NONE),
      prunedSet(),
      recorded("diff", PRUNED_WEB, KUBECTL.diff(WEB_TARGET), DIFFERENCES(["create"]), "diff"),
      recorded("inventory-drift", PRUNED_WEB, KUBECTL.inventory(INVENTORY, WEB_TARGET), NONE),
      recorded("drift", PRUNED_WEB, KUBECTL.drift(WEB_TARGET), DIFFERENCES(["create"]), "diff"),
    ],
  },
  {
    name: "drift-changed",
    description:
      "web deployed with its own field manager, then scaled and patched by hand: with forceConflicts the preview takes both back, and the drift check names them.",
    steps: [
      ...freshNamespace,
      rendered(FORCED_WEB),
      { kind: "setup", cwd: "web", argv: KUBECTL.apply(FORCED_WEB.target) },
      {
        kind: "setup",
        cwd: ".",
        argv: [
          "kubectl",
          "scale",
          "deployment",
          "web",
          "--replicas=3",
          `--namespace=${EXAMPLE_NAMESPACE}`,
        ],
      },
      {
        kind: "setup",
        cwd: ".",
        argv: [
          "kubectl",
          "patch",
          "configmap",
          "web-settings",
          `--namespace=${EXAMPLE_NAMESPACE}`,
          "--patch",
          '{"data":{"log-level":"debug"}}',
        ],
      },
      rendered(FORCED_WEB),
      recorded(
        "diff",
        FORCED_WEB,
        KUBECTL.diff(FORCED_WEB.target),
        DIFFERENCES(["update"]),
        "diff",
      ),
      recorded(
        "drift",
        FORCED_WEB,
        KUBECTL.drift(FORCED_WEB.target),
        DIFFERENCES(["update"]),
        "diff",
      ),
      recorded("apply", FORCED_WEB, KUBECTL.apply(FORCED_WEB.target), NONE),
      recorded("diff-after", FORCED_WEB, KUBECTL.diff(FORCED_WEB.target), NONE, "diff"),
    ],
  },
  {
    name: "drift-conflict",
    description:
      "web deployed, then scaled by hand: without forceConflicts the preview meets the conflict, as a deploy would.",
    steps: [
      ...freshNamespace,
      ...deployed(WEB),
      {
        kind: "setup",
        cwd: ".",
        argv: [
          "kubectl",
          "scale",
          "deployment",
          "web",
          "--replicas=3",
          `--namespace=${EXAMPLE_NAMESPACE}`,
        ],
      },
      ...preview(WEB, ERROR),
    ],
  },
  {
    name: "recursive",
    description:
      "web with recursive and a manifest in a subdirectory: the set holds it, as kubectl -R reads it.",
    steps: [
      ...freshNamespace,
      {
        kind: "write",
        file: "web/more/extra.yaml",
        content: `apiVersion: v1
kind: ConfigMap
metadata:
  name: web-more
data:
  motd: CANARY-VALUE
`,
      },
      { kind: "bundle", cwd: "web", recursive: true },
      recorded("diff", WEB, KUBECTL.diff(WEB_TARGET), DIFFERENCES(["create"]), "diff"),
    ],
  },
];

export const KUBECTL_SCENARIOS: Scenario[] = [
  {
    name: "version",
    description: "kubectl version --client, which the version check reads.",
    steps: [
      {
        kind: "record",
        id: "version",
        cwd: ".",
        argv: KUBECTL.version,
        stdout: "json",
        expect: { exit: "zero" },
      },
    ],
  },
  {
    name: "new-stack",
    description:
      "Both stacks before their first deploy, in an empty namespace: every object is a create.",
    steps: [
      ...freshNamespace,
      ...preview(WEB, DIFFERENCES(["create"])),
      ...preview(CACHE, DIFFERENCES(["create"]), "-cache"),
    ],
  },
  afterDeploy("no-changes", "web, deployed, and nothing changed.", [], NONE),
  afterDeploy(
    "update",
    "A new value in a ConfigMap, more replicas and a new image, and a new port in the JSON Service.",
    [newGreeting, moreReplicas, newImage, newPort],
    DIFFERENCES(["update"]),
  ),
  afterDeploy(
    "kustomize-update",
    "cache, a kustomization, with more replicas.",
    [edit("cache/deployment.yaml", "replicas: 1", "replicas: 3")],
    DIFFERENCES(["update"]),
    CACHE,
  ),
  afterDeploy(
    "changed-secret",
    "The Secret's password rotated: kubectl masks both sides.",
    [rotatedSecret],
    DIFFERENCES(["update"]),
  ),
  afterDeploy(
    "mixed",
    "A new ConfigMap next to an update of the Deployment.",
    [addedConfigMap, moreReplicas],
    DIFFERENCES(["create", "update"]),
  ),
  afterDeploy(
    "removed-object",
    "The ConfigMap taken out of the manifests: without pruning kubectl leaves it, and the diff is empty.",
    [{ kind: "remove", file: "web/configmap.yaml" }],
    NONE,
  ),
  afterDeploy(
    "immutable-field",
    "A new selector of the Deployment, which the API server refuses to change.",
    [
      edit(
        "web/deployment.yaml",
        "    matchLabels:\n      app.kubernetes.io/name: web\n",
        "    matchLabels:\n      app.kubernetes.io/name: web-2\n",
      ),
      edit(
        "web/deployment.yaml",
        "      labels:\n        app.kubernetes.io/name: web\n    spec:",
        "      labels:\n        app.kubernetes.io/name: web-2\n    spec:",
      ),
    ],
    ERROR,
  ),
  {
    name: "conflict",
    description:
      "Another field manager took the Deployment's replicas: the server-side dry run meets the conflict the deploy would meet.",
    steps: [
      ...freshNamespace,
      ...deployed(WEB),
      {
        kind: "write",
        file: "other-team/replicas.yaml",
        content: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
`,
      },
      {
        kind: "setup",
        cwd: "other-team",
        argv: [
          "kubectl",
          "apply",
          "--server-side",
          "--force-conflicts",
          "--field-manager=other-team",
          ...WEB_TARGET,
          "-f",
          "replicas.yaml",
        ],
      },
      ...preview(WEB, ERROR),
    ],
  },
  {
    name: "invalid-manifest",
    description: "A manifest of a kind the cluster does not know.",
    steps: [
      ...freshNamespace,
      {
        kind: "write",
        file: "web/broken.yaml",
        content: "apiVersion: example.com/v1\nkind: NoSuchKind\nmetadata:\n  name: broken\n",
      },
      ...preview(WEB, ERROR),
    ],
  },
  {
    name: "kustomize-error",
    description: "A kustomization that names a file that is not there: kustomize fails.",
    steps: [
      ...freshNamespace,
      edit("cache/kustomization.yaml", "  - service.yaml\n", "  - missing.yaml\n"),
      {
        kind: "record",
        id: "kustomize",
        cwd: "cache",
        argv: KUBECTL.kustomize,
        stdout: "text",
        expect: ERROR,
      },
    ],
  },
  {
    name: "missing-namespace",
    description:
      "web's namespace does not exist: the server-side dry run cannot place the objects.",
    steps: [goneNamespace, ...preview(WEB, ERROR)],
  },
  {
    name: "same-diff-twice",
    description: "The same preview of an update twice, to see that the output holds still.",
    steps: [
      ...freshNamespace,
      ...deployed(WEB),
      newGreeting,
      moreReplicas,
      ...preview(WEB, DIFFERENCES(["update"])),
      ...preview(WEB, DIFFERENCES(["update"]), "-again"),
    ],
  },
  {
    name: "deploy",
    description: "web deployed from the rendered set its preview diffed, the way apply does it.",
    steps: [...freshNamespace, ...preview(WEB, DIFFERENCES(["create"])), apply(WEB, NONE)],
  },
  {
    name: "deploy-failed",
    description:
      "A preview that works, then the namespace goes before the deploy: the deploy fails.",
    steps: [
      ...freshNamespace,
      ...preview(WEB, DIFFERENCES(["create"])),
      goneNamespace,
      apply(WEB, ERROR),
    ],
  },
  {
    name: "log-diff-changed-secret",
    description:
      "The tool's own diff of a rotated Secret and a new ConfigMap value, for the job log (record 0048).",
    steps: [
      ...freshNamespace,
      ...deployed(WEB),
      rotatedSecret,
      newGreeting,
      { kind: "bundle", cwd: "web" },
      {
        kind: "record",
        id: "tool-diff",
        cwd: "web",
        argv: KUBECTL.diff(WEB.target),
        stdout: "text",
        expect: { exit: "nonzero" },
      },
    ],
  },
  ...PART_2,
];

// Built from nothing, not from the environment of whoever runs the recorder.
// PATH comes through so the tool can be found, and KUBECONFIG so it finds the
// kind cluster the recorder checked. HOME points into the work directory, so
// no file of the user is read.
export function kubectlEnvironment(options: RecordOptions): Record<string, string> {
  return {
    PATH: options.parentEnv.PATH ?? "",
    HOME: join(options.workDir, "home"),
    KUBECONFIG: options.parentEnv.KUBECONFIG ?? join(options.workDir, "home", ".kube", "config"),
    USER: "sluiceway",
  };
}

// What the recorder checks a diff for: one op per object, from its hunk
// header. Nothing on the live side is a create, nothing on the merged side is
// a delete, anything else an update.
export function kubectlOps(stdout: unknown): string[] {
  if (typeof stdout !== "string") return [];
  return [...stdout.matchAll(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/gm)].map((match) =>
    match[1] === "0" ? "create" : match[2] === "0" ? "delete" : "update",
  );
}
