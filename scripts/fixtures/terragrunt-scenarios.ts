// The scenarios examples/terragrunt-basic is driven through (record 0068):
// one Terragrunt unit, live/dev, behind which tofu runs. The diff is the
// plan JSON the OpenTofu scenarios already cover op by op, so these hold what
// Terragrunt adds: its command line, its cache directory and its words.

import { familyCommands } from "./opentofu-scenarios.ts";
import type { Expectation, Scenario, Step } from "./recorder.ts";

// The command lines are the ones the adapter runs (src/adapters/opentofu/).
export const TERRAGRUNT = {
  ...familyCommands([
    "terragrunt",
    "run",
    "--tf-forward-stdout",
    "--no-color",
    "--no-auto-init",
    "--tf-path",
    "tofu",
    "--",
  ]),
  version: ["terragrunt", "--version"],
};

const UNIT = "live/dev";
const MODULE = "modules/notes/main.tf";

const init: Step = { kind: "setup", cwd: UNIT, argv: TERRAGRUNT.init };
const deployed: Step = { kind: "setup", cwd: UNIT, argv: TERRAGRUNT.deploy([]) };

function plan(expect: Expectation): Step[] {
  return [
    {
      kind: "record",
      id: "plan",
      cwd: UNIT,
      argv: TERRAGRUNT.plan([]),
      stdout: "text",
      expect: { exit: expect.exit },
    },
    ...(expect.exit === "zero"
      ? [
          {
            kind: "record" as const,
            id: "show",
            cwd: UNIT,
            argv: TERRAGRUNT.show,
            stdout: "json" as const,
            expect,
          },
        ]
      : []),
  ];
}

function edit(find: string, replace: string, file = MODULE): Step {
  return { kind: "edit", file, find, replace };
}

const rotatedSecret = edit(
  '  default   = "CANARY-SECRET"\n',
  '  default   = "CANARY-SECRET-ROTATED"\n',
);

export const TERRAGRUNT_SCENARIOS: Scenario[] = [
  {
    name: "version",
    description: "terragrunt --version, which the version check reads.",
    steps: [
      {
        kind: "record",
        id: "version",
        cwd: ".",
        argv: TERRAGRUNT.version,
        stdout: "text",
        expect: { exit: "zero" },
      },
    ],
  },
  {
    name: "new-stack",
    description:
      "live/dev before its first deploy: init through terragrunt, then a plan of all creates.",
    steps: [
      {
        kind: "record",
        id: "init",
        cwd: UNIT,
        argv: TERRAGRUNT.init,
        stdout: "text",
        expect: { exit: "zero" },
      },
      ...plan({ exit: "zero", ops: ["create"] }),
    ],
  },
  {
    name: "init-failed",
    description: "A provider version that does not exist: init through terragrunt fails.",
    steps: [
      edit(
        'random = { source = "hashicorp/random", version = "3.7.2" }',
        'random = { source = "hashicorp/random", version = "99.0.0" }',
      ),
      {
        kind: "record",
        id: "init",
        cwd: UNIT,
        argv: TERRAGRUNT.init,
        stdout: "text",
        expect: { exit: "nonzero" },
      },
    ],
  },
  {
    name: "no-changes",
    description: "live/dev, deployed, and nothing changed.",
    steps: [init, deployed, ...plan({ exit: "zero", ops: ["no-op"] })],
  },
  {
    name: "update",
    description: "A new input in the unit's terragrunt.hcl, which changes terraform_data in place.",
    steps: [
      init,
      deployed,
      edit('  motd = "hello"\n', '  motd = "hi"\n', `${UNIT}/terragrunt.hcl`),
      ...plan({ exit: "zero", ops: ["update"] }),
    ],
  },
  {
    name: "program-error",
    description: "A resource block that is never closed: the plan through terragrunt fails.",
    steps: [
      init,
      edit('output "pet" {', 'resource "terraform_data" "broken" {\n\noutput "pet" {'),
      ...plan({ exit: "nonzero" }),
    ],
  },
  {
    name: "deploy",
    description: "live/dev deployed from the plan file of its own plan, the way apply does it.",
    steps: [
      init,
      ...plan({ exit: "zero", ops: ["create"] }),
      {
        kind: "record",
        id: "apply",
        cwd: UNIT,
        argv: TERRAGRUNT.apply,
        stdout: "text",
        expect: { exit: "zero" },
      },
    ],
  },
  {
    name: "log-diff-changed-secret",
    description:
      "The tool's own diff through terragrunt of a rotated sensitive variable (record 0048).",
    steps: [
      init,
      deployed,
      rotatedSecret,
      {
        kind: "record",
        id: "diff",
        cwd: UNIT,
        argv: TERRAGRUNT.diff([]),
        stdout: "text",
        expect: { exit: "zero" },
      },
    ],
  },
];
