// The scenarios examples/cdktf-basic is driven through (record 0068): cdktf
// synth writes the stacks dev and prod of the app, and tofu runs in the
// directory of one. The diff is the plan JSON the OpenTofu scenarios already
// cover op by op, so these hold what CDK for Terraform adds: the synth, and a
// stack picked by its name.
import { familyCommands, openTofuEnvironment } from "./opentofu-scenarios.ts";
import type { Expectation, RecordOptions, Scenario, Step } from "./recorder.ts";

// The command lines are the ones the adapter runs (src/adapters/opentofu/).
export const CDKTF = {
  ...familyCommands(["tofu"]),
  synth: ["cdktf", "synth", "--output", "cdktf.out"],
  version: ["cdktf", "--version"],
};

const DEV = "cdktf.out/stacks/dev";
const PROD = "cdktf.out/stacks/prod";
const MAIN = "main.js";

const synth: Step = { kind: "setup", cwd: ".", argv: CDKTF.synth };
const init = (cwd: string): Step => ({ kind: "setup", cwd, argv: CDKTF.init });
const deployed: Step = { kind: "setup", cwd: DEV, argv: CDKTF.deploy([]) };

function plan(cwd: string, expect: Expectation): Step[] {
  return [
    {
      kind: "record",
      id: "plan",
      cwd,
      argv: CDKTF.plan([]),
      stdout: "text",
      expect: { exit: expect.exit },
    },
    {
      kind: "record",
      id: "show",
      cwd,
      argv: CDKTF.show,
      stdout: "json",
      expect,
    },
  ];
}

function edit(find: string, replace: string): Step {
  return { kind: "edit", file: MAIN, find, replace };
}

export const CDKTF_SCENARIOS: Scenario[] = [
  {
    name: "version",
    description: "cdktf --version, which the version check reads.",
    steps: [
      {
        kind: "record",
        id: "version",
        cwd: ".",
        argv: CDKTF.version,
        stdout: "text",
        expect: { exit: "zero" },
      },
    ],
  },
  {
    name: "new-stack",
    description:
      "The stack dev before its first deploy: synth, init in its directory, then a plan of all creates.",
    steps: [
      {
        kind: "record",
        id: "synth",
        cwd: ".",
        argv: CDKTF.synth,
        stdout: "text",
        expect: { exit: "zero" },
      },
      {
        kind: "record",
        id: "init",
        cwd: DEV,
        argv: CDKTF.init,
        stdout: "text",
        expect: { exit: "zero" },
      },
      ...plan(DEV, { exit: "zero", ops: ["create"] }),
    ],
  },
  {
    name: "other-stack",
    description: "The stack prod of the same app, in its own directory, with its own state.",
    steps: [synth, init(PROD), ...plan(PROD, { exit: "zero", ops: ["create"] })],
  },
  {
    name: "program-error",
    description: "An app that throws: synth fails, so no stack of the app can be previewed.",
    steps: [
      edit("const app = new App();\n", 'throw new Error("broken");\n'),
      {
        kind: "record",
        id: "synth",
        cwd: ".",
        argv: CDKTF.synth,
        stdout: "text",
        expect: { exit: "nonzero" },
      },
    ],
  },
  {
    name: "no-changes",
    description: "The stack dev, deployed, and nothing changed.",
    steps: [synth, init(DEV), deployed, ...plan(DEV, { exit: "zero", ops: ["no-op"] })],
  },
  {
    name: "update",
    description: "A new input of terraform_data in the app, synthesized again: an update in place.",
    steps: [
      synth,
      init(DEV),
      deployed,
      edit('new Notes(app, "dev", "hello");\n', 'new Notes(app, "dev", "hi");\n'),
      synth,
      ...plan(DEV, { exit: "zero", ops: ["update"] }),
    ],
  },
  {
    name: "deploy",
    description:
      "The stack dev deployed from the plan file of its own plan, the way apply does it.",
    steps: [
      synth,
      init(DEV),
      ...plan(DEV, { exit: "zero", ops: ["create"] }),
      {
        kind: "record",
        id: "apply",
        cwd: DEV,
        argv: CDKTF.apply,
        stdout: "text",
        expect: { exit: "zero" },
      },
    ],
  },
];

// The OpenTofu environment, and no update check or telemetry from cdktf in
// a recording (cdktf docs, "Telemetry").
export function cdktfEnvironment(options: RecordOptions): Record<string, string> {
  return { ...openTofuEnvironment(options), CHECKPOINT_DISABLE: "1" };
}
