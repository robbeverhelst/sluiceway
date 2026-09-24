// The scenarios of the cost estimate (record 0105): tofu plans a root module
// of the AWS provider in a copy of examples/opentofu-basic, its plan is shown
// as JSON next to the plan file, the way the adapter writes it, and the
// Infracost CLI reads that JSON against the fake pricing API of
// fake-pricing-api.ts. The AWS provider plans without an account: its
// credentials are made up and every check that would call AWS is skipped,
// and a plan with -refresh=false reads nothing real. A state a scenario
// writes into the copy is the scenario's own input, as an edit of main.tf
// is; what is recorded is what the tools printed.
import { join } from "node:path";
import { FAKE_PRICING_ENDPOINT, REFUSING_PRICING_ENDPOINT } from "./fake-pricing-api.ts";
import { openTofuEnvironment, TOFU } from "./opentofu-scenarios.ts";
import { PLAN_DIR, type RecordOptions, type Scenario, type Step } from "./recorder.ts";

// The plan's JSON, next to the plan file, and the command line the adapter
// runs on it (src/adapters/opentofu/cost.ts), in the plan's directory.
export const PLAN_JSON = "plan.json";
export const INFRACOST_DIFF = [
  "infracost",
  "diff",
  "--path",
  PLAN_JSON,
  "--format",
  "json",
  "--no-color",
];

const COMPUTE = "compute";

const PROVIDER = `terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "6.9.0" }
  }
}

# No account: made-up credentials, every check that would call AWS skipped.
provider "aws" {
  region                      = "eu-west-1"
  access_key                  = "recorded"
  secret_key                  = "recorded"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  skip_region_validation      = true
}
`;

function instance(volumeSize: number): string {
  return `${PROVIDER}
resource "aws_instance" "web" {
  ami           = "ami-0123456789abcdef0"
  instance_type = "t3.micro"
  root_block_device {
    volume_size = ${volumeSize}
  }
}
`;
}

// A state of the local backend that holds the instance as deployed with a
// root volume of this size, in the shape tofu 1.12 writes, with the
// attributes the provider's plan reads.
function state(volumeSize: number): string {
  return `${JSON.stringify(
    {
      version: 4,
      terraform_version: "1.12.6",
      serial: 1,
      lineage: "5d2c0a6e-0000-4000-8000-000000000001",
      outputs: {},
      resources: [
        {
          mode: "managed",
          type: "aws_instance",
          name: "web",
          provider: 'provider["registry.opentofu.org/hashicorp/aws"]',
          instances: [
            {
              schema_version: 1,
              attributes: {
                id: "i-0123456789abcdef0",
                ami: "ami-0123456789abcdef0",
                instance_type: "t3.micro",
                root_block_device: [
                  {
                    volume_size: volumeSize,
                    volume_type: "gp2",
                    delete_on_termination: true,
                    encrypted: false,
                    iops: 100,
                    throughput: 0,
                    tags: {},
                    tags_all: {},
                    device_name: "/dev/sda1",
                    kms_key_id: "",
                    volume_id: "vol-0123456789abcdef0",
                  },
                ],
              },
              sensitive_attributes: [],
            },
          ],
        },
      ],
      check_results: null,
    },
    null,
    2,
  )}\n`;
}

function planned(cwd: string, varFiles: string[], env?: Record<string, string>): Step[] {
  const withEnv = env === undefined ? {} : { env };
  return [
    { kind: "setup", cwd, argv: TOFU.init },
    {
      kind: "record",
      id: "plan",
      cwd,
      argv: TOFU.plan(varFiles),
      stdout: "text",
      expect: { exit: "zero" },
      ...withEnv,
    },
    {
      kind: "record",
      id: "show",
      cwd,
      argv: TOFU.show,
      stdout: "json",
      expect: { exit: "zero" },
      stdoutBesidePlan: PLAN_JSON,
      ...withEnv,
    },
  ];
}

function estimated(expect: { exit: "zero" | "nonzero" }, env?: Record<string, string>): Step {
  return {
    kind: "record",
    id: "diff",
    cwd: PLAN_DIR,
    argv: INFRACOST_DIFF,
    stdout: expect.exit === "zero" ? "json" : "text",
    expect,
    ...(env === undefined ? {} : { env }),
  };
}

const MAIN = join(COMPUTE, "main.tf");
const STATE = join(COMPUTE, "terraform.tfstate");

export const INFRACOST_SCENARIOS: Scenario[] = [
  {
    name: "create",
    description:
      "A new aws_instance with a root volume of 20 GB: the change costs an instance's hours and the volume a month.",
    steps: [
      { kind: "write", file: MAIN, content: instance(20) },
      ...planned(COMPUTE, []),
      estimated({ exit: "zero" }),
    ],
  },
  {
    name: "update",
    description:
      "The root volume of a deployed aws_instance grown from 20 to 40 GB, an update in place: the change costs the 20 GB more a month.",
    steps: [
      { kind: "write", file: MAIN, content: instance(40) },
      { kind: "write", file: STATE, content: state(20) },
      ...planned(COMPUTE, []),
      estimated({ exit: "zero" }),
    ],
  },
  {
    name: "delete",
    description:
      "A deployed aws_instance taken out of the code: the change saves what it cost a month.",
    steps: [
      { kind: "write", file: MAIN, content: PROVIDER },
      { kind: "write", file: STATE, content: state(20) },
      ...planned(COMPUTE, []),
      estimated({ exit: "zero" }),
    ],
  },
  {
    name: "free",
    description:
      "network:dev before its first deploy: creates of resources the pricing API has no price for, so the change costs about the same.",
    steps: [
      ...planned("network", ["dev.tfvars"], { TF_WORKSPACE: "dev" }),
      estimated({ exit: "zero" }),
    ],
  },
  {
    name: "refused",
    description: "The pricing API refuses the key: the CLI exits with 1 and prints why to stderr.",
    steps: [
      { kind: "write", file: MAIN, content: instance(20) },
      ...planned(COMPUTE, []),
      estimated({ exit: "nonzero" }, { INFRACOST_PRICING_API_ENDPOINT: REFUSING_PRICING_ENDPOINT }),
    ],
  },
  {
    name: "unreachable",
    description:
      "The pricing API cannot be reached: the CLI exits with 0 and its JSON says, as data, that the plan was not priced.",
    steps: [
      { kind: "write", file: MAIN, content: instance(20) },
      ...planned(COMPUTE, []),
      estimated({ exit: "zero" }, { INFRACOST_PRICING_API_ENDPOINT: "http://127.0.0.1:9" }),
    ],
  },
];

// The tofu environment of the recorder, with the CLI pointed at the fake
// pricing API and the settings the adapter sets (record 0105).
export function infracostEnvironment(options: RecordOptions): Record<string, string> {
  return {
    ...openTofuEnvironment(options),
    INFRACOST_API_KEY: "ico-recorded",
    INFRACOST_PRICING_API_ENDPOINT: FAKE_PRICING_ENDPOINT,
    INFRACOST_SKIP_UPDATE_CHECK: "true",
    INFRACOST_ENABLE_CLOUD: "false",
  };
}
