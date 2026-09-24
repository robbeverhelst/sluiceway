import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tools } from "../../src/adapters/tools.ts";
import { ConfigError } from "../../src/core/config.ts";
import { DiscoveryError } from "../../src/core/discovery.ts";
import { check } from "../../src/modes/check.ts";
import { escapeText } from "../../src/render/escape.ts";
import { fences, read } from "../docs/docs.ts";
import { rememberingLog } from "./harness.ts";

type Files = Record<string, string>;

function repo(files: Files): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-check-"));
  for (const [file, text] of Object.entries(files)) {
    if (text === undefined) continue;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const project = (name: string) => `name: ${name}\nruntime: yaml\n`;

// A small repo with the mistakes the check is for: a glob that names a
// directory, files that no stack claims, and a stack that reads a shared
// directory through inputs.
const FIXTURE: Files = {
  "sluiceway.yaml": [
    "tickers: maintain",
    "ignore:",
    "  - playground",
    '  - "**/*:dev"',
    "stacks:",
    "  - path: app",
    '    inputs: ["shared/**"]',
    "    tickers: [alice, bob]",
    "  - path: network",
    "    name: prod",
    "    environment: production",
    "",
  ].join("\n"),
  "README.md": "",
  LICENSE: "",
  "package.json": "{}",
  ".github/workflows/deploy-dashboard.yml": "",
  "docs/setup.md": "",
  "docs/diagram.png": "",
  "network/Pulumi.yaml": project("network"),
  "network/Pulumi.dev.yaml": "",
  "network/Pulumi.prod.yaml": "",
  "app/Pulumi.yaml": project("app"),
  "app/Pulumi.prod.yaml": "",
  "shared/settings.json": "{}",
  "playground/Pulumi.yaml": project("playground"),
  "playground/Pulumi.dev.yaml": "",
  "packages/lib/index.ts": "",
};

async function run(files: Files) {
  const log = rememberingLog();
  const result = await check({ root: repo(files), adapter: tools, log }).then(
    () => undefined,
    (error: unknown) => error,
  );
  return { log, error: result, summary: log.summaries.at(-1) ?? "" };
}

// Record 0053: OpenTofu stacks are the roots a `stacks` entry names with
// `tool: opentofu`, and the check lists them next to the Pulumi stacks.
describe("a repo with OpenTofu roots", () => {
  const files: Files = {
    ...FIXTURE,
    "sluiceway.yaml": [
      "ignore:",
      "  - playground:*",
      "stacks:",
      "  - path: infra/network",
      "    name: prod",
      "    tool: opentofu",
      "    options:",
      "      workspace: prod",
      "      varFiles: [prod.tfvars]",
      "  - path: infra/dns",
      "    tool: opentofu",
      "",
    ].join("\n"),
    "infra/network/main.tf": "",
    "infra/network/prod.tfvars": "",
    "infra/dns/main.tofu": "",
    "infra/modules/vpc/main.tf": "",
  };

  test("lists every configured root as a stack, and a module no entry names as a file", async () => {
    const { log, error } = await run(files);
    expect(error).toBeUndefined();
    expect(log.lines).toContain("Found 5 stacks.");
    expect(log.groups.find((group) => group.title === "Stacks")?.lines).toEqual([
      "app:prod: environment sluiceway, tickers write, no inputs",
      "infra/dns: environment sluiceway, tickers write, no inputs",
      "infra/network:prod: environment sluiceway, tickers write, no inputs",
      "network:dev: environment sluiceway, tickers write, no inputs",
      "network:prod: environment sluiceway, tickers write, no inputs",
    ]);
    expect(
      log.groups.find((group) => group.title === "Files that no stack claims")?.lines,
    ).toContain("infra/modules/vpc/main.tf");
  });

  test("a root with a var file that is not there fails the check", async () => {
    const { error, summary } = await run({
      ...files,
      "infra/network/prod.tfvars": undefined as never,
    });
    expect(error).toBeInstanceOf(DiscoveryError);
    expect(summary).toContain(
      escapeText('stacks[0].options.varFiles[0]: "prod.tfvars" is not a file in "infra/network".'),
    );
  });

  test("an unknown option fails the check as a config problem", async () => {
    const { error, summary } = await run({
      ...files,
      "sluiceway.yaml":
        "stacks:\n  - path: infra/dns\n    tool: opentofu\n    options: { refresh: true }\n",
    });
    expect(error).toBeInstanceOf(ConfigError);
    expect(summary).toContain(
      escapeText(
        'stacks[0].options: unknown option "refresh". Known options for opentofu: workspace, varFiles, wrapper.',
      ),
    );
  });
});

describe("a valid setup", () => {
  test("the summary", async () => {
    const { error, summary } = await run(FIXTURE);
    expect(error).toBeUndefined();
    expect(summary).toMatchSnapshot();
  });

  test("the job log lists every stack with its settings", async () => {
    const { log } = await run(FIXTURE);
    expect(log.lines).toContain("Found 2 stacks.");
    expect(log.groups.find((group) => group.title === "Stacks")?.lines).toEqual([
      "app:prod: environment sluiceway, tickers alice, bob, inputs shared/**",
      "network:prod: environment production, tickers maintain, no inputs",
    ]);
  });

  // Slice 4.7 (record 0059): the check lists what each stack depends on, the
  // ids the file names and auto, which a scan reads at each preview.
  test("lists dependsOn, in the job log and as a column of the summary", async () => {
    const files = {
      ...FIXTURE,
      "sluiceway.yaml": `${FIXTURE["sluiceway.yaml"]}    dependsOn: auto\n  - path: app\n    name: prod\n    dependsOn: [network:prod]\n`,
    };
    const { error, log, summary } = await run(files);
    expect(error).toBeUndefined();
    expect(log.groups.find((group) => group.title === "Stacks")?.lines).toEqual([
      "app:prod: environment sluiceway, tickers alice, bob, inputs shared/**, depends on network:prod",
      "network:prod: environment production, tickers maintain, no inputs, depends on the stacks its stack references name, read at each preview (auto)",
    ]);
    expect(summary).toContain("| Stack | Environment | Tickers | Inputs | Depends on |");
    expect(summary).toContain(
      "| app:prod | sluiceway | alice, bob | shared/&#42;&#42; | network:prod |",
    );
    expect(summary).toContain(
      "| network:prod | production | maintain | none | auto: its stack references, read at each preview |",
    );
  });

  // Slice 4.16 (record 0067): the check lists the phases in order, the
  // stacks in each, and the edges a phase gives each stack.
  test("lists phases and the edges they give, in the job log and the summary", async () => {
    const files = {
      ...FIXTURE,
      "sluiceway.yaml": [
        "phases: [infrastructure, monitoring, applications]",
        "ignore: [playground]",
        "stacks:",
        "  - path: network",
        "    phase: infrastructure",
        "  - path: app",
        "    phase: { from: example:phase }",
        "    dependsOn: [site:prod]",
        "  - path: site",
        "    phase: infrastructure",
        "",
      ].join("\n"),
      "app/Pulumi.yaml": `${project("app")}example:phase: applications\n`,
      "site/Pulumi.yaml": project("site"),
      "site/Pulumi.prod.yaml": "",
    };
    const { error, log, summary } = await run(files);
    expect(error).toBeUndefined();
    expect(log.groups.find((group) => group.title === "Stacks")?.lines).toEqual([
      "app:prod: environment sluiceway, tickers write, no inputs, phase applications (read from example:phase), depends on network:dev, network:prod, site:prod through the infrastructure phase",
      "network:dev: environment sluiceway, tickers write, no inputs, phase infrastructure",
      "network:prod: environment sluiceway, tickers write, no inputs, phase infrastructure",
      "playground:dev: environment sluiceway, tickers write, no inputs",
      "site:prod: environment sluiceway, tickers write, no inputs, phase infrastructure",
    ]);
    expect(log.groups.find((group) => group.title === "Phases")?.lines).toEqual([
      "1. infrastructure: network:dev, network:prod, site:prod",
      "2. monitoring: no stack. Waits on every stack of infrastructure",
      "3. applications: app:prod. Waits on every stack of infrastructure and monitoring",
    ]);
    expect(summary).toContain("| Stack | Environment | Tickers | Inputs | Phase | Depends on |");
    expect(summary).toContain(
      "| app:prod | sluiceway | write | none | applications, from example:phase | the infrastructure phase |",
    );
    expect(summary).toContain("| site:prod | sluiceway | write | none | infrastructure | none |");
    expect(summary).toContain(
      [
        "### Phases",
        "",
        "| Phase | Stacks | Waits on |",
        "|---|---|---|",
        "| infrastructure | network:dev, network:prod, site:prod | nothing |",
        "| monitoring | none | infrastructure |",
        "| applications | app:prod | infrastructure, monitoring |",
      ].join("\n"),
    );
  });

  test("a setup without dependsOn has no such column", async () => {
    const { summary } = await run(FIXTURE);
    expect(summary).not.toContain("Depends on");
  });

  test("says which stacks each ignore glob leaves out", async () => {
    const { log } = await run(FIXTURE);
    expect(log.lines).toContain(
      'ignore "**/*:dev" leaves out 2 stacks: network:dev, playground:dev.',
    );
  });

  // Onboarding log, hurdle 4.
  test("warns about a glob that matches no stack, and names the glob that would work", async () => {
    const { log } = await run(FIXTURE);
    expect(log.warnings).toEqual([
      {
        title: "An ignore glob matches no stack",
        message:
          'ignore "playground" matches no stack. It is matched against the stack id, not the directory. "playground:*" would leave out playground:dev.',
      },
    ]);
  });

  test("a glob that matches nothing and no directory gets the warning without a hint", async () => {
    const { log, error } = await run({ ...FIXTURE, "sluiceway.yaml": 'ignore: ["apps/loki:*"]\n' });
    expect(error).toBeUndefined();
    expect(log.warnings.map((warning) => warning.message)).toEqual([
      'ignore "apps/loki:*" matches no stack. It is matched against the stack id, not the directory.',
    ]);
  });

  test("lists the files that no stack claims, against the fixture repo", async () => {
    const { log } = await run(FIXTURE);
    expect(log.lines).toContain(
      "5 files are claimed by no stack. A push that changes one of them gives a full scan.",
    );
    expect(log.groups.find((group) => group.title === "Files that no stack claims")?.lines).toEqual(
      // The docs and tooling files of the defaults are not listed (slice 5.9),
      // and neither is the config file (issue 164).
      [
        "package.json",
        "docs/diagram.png",
        "packages/lib/index.ts",
        // playground:dev is ignored, so it claims nothing.
        "playground/Pulumi.dev.yaml",
        "playground/Pulumi.yaml",
      ],
    );
  });

  // Issue 164: the hint names the manifest among the listed files as one to
  // keep off scan.unrelated, in the job log and in the summary.
  test("the hint under the list names the package manifest as one to keep off scan.unrelated", async () => {
    const { log, summary } = await run(FIXTURE);
    const hint =
      "A file that some stacks read belongs under the inputs of those stacks in sluiceway.yaml. A file that no program reads, such as docs, can be listed under scan.unrelated. Keep package.json off that list: it is a lockfile or a package manifest, and a change to it should preview every stack.";
    expect(log.lines).toContain(hint);
    expect(summary).toContain(`\n\n${hint}\n\n`);
    expect(summary).toContain("- The repo root, 1 file: package.json\n");
  });

  test("prints the ready-to-paste block, and keeps the globs scan.unrelated already has", async () => {
    const config = `${FIXTURE["sluiceway.yaml"]}scan:\n  unrelated: ["LICENSE"]\n`;
    const { log } = await run({ ...FIXTURE, "sluiceway.yaml": config });
    expect(log.groups.find((group) => group.title.startsWith("Ready to paste"))?.lines).toEqual([
      "scan:",
      "  unrelated:",
      '    - "LICENSE"',
      '    - "docs/**"',
    ]);
  });

  test("ends with the verdict and what a check cannot tell", async () => {
    const { log } = await run(FIXTURE);
    expect(log.lines.slice(-3)).toEqual([
      "The setup is valid.",
      "A check reads files only, so it cannot say that a preview will work: a stack that does not exist in the backend, a missing credential or a registry the runner cannot reach shows only in a scan.",
      // Slice 5.7, record 0074.
      "With backend: true the check also asks the backend which stacks it holds, with the credentials of its job.",
    ]);
  });

  // Issue 164: the config file is never listed, and the words for an empty
  // list say where it went.
  test("a repo whose only unclaimed file is sluiceway.yaml lists nothing and says why", async () => {
    const { log, summary } = await run({
      "sluiceway.yaml": "tickers: write\n",
      "app/Pulumi.yaml": "name: app\nruntime: yaml\n",
      "app/Pulumi.prod.yaml": "",
    });
    expect(
      log.groups.find((group) => group.title === "Files that no stack claims"),
    ).toBeUndefined();
    expect(summary).toContain(
      "Every file is claimed by a stack, covered by scan.unrelated, or one of the docs and tooling files that force nothing by default. sluiceway.yaml is not listed: no stack claims it, and a change to it previews every stack.",
    );
  });

  test("a stack at the repo root claims sluiceway.yaml, so the words do not mention it", async () => {
    const { summary } = await run({
      "sluiceway.yaml": "tickers: write\n",
      "Pulumi.yaml": "name: app\nruntime: yaml\n",
      "Pulumi.prod.yaml": "",
    });
    expect(summary).toContain(
      "Every file is claimed by a stack, covered by scan.unrelated, or one of the docs and tooling files that force nothing by default.\n",
    );
  });

  test("a repo with no sluiceway.yaml and no stacks is valid", async () => {
    const { log, error, summary } = await run({ "README.md": "" });
    expect(error).toBeUndefined();
    expect(log.lines).toContain("No sluiceway.yaml, so every setting is its default.");
    expect(log.lines).toContain("Found no stacks.");
    expect(summary).toContain("Found no stacks.");
  });
});

// Every message of the config loader (pull request 40), through the mode. A
// check and a scan load config with the same code, so they say the same.
const CONFIG_MESSAGES: [string, string][] = [
  [
    "tickerz: write",
    'unknown key "tickerz". Known keys here: dashboard, tickers, deploys, deployWindows, ignore, scan, drift, valueFingerprint, policies, attribution, phases, stacks, discovery, mergeAndDeploy, notify.',
  ],
  [
    "stacks:\n  - path: network\n    dependsOn: [app]",
    'stacks[0].dependsOn[0]: "app" is not a stack that discovery found. Write the stack id as a row shows it, such as "app:prod".',
  ],
  ["drift: true", "drift: expected a mapping, got true."],
  [
    "stacks:\n  - path: network\n    drift: true",
    "stacks[0].drift: expected a mapping, got true. Write it as the top level has it: drift: { enabled: true }.",
  ],
  [
    "stacks:\n  - path: network\n    dependsOn: automatic",
    'stacks[0].dependsOn: expected a list of stack ids, or auto, got "automatic".',
  ],
  [
    "tickers: [alice, acme/platform]",
    'tickers[1]: "acme/platform" looks like a team. Teams are not supported yet. Use a level ("write", "maintain", "admin") or usernames.',
  ],
  [
    'tickers: ["@alice"]',
    'tickers[0]: "@alice" is not a GitHub username. Write the login alone, without "@".',
  ],
  [
    "tickers: Admin",
    'tickers: expected "write", "maintain", "admin" or a list of usernames, got "Admin".',
  ],
  [
    "tickers: []",
    "tickers: the list is empty, so nobody could tick. Name at least one username or use a level.",
  ],
  ["dashboard:\n  pin: yes please", 'dashboard.pin: expected true or false, got "yes please".'],
  ['dashboard:\n  title: ""', "dashboard.title: must not be empty."],
  [
    "stacks:\n  - name: prod",
    "stacks[0].path: is required. It is the directory of the stack, relative to the repo root.",
  ],
  ["stacks:\n  - path: /network", 'stacks[0].path: "/network" must be relative to the repo root.'],
  [
    "stacks:\n  - path: ../network",
    'stacks[0].path: "../network" must stay inside the repo, so ".." is not allowed.',
  ],
  ["stacks:\n  - path: 'net\\work'", 'stacks[0].path: "net\\\\work" must use forward slashes.'],
  ['stacks:\n  - path: ""', 'stacks[0].path: must not be empty. Use "." for the repo root.'],
  [
    "stacks:\n  - path: network\n    previewTimeout: 2.5",
    "stacks[0].previewTimeout: expected a whole number of minutes, 1 or more, got 2.5.",
  ],
  [
    "stacks:\n  - path: network\n    options:\n      refresh: true",
    'stacks[0].options: unknown option "refresh". A stack that discovery finds from its files takes no options. Only an entry with tool takes them.',
  ],
  [
    "stacks:\n  - path: network\n    name: prod\n  - path: network\n    name: prod",
    'stacks[1]: says the same path and name as stacks[0] ("network:prod"). Put the settings in one entry.',
  ],
  ["tickers: write\ntickers: admin", "line 2, column 1: not valid YAML."],
  // Config laid over what discovery found.
  [
    "stacks:\n  - path: apps/loki",
    'stacks[0]: no stack was found in "apps/loki". An entry adds settings to a stack that exists, it never creates one.',
  ],
  [
    "stacks:\n  - path: network\n    name: staging",
    'stacks[0]: no stack named "staging" was found in "network". Found there: dev, prod.',
  ],
  [
    'ignore: ["**/*:dev"]\nstacks:\n  - path: network\n    name: dev',
    'stacks[0]: the stack "network:dev" is left out by ignore, so these settings would do nothing. Remove the entry, or change ignore.',
  ],
];

describe("a setup that is not valid", () => {
  test.each(CONFIG_MESSAGES)("%p fails with the loader's own message", async (config, message) => {
    const { error, summary } = await run({ ...FIXTURE, "sluiceway.yaml": `${config}\n` });
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toContain(message);
    expect(summary).toContain("sluiceway.yaml is not valid.");
    expect(summary).toContain(escapeText(message));
  });

  test("a sluiceway.yml next to a sluiceway.yaml is refused with the loader's own message", async () => {
    const { error, summary } = await run({
      ...FIXTURE,
      "sluiceway.yaml": "tickers: write\n",
      "sluiceway.yml": "tickers: write\n",
    });
    expect(error).toBeInstanceOf(ConfigError);
    expect(summary).toContain("found both sluiceway.yaml and sluiceway.yml. Keep one of them.");
  });

  test("the summary of a config that is not valid", async () => {
    const { summary } = await run({
      ...FIXTURE,
      "sluiceway.yaml": "tickerz: write\ndrift: true\n",
    });
    expect(summary).toMatchSnapshot();
  });
});

describe("discovery errors", () => {
  const cases: [string, Files, string][] = [
    [
      "a project file that does not parse",
      { "app/Pulumi.yaml": "name: [app\n" },
      "app/Pulumi.yaml: line 2, column 1: not valid YAML.",
    ],
    [
      "stackConfigDir outside the repo",
      { "app/Pulumi.yaml": "name: app\nruntime: yaml\nstackConfigDir: ../../elsewhere\n" },
      'app/Pulumi.yaml: stackConfigDir points outside the repo ("../../elsewhere"). Sluiceway only reads files inside the repo.',
    ],
    [
      "two stacks with one id",
      {
        "apps/Pulumi.yaml": project("apps"),
        "apps/Pulumi.web:prod.yaml": "",
        "apps:web/Pulumi.yaml": project("web"),
        "apps:web/Pulumi.prod.yaml": "",
      },
      'two stacks have the id "apps:web:prod"',
    ],
  ];

  test.each(cases)(
    "%s fails the job with discovery's own message",
    async (_name, files, message) => {
      const { error, summary } = await run(files);
      expect(error).toBeInstanceOf(DiscoveryError);
      expect((error as Error).message).toContain(message);
      expect(summary).toContain("Could not work out the stacks of this repo.");
      expect(summary).toContain(escapeText(message));
    },
  );
});

// Record 0061: the check reads the workflow files too, and says what a
// workflow is missing before its first run. It never turns the job red.
describe("the workflow files", () => {
  const readme = read("README.md");
  const whole =
    fences(readme).find(({ text }) => text.includes("issues:") && /^on:/m.test(text))?.text ?? "";
  const at = ".github/workflows/deploy-dashboard.yml";

  // Record 0077: one job, and its step picks its own mode.
  test("the README's workflow: its one job listed, nothing missing", async () => {
    const { log, error, summary } = await run({ "README.md": "", [at]: whole });
    expect(error).toBeUndefined();
    expect(log.groups.find((group) => group.title === "Workflows")?.lines).toEqual([
      ".github/workflows/deploy-dashboard.yml, job sluiceway: mode auto, which runs scan, resolve, apply, settle, at v0, which follows every release of v0.",
    ]);
    expect(log.lines).toContain("Nothing is missing from the workflows.");
    expect(log.warnings).toEqual([]);
    expect(summary).toContain("Nothing is missing from the workflows.");
  });

  test("a broken workflow: a warning each, and the job stays green", async () => {
    const broken = whole
      .replace("  workflow_dispatch:\n", "")
      .replace("actions: write", "actions: read")
      .replaceAll("sluiceway/sluiceway@v0", "sluiceway/sluiceway@main")
      .replace("on:\n", "on:\n  pull_request:\n");
    const { log, error, summary } = await run({ "README.md": "", [at]: broken });
    expect(error).toBeUndefined();
    expect(log.warnings.map((warning) => warning.title)).toEqual(
      Array(4).fill("A workflow is missing something"),
    );
    expect(log.warnings.map((warning) => warning.message)).toContain(
      ".github/workflows/deploy-dashboard.yml has no workflow_dispatch trigger. The rescan box and settle start a scan through it.",
    );
    expect(log.lines.slice(-3)[0]).toBe("The setup is valid.");
    expect(summary).toMatchSnapshot();
  });

  test("a repo with no workflow that scans says so", async () => {
    const { log, summary } = await run({ "README.md": "" });
    expect(log.lines).toContain("No workflow in .github/workflows runs a scan yet.");
    expect(summary).toContain("No workflow in .github/workflows runs a scan yet.");
  });

  test("the read-only trial without dashboard.readOnly", async () => {
    // The README rewrite moved the trial to its own page.
    const trial =
      fences(read("docs/read-only-trial.md")).find(
        ({ text }) => text.includes("sluiceway/sluiceway@v0") && /^on:/m.test(text),
      )?.text ?? "";
    const { log } = await run({ "README.md": "", [at]: trial });
    expect(log.warnings.map((warning) => warning.message)).toEqual([
      ".github/workflows/deploy-dashboard.yml scans, and no job in it resolves a tick, so a box on the dashboard does nothing. For a workflow that only scans, set dashboard.readOnly: true in sluiceway.yaml.",
    ]);
  });
});
