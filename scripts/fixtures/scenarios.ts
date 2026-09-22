// The scenarios the example project is driven through. Each one starts from a
// fresh copy of examples/pulumi-basic and a fresh file backend. An edit names
// text of the example word for word, so when the example changes and a scenario
// no longer fits, the recorder stops instead of recording something else.
import type { Expectation, Scenario, Step } from "./recorder.ts";

// The command lines are the ones the adapter will use (Pulumi research,
// "Consequences for the design"). The recorder sets the working directory
// where the adapter may pass --cwd.
const QUIET = ["--non-interactive", "--color", "never"];

function init(cwd: string, stack: string): Step {
  return { kind: "setup", cwd, argv: ["pulumi", "stack", "init", stack, ...QUIET] };
}

function up(cwd: string, stack: string): Step {
  return {
    kind: "setup",
    cwd,
    argv: ["pulumi", "up", "--yes", "--skip-preview", ...QUIET, "--stack", stack],
  };
}

// The deploy as the adapter runs it (Pulumi research, "Non-interactive up").
// No --json: on `up` that streams engine events, which hold every property
// value. The stack outputs are kept out of what the tool prints, because an
// output can be a secret (record 0021).
function deploy(cwd: string, stack: string, expect: Expectation, id = "up"): Step {
  return {
    kind: "record",
    id,
    cwd,
    argv: [
      "pulumi",
      "up",
      "--yes",
      "--skip-preview",
      "--suppress-outputs",
      ...QUIET,
      "--stack",
      stack,
    ],
    stdout: "text",
    expect,
  };
}

function preview(cwd: string, stack: string, expect: Expectation, id = "preview"): Step {
  return {
    kind: "record",
    id,
    cwd,
    argv: ["pulumi", "preview", "--json", ...QUIET, "--stack", stack],
    stdout: "json",
    expect,
  };
}

// The tool's own diff, for the job log only (record 0048): the preview as the
// tool displays it, with every value it does not hold as secret. The stack
// outputs stay out, as on the deploy (record 0036).
function toolDiff(cwd: string, stack: string, expect: Expectation): Step {
  return {
    kind: "record",
    id: "diff",
    cwd,
    argv: ["pulumi", "preview", "--diff", "--suppress-outputs", ...QUIET, "--stack", stack],
    stdout: "text",
    expect,
  };
}

// The drift check as the adapter runs it (record 0055): a refresh that only
// previews, and changes neither the state nor anything real. The tool's one
// JSON document lists a property that drifted as a plain "refresh" step with no
// paths, and only its change summary counts it, on both CLI versions. Its
// engine events name the resource and the op, so the check asks for those.
const STREAM = { PULUMI_ENABLE_STREAMING_JSON_PREVIEW: "true" };

function driftCheck(
  cwd: string,
  stack: string,
  expect: Expectation,
  id = "drift",
  // A check that fails may print no JSON at all.
  stdout: "jsonl" | "text" = "jsonl",
): Step {
  return {
    kind: "record",
    id,
    cwd,
    argv: ["pulumi", "refresh", "--preview-only", "--json", ...QUIET, "--stack", stack],
    env: STREAM,
    stdout,
    expect,
  };
}

// The deploy of a row whose diff hash covers drift (record 0055): the same
// command line as the deploy, and --refresh, so the tool reads what is real
// first and then puts it back as the code says.
function repair(cwd: string, stack: string, expect: Expectation): Step {
  return {
    kind: "record",
    id: "up",
    cwd,
    argv: [
      "pulumi",
      "up",
      "--yes",
      "--skip-preview",
      "--refresh",
      "--suppress-outputs",
      ...QUIET,
      "--stack",
      stack,
    ],
    stdout: "text",
    expect,
  };
}

const NETWORK = "network/Pulumi.yaml";

// A file the network stack manages, written by its deploy. Removing it is a
// real object changed behind the tool's back.
const NOTES = "network/out/notes.txt";

// A resource of site/ whose provider reads the real file back on a refresh, so
// a changed file is drift on a property and not a resource that is gone. The
// local provider reports a file with other content as gone. The example
// itself does not change: the scenario adds this.
const SITE_NOTE = `

// Added by the fixture recorder: a file that the stack manages, read back on
// a refresh.
const noteProvider: pulumi.dynamic.ResourceProvider = {
  async create(inputs) {
    const fs = require("node:fs");
    fs.mkdirSync(require("node:path").dirname(inputs.path), { recursive: true });
    fs.writeFileSync(inputs.path, inputs.text);
    return { id: inputs.path, outs: inputs };
  },
  async diff(_id, olds, news) {
    return { changes: olds.text !== news.text };
  },
  async update(_id, _olds, news) {
    require("node:fs").writeFileSync(news.path, news.text);
    return { outs: news };
  },
  async read(id, props) {
    const fs = require("node:fs");
    if (!fs.existsSync(id)) return { id: "", props: {} };
    return { id, props: { ...props, text: fs.readFileSync(id, "utf8") } };
  },
};

class Note extends pulumi.dynamic.Resource {
  constructor(name: string, args: { path: string; text: string }) {
    super(noteProvider, name, args);
  }
}

new Note("note", { path: \`\${process.cwd()}/out/note.txt\`, text: "CANARY-VALUE" });
`;

// A lock on network:dev as a deploy that is still running holds it, in the
// file backend's own place and form. Whatever takes the lock fails while it is
// there.
const HELD_LOCK = {
  kind: "backend",
  file: ".pulumi/locks/organization/network/dev/0f5e8a2c-9b1d-4c3e-8f7a-6d5c4b3a2918.json",
  content: `${JSON.stringify({ pid: 4242, username: "deployer", hostname: "runner", timestamp: "2026-09-22T08:00:00Z" })}\n`,
} as const satisfies Step;

function edit(find: string, replace: string, file = NETWORK): Step {
  return { kind: "edit", file, find, replace };
}

// Pieces of network/Pulumi.yaml, word for word.
const SUBNET = `  subnet:
    type: random:RandomString
    properties:
      length: 8
      special: false
    options:
      version: 4.21.2
`;
const SUBNET_RETAINED = SUBNET.replace(
  "    options:\n",
  "    options:\n      retainOnDelete: true\n",
);
const OUTPUTS = "outputs:\n";

const changedEnvironment = edit(
  "        NOTE: CANARY-VALUE\n",
  "        NOTE: CANARY-VALUE\n        STAGE: second\n",
);
const changedPrefix = edit("      prefix: net\n", "      prefix: lan\n");
const changedContent = edit(
  "      content: Managed by the network stack.\n    options:\n",
  "      content: Managed by the network stack, second edition.\n    options:\n      deleteBeforeReplace: true\n",
);
const removedSubnet = edit(SUBNET, "");
const addedResource = edit(
  OUTPUTS,
  `  extra:
    type: random:RandomPet
    properties:
      length: 3
    options:
      version: 4.21.2
${OUTPUTS}`,
);

const rotateSecret: Step = {
  kind: "setup",
  cwd: "network",
  argv: [
    "pulumi",
    "config",
    "set",
    "--secret",
    "token",
    "CANARY-SECRET-ROTATED",
    ...QUIET,
    "--stack",
    "dev",
  ],
};

// A deployed network:dev stack, then the given edits, then one preview.
function afterDeploy(
  name: string,
  description: string,
  edits: Step[],
  expect: Expectation,
): Scenario {
  return {
    name,
    description,
    steps: [
      init("network", "dev"),
      up("network", "dev"),
      ...edits,
      preview("network", "dev", expect),
    ],
  };
}

const MANY = 300;

function manyResources(): string {
  const resources = Array.from({ length: MANY }, (_, index) => {
    const name = `item${String(index + 1).padStart(3, "0")}`;
    return `  ${name}:\n    type: random:RandomId\n    properties:\n      byteLength: 4\n    options:\n      version: 4.21.2\n`;
  });
  return `name: many\nruntime: yaml\ndescription: Generated by the fixture recorder.\nresources:\n${resources.join("")}`;
}

// A program whose changes sit deep inside a property: a list index, a map key
// that needs quotes, and a replace forced by one key of a map (slice 2.15). The
// Kubernetes provider renders manifests to a directory instead of talking to a
// cluster, so it needs no cluster and no credentials. The canary value sits in
// both places that change, so a value that slipped into a path would show.
const NESTED = "generated/nested/Pulumi.yaml";

const NESTED_PROGRAM = `name: nested
runtime: yaml
description: Generated by the fixture recorder. Needs no cluster.
resources:
  render:
    type: pulumi:providers:kubernetes
    properties:
      renderYamlToDirectory: \${pulumi.cwd}/out
    options:
      version: 4.34.2
  web:
    type: kubernetes:apps/v1:Deployment
    properties:
      metadata:
        name: web
        annotations:
          example.com/revision: "1"
      spec:
        replicas: 1
        selector:
          matchLabels:
            app: web
        template:
          metadata:
            labels:
              app: web
          spec:
            containers:
              - name: web
                image: nginx:1.27
                env:
                  - name: NOTE
                    value: CANARY-VALUE
    options:
      provider: \${render}
      version: 4.34.2
  settings:
    type: kubernetes:core/v1:ConfigMap
    properties:
      metadata:
        name: settings
      data:
        app.properties: CANARY-VALUE
    options:
      provider: \${render}
      version: 4.34.2
`;

// A stack reference from app/ to network:prod (record 0059), the way a program
// reads the outputs of a stack it depends on. The example itself does not
// change: a reference to a stack that does not exist fails every preview, so
// the scenario adds it after network:prod is deployed. On a file backend the
// organization is always "organization".
const APP_PROGRAM = "app/program/Main.yaml";

const APP_REFERENCE = edit(
  "resources:\n",
  `resources:
  network:
    type: pulumi:pulumi:StackReference
    properties:
      name: organization/network/prod
`,
  APP_PROGRAM,
);

const APP_READS_NETWORK = edit(
  `        TIER: \${tier}\n`,
  `        TIER: \${tier}\n        NETWORK: \${network.outputs["networkName"]}\n`,
  APP_PROGRAM,
);

function nestedEdit(find: string, replace: string): Step {
  return edit(find, replace, NESTED);
}

export const SCENARIOS: Scenario[] = [
  {
    name: "version",
    description: "What the version check reads.",
    steps: [
      {
        kind: "record",
        id: "version",
        cwd: ".",
        argv: ["pulumi", "version"],
        stdout: "text",
        expect: { exit: "zero" },
      },
    ],
  },
  {
    name: "new-stack",
    description: "A stack that was never deployed. Every step is a create.",
    steps: [init("network", "dev"), preview("network", "dev", { exit: "zero", ops: ["create"] })],
  },
  {
    name: "new-stack-yml-project",
    description:
      "The same for app/, whose project file is spelled Pulumi.yml and which reads a file outside its directory.",
    steps: [init("app", "prod"), preview("app", "prod", { exit: "zero", ops: ["create"] })],
  },
  {
    name: "same-preview-twice",
    description:
      "The TypeScript program of site/, never deployed, previewed twice in a row. The order of the steps may differ between the two.",
    steps: [
      { kind: "setup", cwd: "site", argv: ["npm", "ci", "--no-audit", "--no-fund"] },
      init("site", "prod"),
      preview("site", "prod", { exit: "zero", ops: ["create"] }, "preview-1"),
      preview("site", "prod", { exit: "zero", ops: ["create"] }, "preview-2"),
    ],
  },
  afterDeploy("no-changes", "A deployed stack and no edit.", [], { exit: "zero" }),
  afterDeploy(
    "update",
    "One more environment variable on the command. An update in place.",
    [changedEnvironment],
    { exit: "zero", ops: ["update"] },
  ),
  afterDeploy(
    "replace",
    "A new prefix on the pet and new content in the file, the file with deleteBeforeReplace. Two replaces with replace reasons, one in each order.",
    [changedPrefix, changedContent],
    { exit: "zero", ops: ["replace"] },
  ),
  afterDeploy("delete", "The random string is gone from the program.", [removedSubnet], {
    exit: "zero",
    ops: ["delete"],
  }),
  afterDeploy(
    "mixed",
    "A create, an update, two replaces and a delete in one preview.",
    [changedEnvironment, changedPrefix, changedContent, removedSubnet, addedResource],
    { exit: "zero", ops: ["create", "update", "replace", "delete"] },
  ),
  afterDeploy(
    "outputs-only",
    "One more stack output and no resource change (record 0036).",
    [edit(OUTPUTS, `${OUTPUTS}  zone: \${zone}\n`)],
    { exit: "zero" },
  ),
  afterDeploy(
    "import",
    "A resource that the tool starts to track without creating it.",
    [
      edit(
        OUTPUTS,
        `  adopted:
    type: random:RandomId
    properties:
      byteLength: 4
    options:
      version: 4.21.2
      import: 3q2-7w
${OUTPUTS}`,
      ),
    ],
    { exit: "zero", ops: ["import"] },
  ),
  {
    name: "dropped-but-kept",
    description:
      "A resource deployed with retainOnDelete and then taken out of the program. The tool stops tracking it and the real object stays.",
    steps: [
      init("network", "dev"),
      edit(SUBNET, SUBNET_RETAINED),
      up("network", "dev"),
      edit(SUBNET_RETAINED, ""),
      preview("network", "dev", { exit: "zero", ops: ["delete"] }),
    ],
  },
  afterDeploy(
    "renamed-with-alias",
    "A resource under a new name, with an alias to the old one. The tool tracks it under a new address and the real object is left alone.",
    [
      edit("  name:\n    type: random:RandomPet\n", "  label:\n    type: random:RandomPet\n"),
      edit(
        "      prefix: net\n    options:\n",
        "      prefix: net\n    options:\n      aliases:\n        - name: name\n",
      ),
      edit(`\${name.id}`, `\${label.id}`),
    ],
    { exit: "zero" },
  ),
  afterDeploy(
    "changed-secret",
    "The secret config value has a new value. It shows as a changed property and its value is masked.",
    [
      {
        kind: "setup",
        cwd: "network",
        argv: [
          "pulumi",
          "config",
          "set",
          "--secret",
          "token",
          "CANARY-SECRET-ROTATED",
          ...QUIET,
          "--stack",
          "dev",
        ],
      },
    ],
    { exit: "zero", ops: ["update"] },
  ),
  {
    name: "deploy",
    description:
      "What apply runs for a stack that was never deployed: the fresh preview, then the deploy.",
    steps: [
      init("network", "dev"),
      preview("network", "dev", { exit: "zero", ops: ["create"] }),
      deploy("network", "dev", { exit: "zero" }),
    ],
  },
  {
    name: "deploy-failed",
    description:
      "The same with a command that fails when it is created. The preview is good, the deploy fails half way.",
    steps: [
      init("network", "dev"),
      edit("      create: echo network ready\n", "      create: exit 1\n"),
      preview("network", "dev", { exit: "zero", ops: ["create"] }),
      deploy("network", "dev", { exit: "nonzero" }),
    ],
  },
  {
    name: "program-error",
    description:
      "A resource type that does not exist. The preview fails and still prints a document.",
    steps: [
      init("network", "dev"),
      edit("    type: random:RandomString\n", "    type: random:NoSuchThing\n"),
      preview("network", "dev", { exit: "nonzero" }),
    ],
  },
  {
    name: "program-exception",
    description:
      "The TypeScript program of site/ throws. The preview fails with stderr empty, and the stack trace is a diagnostic in the document on stdout.",
    steps: [
      { kind: "setup", cwd: "site", argv: ["npm", "ci", "--no-audit", "--no-fund"] },
      init("site", "prod"),
      edit(
        "export const published = publish.stdout;\n",
        'export const published = publish.stdout;\n\nthrow new Error("the site program stops here");\n',
        "site/index.ts",
      ),
      preview("site", "prod", { exit: "nonzero" }),
    ],
  },
  {
    name: "resource-error",
    description:
      "The provider refuses the inputs of one resource, a random string of negative length. The preview fails with stderr empty, and the diagnostics on stdout name the resource.",
    steps: [
      init("network", "dev"),
      edit("      length: 8\n      special: false\n", "      length: -3\n      special: false\n"),
      preview("network", "dev", { exit: "nonzero" }),
    ],
  },
  {
    name: "missing-stack",
    description: "A stack that the backend does not hold.",
    steps: [
      {
        kind: "record",
        id: "preview",
        cwd: "network",
        argv: ["pulumi", "preview", "--json", ...QUIET, "--stack", "ghost"],
        stdout: "text",
        expect: { exit: "nonzero" },
      },
    ],
  },
  {
    name: "missing-config",
    description: "A config value the program requires is not in the stack file.",
    steps: [
      init("network", "dev"),
      edit("  network:zone: dev-a\n", "", "network/Pulumi.dev.yaml"),
      {
        kind: "record",
        id: "preview",
        cwd: "network",
        argv: ["pulumi", "preview", "--json", ...QUIET, "--stack", "dev"],
        stdout: "text",
        expect: { exit: "nonzero" },
      },
    ],
  },
  {
    name: "nested-paths",
    description:
      "A deployed program whose changes sit deep inside properties: a new image and a new canary value inside a list of containers, one annotation under a key that needs quotes, and one key of a config map, which forces a replace.",
    steps: [
      { kind: "write", file: NESTED, content: NESTED_PROGRAM },
      init("generated/nested", "dev"),
      up("generated/nested", "dev"),
      nestedEdit("image: nginx:1.27\n", "image: nginx:1.28\n"),
      nestedEdit("value: CANARY-VALUE\n", "value: CANARY-VALUE-2\n"),
      nestedEdit('example.com/revision: "1"\n', 'example.com/revision: "2"\n'),
      nestedEdit("app.properties: CANARY-VALUE\n", "app.properties: CANARY-VALUE-3\n"),
      preview("generated/nested", "dev", { exit: "zero", ops: ["update", "replace"] }),
    ],
  },
  {
    name: "log-diff-deploy",
    description:
      "What apply runs for a stack that was never deployed with scan.logDiff on: the fresh preview, the tool's own diff, then the deploy. Every value is in the diff, the secret as the tool marks it.",
    steps: [
      init("network", "dev"),
      preview("network", "dev", { exit: "zero", ops: ["create"] }),
      toolDiff("network", "dev", { exit: "zero" }),
      deploy("network", "dev", { exit: "zero" }),
    ],
  },
  {
    name: "log-diff-changed-secret",
    description:
      "What a scan with scan.logDiff on runs when the secret config value has a new value: the preview, then the tool's own diff, which shows the change and masks both values.",
    steps: [
      init("network", "dev"),
      up("network", "dev"),
      rotateSecret,
      preview("network", "dev", { exit: "zero", ops: ["update"] }),
      toolDiff("network", "dev", { exit: "zero" }),
    ],
  },
  {
    name: "log-diff-missing-config",
    description:
      "The tool's own diff of a stack whose config lacks a value the program requires. It fails like the preview does.",
    steps: [
      init("network", "dev"),
      edit("  network:zone: dev-a\n", "", "network/Pulumi.dev.yaml"),
      toolDiff("network", "dev", { exit: "nonzero" }),
    ],
  },
  {
    name: "drift-gone",
    description:
      "A deployed stack whose managed file was removed behind the tool's back: the drift check before and after, the preview, which sees nothing, and the deploy with --refresh that puts the file back.",
    steps: [
      init("network", "dev"),
      up("network", "dev"),
      driftCheck("network", "dev", { exit: "zero" }, "drift-before"),
      { kind: "remove", file: NOTES },
      preview("network", "dev", { exit: "zero" }),
      driftCheck("network", "dev", { exit: "zero", ops: ["delete"] }),
      repair("network", "dev", { exit: "zero" }),
      driftCheck("network", "dev", { exit: "zero" }, "drift-after"),
    ],
  },
  {
    name: "drift-changed",
    description:
      "The TypeScript program of site/ with a resource that reads its file back, deployed, then the file edited by hand: a property drifted. The preview sees nothing, the drift check names the resource, and the deploy with --refresh writes the file back.",
    steps: [
      { kind: "setup", cwd: "site", argv: ["npm", "ci", "--no-audit", "--no-fund"] },
      edit(
        "export const published = publish.stdout;\n",
        `export const published = publish.stdout;\n${SITE_NOTE}`,
        "site/index.ts",
      ),
      init("site", "prod"),
      up("site", "prod"),
      { kind: "write", file: "site/out/note.txt", content: "CANARY-VALUE, edited by hand" },
      preview("site", "prod", { exit: "zero" }),
      driftCheck("site", "prod", { exit: "zero", ops: ["update"] }),
      repair("site", "prod", { exit: "zero" }),
      driftCheck("site", "prod", { exit: "zero" }, "drift-after"),
    ],
  },
  {
    name: "drift-locked",
    description:
      "The drift check while a deploy holds the stack lock of the file backend. From v3.229.0 it takes no lock and runs. A deploy in the same place fails on the lock, which shows the lock is real.",
    steps: [
      init("network", "dev"),
      up("network", "dev"),
      { kind: "remove", file: NOTES },
      HELD_LOCK,
      driftCheck("network", "dev", { exit: "zero", ops: ["delete"] }),
      deploy("network", "dev", { exit: "nonzero" }, "up-locked"),
    ],
  },
  {
    name: "drift-missing-stack",
    description: "The drift check of a stack that the backend does not hold.",
    steps: [driftCheck("network", "ghost", { exit: "nonzero" }, "drift", "text")],
  },
  {
    name: "stack-reference",
    description:
      "app/ reads an output of network:prod through a stack reference: the preview of app:prod before it was deployed, and again after, when nothing changed.",
    steps: [
      init("network", "prod"),
      up("network", "prod"),
      APP_REFERENCE,
      APP_READS_NETWORK,
      init("app", "prod"),
      preview("app", "prod", { exit: "zero", ops: ["create", "read"] }),
      up("app", "prod"),
      preview("app", "prod", { exit: "zero" }, "preview-deployed"),
    ],
  },
  {
    name: "many-resources",
    description: `A generated program of ${MANY} resources, never deployed.`,
    steps: [
      { kind: "write", file: "generated/many/Pulumi.yaml", content: manyResources() },
      init("generated/many", "big"),
      preview("generated/many", "big", { exit: "zero", ops: ["create"] }),
    ],
  },
];
