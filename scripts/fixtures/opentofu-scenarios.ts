// The scenarios examples/opentofu-basic is driven through (record 0053). Each
// one starts from a fresh copy of the example, with its state in the local
// backend inside that copy. An edit names text of the example word for word,
// so when the example changes and a scenario no longer fits, the recorder
// stops instead of recording something else.
import { join } from "node:path";
import type { Expectation, RecordOptions, Scenario, Step } from "./recorder.ts";
import { PLAN_FILE } from "./recorder.ts";

// The command lines are the ones the adapter runs (src/adapters/opentofu/),
// behind a prefix: the binary, or Terragrunt in front of it (record 0068).
export function familyCommands(prefix: string[]) {
  return {
    init: [...prefix, "init", "-input=false", "-no-color"],
    plan: (varFiles: string[]) => [
      ...prefix,
      "plan",
      "-input=false",
      "-no-color",
      "-refresh=false",
      "-json",
      `-out=${PLAN_FILE}`,
      ...varFiles.map((file) => `-var-file=${file}`),
    ],
    show: [...prefix, "show", "-json", "-no-color", PLAN_FILE],
    apply: [...prefix, "apply", "-input=false", "-no-color", "-json", PLAN_FILE],
    diff: (varFiles: string[]) => [
      ...prefix,
      "plan",
      "-input=false",
      "-no-color",
      "-refresh=false",
      ...varFiles.map((file) => `-var-file=${file}`),
    ],
    version: [...prefix, "version", "-json"],
    // A deploy the plain way, to put a stack where a scenario needs it.
    deploy: (varFiles: string[]) => [
      ...prefix,
      "apply",
      "-input=false",
      "-no-color",
      "-auto-approve",
      "-refresh=false",
      ...varFiles.map((file) => `-var-file=${file}`),
    ],
  };
}

export type FamilyCommands = ReturnType<typeof familyCommands>;

export const TOFU = familyCommands(["tofu"]);
export const TERRAFORM = familyCommands(["terraform"]);

// The stacks of examples/opentofu-basic/sluiceway.yaml.
interface TofuStack {
  cwd: string;
  varFiles: string[];
  env?: Record<string, string>;
}
const DEV: TofuStack = { cwd: "network", varFiles: ["dev.tfvars"], env: { TF_WORKSPACE: "dev" } };
const PROD: TofuStack = {
  cwd: "network",
  varFiles: ["prod.tfvars"],
  env: { TF_WORKSPACE: "prod" },
};
const DNS: TofuStack = { cwd: "dns", varFiles: [] };

function withEnv(stack: TofuStack): { env?: Record<string, string> } {
  return stack.env === undefined ? {} : { env: stack.env };
}

function init(c: FamilyCommands, stack: TofuStack): Step {
  return { kind: "setup", cwd: stack.cwd, argv: c.init };
}

// A deploy the plain way, to put a stack where a scenario needs it.
function deployed(c: FamilyCommands, stack: TofuStack): Step {
  return {
    kind: "setup",
    cwd: stack.cwd,
    argv: c.deploy(stack.varFiles),
    ...withEnv(stack),
  };
}

function plan(c: FamilyCommands, stack: TofuStack, expect: Expectation, suffix = ""): Step[] {
  return [
    {
      kind: "record",
      id: `plan${suffix}`,
      cwd: stack.cwd,
      argv: c.plan(stack.varFiles),
      stdout: "text",
      expect: { exit: expect.exit },
      ...withEnv(stack),
    },
    ...(expect.exit === "zero"
      ? [
          {
            kind: "record" as const,
            id: `show${suffix}`,
            cwd: stack.cwd,
            argv: c.show,
            stdout: "json" as const,
            expect,
            ...withEnv(stack),
          },
        ]
      : []),
  ];
}

function apply(c: FamilyCommands, stack: TofuStack, expect: Expectation): Step {
  return {
    kind: "record",
    id: "apply",
    cwd: stack.cwd,
    argv: c.apply,
    stdout: "text",
    expect,
    ...withEnv(stack),
  };
}

const MAIN = "network/main.tf";

function edit(find: string, replace: string, file = MAIN): Step {
  return { kind: "edit", file, find, replace };
}

const NULL_RESOURCE = `resource "null_resource" "trigger" {
  triggers = {
    secret = var.secret
  }
}
`;
const OUTPUT = `output "pet" {`;

const updatedConfig = edit("    greeting = var.motd\n", '    greeting = "hi"\n');
const replacedNotes = edit(
  '  content  = "CANARY-VALUE ${var.motd}"\n',
  '  content  = "CANARY-VALUE ${var.motd}, second edition"\n',
);
const removedTrigger = edit(NULL_RESOURCE, "");
const forgottenTrigger = edit(
  NULL_RESOURCE,
  `removed {
  from = null_resource.trigger
  lifecycle {
    destroy = false
  }
}
`,
);
const movedPet = [
  edit('resource "random_pet" "name" {\n', 'resource "random_pet" "pet" {\n'),
  edit(
    "  value = random_pet.name.id\n",
    `  value = random_pet.pet.id
}

moved {
  from = random_pet.name
  to   = random_pet.pet
`,
  ),
];
const importedString = edit(
  OUTPUT,
  `resource "random_string" "imported" {
  length = 4
  lifecycle {
    ignore_changes = all
  }
}

import {
  to = random_string.imported
  id = "abcd"
}

${OUTPUT}`,
);
const addedResource = edit(
  OUTPUT,
  `resource "random_pet" "extra" {
  length = 3
}

${OUTPUT}`,
);
// A data source that reads what a pending change writes is read during the
// deploy, not the plan.
const readBack = edit(
  OUTPUT,
  `data "local_file" "readback" {
  filename   = local_file.notes.filename
  depends_on = [local_file.notes]
}

${OUTPUT}`,
);
const rotatedSecret = edit(
  '  default   = "CANARY-SECRET"\n',
  '  default   = "CANARY-SECRET-ROTATED"\n',
);
const addedOutput = edit(OUTPUT, `output "greeting" {\n  value = var.motd\n}\n\n${OUTPUT}`);

function afterDeploy(
  c: FamilyCommands,
  name: string,
  description: string,
  edits: Step[],
  expect: Expectation,
): Scenario {
  return {
    name,
    description,
    steps: [init(c, DEV), deployed(c, DEV), ...edits, ...plan(c, DEV, expect)],
  };
}

// The scenarios of the plain binary, tofu or terraform (record 0068).
export function familyScenarios(c: FamilyCommands, binary: string): Scenario[] {
  return [
    {
      name: "version",
      description: `${binary} version -json, which the version check reads.`,
      steps: [
        {
          kind: "record",
          id: "version",
          cwd: ".",
          argv: c.version,
          stdout: "json",
          expect: { exit: "zero" },
        },
      ],
    },
    {
      name: "new-stack",
      description:
        "network:dev before its first deploy: init, then a plan of all creates in the workspace dev.",
      steps: [
        {
          kind: "record",
          id: "init",
          cwd: "network",
          argv: c.init,
          stdout: "text",
          expect: { exit: "zero" },
        },
        ...plan(c, DEV, { exit: "zero", ops: ["create"] }),
      ],
    },
    {
      name: "init-failed",
      description:
        "A provider version that does not exist: init fails, so no stack of the directory can be previewed.",
      steps: [
        edit(
          'null   = { source = "hashicorp/null", version = "3.2.4" }',
          'null   = { source = "hashicorp/null", version = "99.0.0" }',
        ),
        {
          kind: "record",
          id: "init",
          cwd: "network",
          argv: c.init,
          stdout: "text",
          expect: { exit: "nonzero" },
        },
      ],
    },
    {
      name: "other-workspace",
      description:
        "network:prod, the same root module in the workspace prod with its own var file.",
      steps: [init(c, PROD), ...plan(c, PROD, { exit: "zero", ops: ["create"] })],
    },
    {
      name: "tofu-files",
      description:
        "dns, a root module of .tofu files in the default workspace, before its first deploy.",
      steps: [init(c, DNS), ...plan(c, DNS, { exit: "zero", ops: ["create"] })],
    },
    afterDeploy(c, "no-changes", "network:dev, deployed, and nothing changed.", [], {
      exit: "zero",
      ops: ["no-op"],
    }),
    afterDeploy(
      c,
      "update",
      "A new input of terraform_data, which changes it in place.",
      [updatedConfig],
      {
        exit: "zero",
        ops: ["update"],
      },
    ),
    afterDeploy(
      c,
      "replace",
      "A new content of local_file, which forces a new one.",
      [replacedNotes],
      {
        exit: "zero",
        ops: ["delete,create"],
      },
    ),
    afterDeploy(c, "delete", "null_resource taken out of the code.", [removedTrigger], {
      exit: "zero",
      ops: ["delete"],
    }),
    afterDeploy(
      c,
      "forget",
      "null_resource under a removed block with destroy = false: the record goes, the object stays.",
      [forgottenTrigger],
      { exit: "zero", ops: ["forget"] },
    ),
    afterDeploy(c, "move", "random_pet renamed with a moved block.", movedPet, {
      exit: "zero",
      ops: ["move"],
    }),
    afterDeploy(
      c,
      "import",
      "An import block for a random_string that the code then tracks.",
      [importedString],
      {
        exit: "zero",
        ops: ["import"],
      },
    ),
    afterDeploy(
      c,
      "mixed",
      "An update, a replace, a delete, a create and a data source read in one plan.",
      [updatedConfig, replacedNotes, removedTrigger, addedResource, readBack],
      { exit: "zero", ops: ["update", "delete,create", "delete", "create", "read"] },
    ),
    afterDeploy(
      c,
      "changed-secret",
      "The sensitive variable rotated: an update of terraform_data and a replace of null_resource, at sensitive paths.",
      [rotatedSecret],
      { exit: "zero", ops: ["update", "delete,create"] },
    ),
    afterDeploy(
      c,
      "outputs-only",
      "A new root output and no resource change (record 0036).",
      [addedOutput],
      {
        exit: "zero",
        ops: ["no-op"],
      },
    ),
    {
      name: "same-plan-twice",
      description:
        "The same plan of network:dev twice, to see that the order of resource_changes holds.",
      steps: [
        init(c, DEV),
        ...plan(c, DEV, { exit: "zero", ops: ["create"] }),
        ...plan(c, DEV, { exit: "zero", ops: ["create"] }, "-again"),
      ],
    },
    {
      name: "program-error",
      description:
        "A resource block that is never closed: the plan fails with diagnostics in its JSON log.",
      steps: [
        init(c, DEV),
        edit(OUTPUT, `resource "terraform_data" "broken" {\n\n${OUTPUT}`),
        ...plan(c, DEV, { exit: "nonzero" }),
      ],
    },
    {
      name: "missing-variable",
      description:
        "The var file of network:dev without the variable env: the plan cannot ask for it and fails.",
      steps: [
        init(c, DEV),
        edit('env = "dev"\n', "", "network/dev.tfvars"),
        ...plan(c, DEV, { exit: "nonzero" }),
      ],
    },
    {
      name: "deploy",
      description:
        "network:dev deployed from the plan file of its own plan, the way apply does it.",
      steps: [
        init(c, DEV),
        ...plan(c, DEV, { exit: "zero", ops: ["create"] }),
        apply(c, DEV, { exit: "zero" }),
      ],
    },
    {
      name: "deploy-failed",
      description:
        "A plan that works and a deploy that fails: a provisioner of a new resource exits with 3.",
      steps: [
        init(c, DEV),
        deployed(c, DEV),
        edit(
          OUTPUT,
          `resource "null_resource" "fails" {\n  provisioner "local-exec" {\n    command = "exit 3"\n  }\n}\n\n${OUTPUT}`,
        ),
        ...plan(c, DEV, { exit: "zero", ops: ["create"] }),
        apply(c, DEV, { exit: "nonzero" }),
      ],
    },
    {
      name: "stale-plan",
      description:
        "A saved plan, then another deploy changes the state, then the saved plan is applied: the tool refuses it as stale.",
      steps: [
        init(c, DEV),
        deployed(c, DEV),
        updatedConfig,
        ...plan(c, DEV, { exit: "zero", ops: ["update"] }),
        deployed(c, DEV),
        apply(c, DEV, { exit: "nonzero" }),
      ],
    },
    {
      name: "log-diff-changed-secret",
      description:
        "The tool's own diff of a rotated sensitive variable, for the job log (record 0048).",
      steps: [
        init(c, DEV),
        deployed(c, DEV),
        rotatedSecret,
        {
          kind: "record",
          id: "diff",
          cwd: "network",
          argv: c.diff(DEV.varFiles),
          stdout: "text",
          expect: { exit: "zero" },
          ...withEnv(DEV),
        },
      ],
    },
  ];
}

export const OPENTOFU_SCENARIOS = familyScenarios(TOFU, "tofu");

// Terraform reads no .tofu files, so the dns root module is not one of its.
export const TERRAFORM_SCENARIOS = familyScenarios(TERRAFORM, "terraform").filter(
  (scenario) => scenario.name !== "tofu-files",
);

// Built from nothing, not from the environment of whoever runs the recorder.
// Only PATH comes through, so the tool can be found. HOME points into the work
// directory, so no file of the user is read, and providers are kept in one
// cache there so that each scenario does not download them again.
export function openTofuEnvironment(options: RecordOptions): Record<string, string> {
  return {
    PATH: options.parentEnv.PATH ?? "",
    HOME: join(options.workDir, "home"),
    USER: "sluiceway",
    TF_IN_AUTOMATION: "true",
    TF_PLUGIN_CACHE_DIR: join(options.workDir, "plugin-cache"),
    NO_COLOR: "1",
  };
}

// What the recorder checks a plan for: the actions of every resource change,
// joined with a comma, and "move", "import" and "read" where a change says so.
export function openTofuOps(document: unknown): string[] {
  if (typeof document !== "object" || document === null) return [];
  const changes = (document as { resource_changes?: unknown }).resource_changes;
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change) => {
    const inner = (change as { change?: { actions?: unknown; importing?: unknown } }).change;
    const actions = Array.isArray(inner?.actions) ? inner.actions.join(",") : "";
    return [
      actions,
      ...((change as { previous_address?: unknown }).previous_address === undefined
        ? []
        : ["move"]),
      ...(inner?.importing == null ? [] : ["import"]),
    ];
  });
}
