import { describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tools } from "../../src/adapters/tools.ts";
import { check } from "../../src/modes/check.ts";
import { init } from "../../src/modes/init.ts";
import { NOTHING_MISSING } from "../../src/render/check.ts";
import { HELM_STEPS, OPENTOFU_STEPS } from "../../src/render/init.ts";
import { isSluiceway, modeOf, ROOT, read, type Workflow } from "../docs/docs.ts";
import { rememberingLog } from "./harness.ts";

// Slice 4.14 (record 0065): init writes a starter workflow and a
// sluiceway.yaml from what it finds in the repo's files, as files in the
// checkout, and prints what it wrote and what still needs a person.

type Files = Record<string, string>;

const WORKFLOW = ".github/workflows/deploy-dashboard.yml";
const CONFIG = "sluiceway.yaml";

// A checkout: the root of a git repo.
function repo(files: Files = {}, examples: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-init-"));
  mkdirSync(join(root, ".git"));
  for (const [into, example] of Object.entries(examples)) {
    cpSync(join(ROOT, "examples", example), join(root, into), { recursive: true });
  }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

// An example project as the root of its own repo, without the config file it
// ships with, which is what init writes.
function example(name: string, files: Files = {}): string {
  const root = repo({}, { ".": name });
  rmSync(join(root, CONFIG), { force: true });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

async function run(root: string) {
  const log = rememberingLog();
  const error = await init({ root, adapter: tools, log }).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  const read = (file: string) =>
    existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : undefined;
  return { log, error, workflow: read(WORKFLOW), config: read(CONFIG), text: log.lines.join("\n") };
}

// What the check says of the repo after init: no warning, a valid setup.
async function checked(root: string) {
  const log = rememberingLog();
  await check({ root, adapter: tools, log });
  return log;
}

describe("the Pulumi example", () => {
  test("gets a workflow and a config that the check finds nothing missing in", async () => {
    const root = example("pulumi-basic");
    const { error, workflow, config } = await run(root);
    expect(error).toBeUndefined();
    expect(workflow).toBeDefined();
    expect(config).toBeDefined();
    const log = await checked(root);
    expect(log.warnings).toEqual([]);
    expect(log.lines).toContain(NOTHING_MISSING);
  });
});

// The whole of what init writes and prints, one repo per setup the slice names.
describe("what init writes, whole", () => {
  test.each([
    ["the Pulumi example", () => example("pulumi-basic")],
    ["the OpenTofu example", () => example("opentofu-basic")],
    ["the Helm example", () => example("helm-basic")],
    [
      "the three examples in one repo",
      () => {
        const root = repo(
          {},
          { pulumi: "pulumi-basic", tofu: "opentofu-basic", helm: "helm-basic" },
        );
        // Only the root's config counts, and init writes that one.
        for (const dir of ["pulumi", "tofu", "helm"]) rmSync(join(root, dir, CONFIG));
        return root;
      },
    ],
  ])("%s", async (_, make) => {
    const root = make();
    const { error, workflow, config, log } = await run(root);
    expect(error).toBeUndefined();
    expect({ workflow, config, lines: log.lines, groups: log.groups }).toMatchSnapshot();
    const checkLog = await checked(root);
    expect(checkLog.warnings).toEqual([]);
    expect(checkLog.lines).toContain(NOTHING_MISSING);
  });
});

describe("init writes nothing", () => {
  test("in a repo with no stack of any tool, and says so", async () => {
    const root = repo({ "README.md": "# docs\n", "src/index.ts": "" });
    const { error, workflow, config } = await run(root);
    expect(String(error)).toContain(
      "init found no stack to set up: no Pulumi project, no OpenTofu root module and no Helm chart. It wrote nothing.",
    );
    expect(workflow).toBeUndefined();
    expect(config).toBeUndefined();
  });

  test("when the workflow is there already, and leaves it as it is", async () => {
    const root = example("pulumi-basic", { [WORKFLOW]: "name: mine\n" });
    const { error, workflow, config } = await run(root);
    expect(String(error)).toContain(
      "A workflow runs Sluiceway already: .github/workflows/deploy-dashboard.yml. init never overwrites one, and wrote nothing.",
    );
    expect(workflow).toBe("name: mine\n");
    expect(config).toBeUndefined();
  });

  test("when another workflow file runs Sluiceway already", async () => {
    const existing = [
      "on: push",
      "jobs:",
      "  scan:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: sluiceway/sluiceway@v0",
      "        with:",
      "          mode: scan",
      "",
    ].join("\n");
    const root = example("pulumi-basic", { ".github/workflows/dashboard.yml": existing });
    const { error, workflow } = await run(root);
    expect(String(error)).toContain(
      "A workflow runs Sluiceway already: .github/workflows/dashboard.yml.",
    );
    expect(workflow).toBeUndefined();
  });

  test("outside the root of a git repo", async () => {
    const root = example("pulumi-basic");
    rmSync(join(root, ".git"), { recursive: true });
    const { error, workflow } = await run(root);
    expect(String(error)).toContain("This is not the root of a git repo.");
    expect(workflow).toBeUndefined();
  });

  test("when sluiceway.yaml is not valid, with the message a scan gives", async () => {
    const root = example("pulumi-basic", { [CONFIG]: "tickers: [some/team]\n" });
    const { error, workflow } = await run(root);
    expect(String(error)).toContain("Teams are not supported yet");
    expect(workflow).toBeUndefined();
  });
});

describe("a check workflow", () => {
  test("is not a workflow that runs Sluiceway's loop, so init goes ahead", async () => {
    const check = [
      "on: pull_request",
      "permissions:",
      "  contents: read",
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: sluiceway/sluiceway@v0",
      "        with:",
      "          mode: check",
      "",
    ].join("\n");
    const root = example("pulumi-basic", {
      ".github/workflows/deploy-dashboard-check.yml": check,
    });
    const { error, workflow } = await run(root);
    expect(error).toBeUndefined();
    expect(workflow).toBeDefined();
  });
});

describe("a sluiceway.yaml that is there", () => {
  test("is kept as it is, and the workflow follows its label", async () => {
    const own = ["dashboard:", "  label: infra-dashboard", 'ignore: ["playground:*"]', ""].join(
      "\n",
    );
    const root = example("pulumi-basic", { [CONFIG]: own });
    const { error, workflow, config, text } = await run(root);
    expect(error).toBeUndefined();
    expect(config).toBe(own);
    expect(text).toContain("Kept sluiceway.yaml as it is, and set the workflow up from it.");
    expect(text).not.toContain("Wrote sluiceway.yaml.");
    expect(workflow).toContain("contains(github.event.issue.labels.*.name, 'infra-dashboard')");
    expect((await checked(root)).warnings).toEqual([]);
  });

  test("with merge and deploy gives the workflow contents: write", async () => {
    const own = "mergeAndDeploy:\n  authors: [renovate]\n";
    const root = example("pulumi-basic", { [CONFIG]: own });
    const { workflow } = await run(root);
    expect(workflow).toContain("  contents: write\n");
    expect((await checked(root)).warnings).toEqual([]);
  });

  test("declares the OpenTofu stacks, so init adds none of its own", async () => {
    const root = example("opentofu-basic", {
      [CONFIG]: "stacks:\n  - path: dns\n    tool: opentofu\n",
    });
    const { error, workflow, log } = await run(root);
    expect(error).toBeUndefined();
    expect(log.groups[0]?.lines).toEqual(["dns"]);
    expect(workflow).toContain("opentofu/setup-opentofu");
  });
});

describe("the default branch", () => {
  test("comes from the clone's record of the remote's HEAD", async () => {
    const root = example("pulumi-basic", {
      ".git/refs/remotes/origin/HEAD": "ref: refs/remotes/origin/trunk\n",
    });
    const { workflow, text, log } = await run(root);
    expect(workflow).toContain("    branches: [trunk]\n");
    expect(log.groups.flatMap((group) => group.lines).join("\n")).not.toContain(
      "could not read the default branch",
    );
    expect(text).toContain("Wrote");
  });
});

describe("an env file of secret references", () => {
  const PREVIEW = "PULUMI_ACCESS_TOKEN=op://ci/pulumi-read/token\nREGION=eu-west-1\n";
  const DEPLOY = "PULUMI_ACCESS_TOKEN=op://ci/pulumi-deploy/token\n";

  test("is loaded the way the secret manager example does it, with its script", async () => {
    const root = example("pulumi-basic", { "ci/preview.env": PREVIEW, "ci/deploy.env": DEPLOY });
    const { error, workflow, log, text } = await run(root);
    expect(error).toBeUndefined();
    expect(workflow).toContain(
      "        run: op run --env-file=ci/preview.env --no-masking -- bash .github/scripts/export-env.sh ci/preview.env\n",
    );
    expect(workflow).toContain(
      "        run: op run --env-file=ci/deploy.env --no-masking -- bash .github/scripts/export-env.sh ci/deploy.env\n",
    );
    expect(workflow).toContain("OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_PREVIEW_TOKEN }}");
    expect(workflow).toContain("OP_SERVICE_ACCOUNT_TOKEN: ${{ secrets.OP_DEPLOY_TOKEN }}");
    expect(readFileSync(join(root, ".github/scripts/export-env.sh"), "utf8")).toBe(
      readFileSync(join(ROOT, "examples/workflows/export-env.sh"), "utf8"),
    );
    expect(text).toContain("Wrote .github/scripts/export-env.sh.");
    expect(log.groups[1]?.lines[0]).toContain("Create the secret OP_PREVIEW_TOKEN");
    expect((await checked(root)).warnings).toEqual([]);
  });

  test("serves both jobs when it is the only one, and init says so", async () => {
    const root = example("pulumi-basic", { ".env": PREVIEW });
    const { workflow, log } = await run(root);
    expect(workflow).toContain("--env-file=.env ");
    expect(log.groups[1]?.lines.join("\n")).toContain(
      "Both jobs load .env. The scan needs credentials that read and nothing more",
    );
  });

  test("with plain values only is not one, and no credential step is written", async () => {
    const root = example("pulumi-basic", { ".env": "REGION=eu-west-1\n" });
    const { workflow } = await run(root);
    expect(workflow).not.toContain("op run");
    expect(workflow).toContain("# Load your credentials and your state backend settings");
    expect(existsSync(join(root, ".github/scripts/export-env.sh"))).toBe(false);
  });
});

describe("the programs' packages", () => {
  const pulumi = (runtime: string) => `name: app\nruntime: ${runtime}\n`;

  test("pnpm at the root installs once there, with its setup action", async () => {
    const root = repo({
      "package.json": '{ "packageManager": "pnpm@10.1.0" }',
      "pnpm-lock.yaml": "",
      "infra/a/Pulumi.yaml": pulumi("nodejs"),
      "infra/a/Pulumi.dev.yaml": "",
      "infra/b/Pulumi.yaml": pulumi("nodejs"),
      "infra/b/Pulumi.dev.yaml": "",
      ".nvmrc": "24\n",
    });
    const { workflow, log } = await run(root);
    expect(workflow).toContain(
      [
        "      - uses: pnpm/action-setup@v6",
        "      - uses: actions/setup-node@v7",
        "        with:",
        "          node-version-file: .nvmrc",
        "          cache: pnpm",
        "      # Once for every program in the repo, not once per stack.",
        "      - run: pnpm install --frozen-lockfile",
        "      - uses: pulumi/actions@v7",
      ].join("\n"),
    );
    expect(workflow).toContain("hashFiles('**/pnpm-lock.yaml')");
    expect(log.groups[1]?.lines.join("\n")).not.toContain("pnpm/action-setup reads");
  });

  test("a Node program with no lockfile is left to the person", async () => {
    const root = repo({ "app/Pulumi.yaml": pulumi("nodejs"), "app/Pulumi.dev.yaml": "" });
    const { workflow, log } = await run(root);
    expect(workflow).not.toContain("npm ci");
    expect(log.groups[1]?.lines.join("\n")).toContain(
      "No lockfile for the Node programs in app: add one",
    );
  });

  test("a Python program gets its packages with pulumi install", async () => {
    const root = repo({
      "app/Pulumi.yaml": "name: app\nruntime:\n  name: python\n",
      "app/Pulumi.dev.yaml": "",
    });
    const { workflow, log } = await run(root);
    expect(workflow).toContain("      - run: pulumi install\n        working-directory: app\n");
    expect(workflow).not.toContain("setup-node");
    expect(log.groups[1]?.lines.join("\n")).toContain("The python programs run on the python");
  });
});

describe("OpenTofu root modules", () => {
  test("leave out a module another directory calls, and anything under modules/", async () => {
    const root = repo({
      "live/main.tf": 'module "net" {\n  source = "../net"\n}\n',
      "net/main.tf": "",
      "modules/vpc/main.tf": "",
      "live/terraform.tfvars": "",
      "live/prod.auto.tfvars": "",
    });
    const { config, log } = await run(root);
    expect(log.groups[0]?.lines).toEqual(["live"]);
    expect(config).toContain("  - path: live\n    tool: opentofu\n");
    expect(config).not.toContain("varFiles");
  });

  test("with one var file is one stack that passes it", async () => {
    const root = repo({ "infra/main.tofu": "", "infra/prod.tfvars": "" });
    const { config } = await run(root);
    expect(config).toContain(
      "  - path: infra\n    tool: opentofu\n    options:\n      varFiles: [prod.tfvars]\n",
    );
  });
});

describe("Helm charts", () => {
  test("leave out subcharts and library charts, and add the repositories of dependencies", async () => {
    const root = repo({
      "deploy/app/Chart.yaml": [
        "apiVersion: v2",
        "name: My_App",
        "version: 1.0.0",
        "dependencies:",
        "  - name: redis",
        "    version: 1.0.0",
        "    repository: https://charts.example.com/stable",
        "  - name: sub",
        "    version: 1.0.0",
        "    repository: file://charts/sub",
        "",
      ].join("\n"),
      "deploy/app/charts/sub/Chart.yaml": "apiVersion: v2\nname: sub\nversion: 1.0.0\n",
      "deploy/lib/Chart.yaml": "apiVersion: v2\nname: lib\ntype: library\nversion: 1.0.0\n",
    });
    const { config, workflow, log } = await run(root);
    expect(log.groups[0]?.lines).toEqual(["deploy/app"]);
    expect(config).toContain("      release: my-app\n      namespace: my-app\n");
    expect(workflow).toContain(
      "        run: |\n          helm repo add dependency-1 https://charts.example.com/stable\n",
    );
  });
});

// The steps init writes are the ones the docs explain, so neither drifts.
describe("the tool steps", () => {
  const credentials = read("docs/credentials.md");
  const asInDocs = (steps: string[]) => steps.map((line) => line.slice(6)).join("\n");

  test.each([
    ["OpenTofu", OPENTOFU_STEPS],
    ["Helm", HELM_STEPS],
  ])("of %s are the ones docs/credentials.md shows", (_, steps) => {
    expect(credentials).toContain(asInDocs(steps));
  });
});

// The wiring the docs tests hold every shipped workflow to (slice 2.10),
// on the workflow init writes for the three examples in one repo.
describe("the workflow init writes", () => {
  test("is wired like the workflows of the docs", async () => {
    const root = repo(
      { ".env": "TOKEN=op://vault/item/field\n" },
      {
        pulumi: "pulumi-basic",
        tofu: "opentofu-basic",
        helm: "helm-basic",
      },
    );
    for (const dir of ["pulumi", "tofu", "helm"]) rmSync(join(root, dir, CONFIG));
    const { workflow: text } = await run(root);
    const workflow = Bun.YAML.parse(text ?? "") as Workflow;
    const byMode = (mode: string) =>
      Object.values(workflow.jobs).find((job) => modeOf(job) === mode);
    expect(Object.values(workflow.jobs).map(modeOf)).toEqual([
      "scan",
      "resolve",
      "apply",
      "settle",
    ]);
    expect(byMode("scan")?.concurrency).toBe("sluiceway-scan");
    expect(byMode("resolve")?.concurrency).toBe("sluiceway-resolve");
    expect(byMode("apply")?.if).toContain("!cancelled()");
    expect(byMode("apply")?.concurrency).toEqual({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub expression, not a template.
      group: "sluiceway-apply-${{ matrix.stack }}",
      queue: "max",
    });
    // Record 0014, promise 4: the job an issue edit starts holds no credentials.
    for (const mode of ["resolve", "settle"]) {
      expect(byMode(mode)?.steps.map((step) => step.uses?.split("@")[0])).toEqual([
        "actions/checkout",
        "sluiceway/sluiceway",
      ]);
    }
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps.filter(isSluiceway));
    expect(new Set(steps.map((step) => step.uses))).toEqual(new Set(["sluiceway/sluiceway@v0"]));
    expect(text).not.toContain("event.changes");
    expect(text).not.toContain("github-token");
  });
});
