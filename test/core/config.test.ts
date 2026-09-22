import { describe, expect, test } from "bun:test";
import { type Config, ConfigError, parseConfig } from "../../src/core/config.ts";

// The defaults of build-plan.md, section 3, written out by hand.
const DEFAULTS: Config = {
  dashboard: {
    title: "Sluiceway dashboard",
    label: "sluiceway",
    pin: true,
    redact: false,
    personality: true,
    readOnly: false,
    showValues: [],
    recentlyDeployed: 10,
  },
  tickers: "write",
  deploys: true,
  ignore: [],
  scan: { unrelated: [], logDiff: false },
  drift: { enabled: false },
  stacks: [],
  mergeAndDeploy: { authors: [] },
};

describe("zero config", () => {
  test("no file gives every default", () => {
    expect(parseConfig(undefined)).toEqual(DEFAULTS);
  });

  test("an empty file, or one with only comments, gives every default", () => {
    expect(parseConfig("")).toEqual(DEFAULTS);
    expect(parseConfig("# nothing here yet\n")).toEqual(DEFAULTS);
  });

  test("a partial dashboard block keeps the other defaults", () => {
    expect(parseConfig("dashboard:\n  redact: true\n").dashboard).toEqual({
      ...DEFAULTS.dashboard,
      redact: true,
    });
  });
});

describe("a full file", () => {
  test("every top level key is read", () => {
    const config = parseConfig(`
dashboard:
  title: Infra
  label: infra-dashboard
  pin: false
  redact: true
  personality: false
  readOnly: true
tickers: admin
ignore:
  - "**/*:dev"
scan:
  unrelated:
    - "**/*.md"
drift:
  enabled: true
`);
    expect(config).toEqual({
      dashboard: {
        title: "Infra",
        label: "infra-dashboard",
        pin: false,
        redact: true,
        personality: false,
        readOnly: true,
        showValues: [],
        recentlyDeployed: 10,
      },
      tickers: "admin",
      deploys: true,
      ignore: ["**/*:dev"],
      scan: { unrelated: ["**/*.md"], logDiff: false },
      drift: { enabled: true },
      stacks: [],
      mergeAndDeploy: { authors: [] },
    });
  });
});

// Every problem in the file, as the person reads it.
function problems(text: string): string[] {
  try {
    parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error("expected the config to be refused");
}

describe("unknown keys", () => {
  test("a typo at the top level is an error that lists the known keys", () => {
    expect(problems("tickerz: admin\n")).toEqual([
      'unknown key "tickerz". Known keys here: dashboard, tickers, deploys, ignore, scan, drift, stacks, mergeAndDeploy.',
    ]);
  });
});

describe("drift on a stack (record 0059)", () => {
  test("takes enabled, like the top level", () => {
    expect(
      parseConfig("stacks:\n  - path: apps/a\n    drift:\n      enabled: false\n").stacks,
    ).toEqual([{ path: "apps/a", drift: { enabled: false } }]);
  });

  test("true or false alone says how to write it", () => {
    expect(problems("stacks:\n  - path: apps/a\n    drift: true\n")).toEqual([
      "stacks[0].drift: expected a mapping, got true. Write it as the top level has it: drift: { enabled: true }.",
    ]);
  });

  test("another key names the known ones", () => {
    expect(
      problems(
        "stacks:\n  - path: apps/a\n    drift:\n      enabled: true\n      schedule: daily\n",
      ),
    ).toEqual(['stacks[0].drift: unknown key "schedule". Known keys here: enabled.']);
  });
});

describe("drift (record 0055)", () => {
  test("is off by default, and drift.enabled turns it on", () => {
    expect(parseConfig(undefined).drift).toEqual({ enabled: false });
    expect(parseConfig("drift:\n  enabled: true\n").drift).toEqual({ enabled: true });
    expect(parseConfig("drift: {}\n").drift).toEqual({ enabled: false });
  });

  test("enabled is true or false", () => {
    expect(problems("drift:\n  enabled: yes please\n")).toEqual([
      'drift.enabled: expected true or false, got "yes please".',
    ]);
  });

  test("a schedule is the workflow's, so drift.schedule says where it goes", () => {
    expect(problems('drift:\n  enabled: true\n  schedule: "0 6 * * *"\n')).toEqual([
      'drift: "schedule" is not a key of sluiceway.yaml. A drift check runs in every scan that a schedule starts, so the cron goes in the workflow, under `on: schedule`.',
    ]);
  });

  test("another unknown key names the known ones", () => {
    expect(problems("drift:\n  enable: true\n")).toEqual([
      'drift: unknown key "enable". Known keys here: enabled.',
    ]);
  });
});

describe("tickers", () => {
  test("a level is kept as written", () => {
    expect(parseConfig("tickers: maintain\n").tickers).toBe("maintain");
  });

  test("a list of usernames is lower cased, because GitHub compares logins without case", () => {
    expect(parseConfig("tickers: [Alice, BOB-ops, carol_corp]\n").tickers).toEqual([
      "alice",
      "bob-ops",
      "carol_corp",
    ]);
  });

  test("a username listed twice in different case is kept once", () => {
    expect(parseConfig("tickers: [Alice, alice, ALICE, bob]\n").tickers).toEqual(["alice", "bob"]);
  });

  test("a level in another case is refused, it is never read as a username", () => {
    expect(problems("tickers: Admin\n")).toEqual([
      'tickers: expected "write", "maintain", "admin" or a list of usernames, got "Admin".',
    ]);
  });

  test("a level below write does not exist", () => {
    expect(problems("tickers: triage\n")).toEqual([
      'tickers: expected "write", "maintain", "admin" or a list of usernames, got "triage".',
    ]);
  });

  test("an entry with a slash fails, because teams are not supported yet", () => {
    expect(problems("tickers: [alice, acme/platform]\n")).toEqual([
      'tickers[1]: "acme/platform" looks like a team. Teams are not supported yet. Use a level ("write", "maintain", "admin") or usernames.',
    ]);
  });

  test("an entry that cannot be a username is refused", () => {
    expect(problems('tickers: ["@alice", "bob smith", ""]\n')).toEqual([
      'tickers[0]: "@alice" is not a GitHub username. Write the login alone, without "@".',
      'tickers[1]: "bob smith" is not a GitHub username. Write the login alone, without "@".',
      'tickers[2]: "" is not a GitHub username. Write the login alone, without "@".',
    ]);
  });

  test("an empty list is refused, because nobody could tick", () => {
    expect(problems("tickers: []\n")).toEqual([
      "tickers: the list is empty, so nobody could tick. Name at least one username or use a level.",
    ]);
  });

  test("a stack entry takes the same rule, with the same errors", () => {
    const config = parseConfig("stacks:\n  - path: apps/a\n    tickers: [Alice]\n");
    expect(config.stacks[0]?.tickers).toEqual(["alice"]);
    expect(problems("stacks:\n  - path: apps/a\n    tickers: [acme/platform]\n")).toEqual([
      'stacks[0].tickers[0]: "acme/platform" looks like a team. Teams are not supported yet. Use a level ("write", "maintain", "admin") or usernames.',
    ]);
  });
});

describe("stack entries", () => {
  test("an entry keeps what it sets and invents nothing else", () => {
    const config = parseConfig(`
stacks:
  - path: apps/grafana
    name: prod
    environment: production
    tickers: admin
    inputs: ["shared/dashboards/**"]
    previewTimeout: 25
    options: {}
  - path: apps/loki
`);
    expect(config.stacks).toEqual([
      {
        path: "apps/grafana",
        name: "prod",
        environment: "production",
        tickers: "admin",
        inputs: ["shared/dashboards/**"],
        previewTimeout: 25,
        options: {},
      },
      { path: "apps/loki" },
    ]);
  });

  test("a path is brought to the form a stack id uses", () => {
    const paths = (text: string) => parseConfig(text).stacks.map((entry) => entry.path);
    expect(
      paths(
        "stacks:\n  - path: ./apps/a\n  - path: apps/b/\n  - path: apps//c/./d\n  - path: .\n  - path: ./\n    name: prod\n",
      ),
    ).toEqual(["apps/a", "apps/b", "apps/c/d", ".", "."]);
  });

  test("a path must stay inside the repo and use forward slashes", () => {
    expect(
      problems(
        'stacks:\n  - path: /srv/infra\n  - path: ../other\n  - path: apps/../../x\n  - path: "apps\\\\a"\n  - path: ""\n',
      ),
    ).toEqual([
      'stacks[0].path: "/srv/infra" must be relative to the repo root.',
      'stacks[1].path: "../other" must stay inside the repo, so ".." is not allowed.',
      'stacks[2].path: "apps/../../x" must stay inside the repo, so ".." is not allowed.',
      'stacks[3].path: "apps\\\\a" must use forward slashes.',
      'stacks[4].path: must not be empty. Use "." for the repo root.',
    ]);
  });

  test("path is required", () => {
    expect(problems("stacks:\n  - name: prod\n")).toEqual([
      "stacks[0].path: is required. It is the directory of the stack, relative to the repo root.",
    ]);
  });

  test("name and environment must not be empty", () => {
    expect(problems('stacks:\n  - path: a\n    name: ""\n    environment: ""\n')).toEqual([
      "stacks[0].name: must not be empty.",
      "stacks[0].environment: must not be empty.",
    ]);
  });

  test("previewTimeout is whole minutes, 1 or more", () => {
    const refused = (value: string) =>
      problems(`stacks:\n  - path: a\n    previewTimeout: ${value}\n`);
    expect(refused("0")).toEqual([
      "stacks[0].previewTimeout: expected a whole number of minutes, 1 or more, got 0.",
    ]);
    expect(refused("2.5")).toEqual([
      "stacks[0].previewTimeout: expected a whole number of minutes, 1 or more, got 2.5.",
    ]);
    expect(refused("10m")).toEqual([
      'stacks[0].previewTimeout: expected a whole number of minutes, 1 or more, got "10m".',
    ]);
  });

  test("a stack that discovery finds from its files takes no options", () => {
    expect(problems("stacks:\n  - path: a\n    options:\n      refresh: true\n")).toEqual([
      'stacks[0].options: unknown option "refresh". A stack that discovery finds from its files takes no options. Only an entry with tool takes them.',
    ]);
  });

  test("an entry with tool keeps the tool and its options for the adapter to check (record 0053)", () => {
    const config = parseConfig(
      "stacks:\n  - path: infra\n    name: prod\n    tool: opentofu\n    options:\n      workspace: prod\n      varFiles: [prod.tfvars]\n",
    );
    expect(config.stacks).toEqual([
      {
        path: "infra",
        name: "prod",
        tool: "opentofu",
        options: { workspace: "prod", varFiles: ["prod.tfvars"] },
      },
    ]);
  });

  test("tool must not be empty", () => {
    expect(problems('stacks:\n  - path: a\n    tool: ""\n')).toEqual([
      "stacks[0].tool: must not be empty.",
    ]);
  });

  test("the brief's old keys are unknown keys", () => {
    expect(problems("stacks:\n  - path: a\n    stack: prod\n    approvers: write\n")).toEqual([
      'stacks[0]: unknown key "stack". Known keys here: path, name, tool, environment, tickers, inputs, previewTimeout, dependsOn, drift, options.',
      'stacks[0]: unknown key "approvers". Known keys here: path, name, tool, environment, tickers, inputs, previewTimeout, dependsOn, drift, options.',
    ]);
  });

  test("two entries for the same path and name are an error", () => {
    expect(
      problems(
        "stacks:\n  - path: apps/a\n    name: prod\n  - path: apps/a\n  - path: ./apps/a/\n    name: prod\n  - path: apps/a\n",
      ),
    ).toEqual([
      'stacks[2]: says the same path and name as stacks[0] ("apps/a:prod"). Put the settings in one entry.',
      'stacks[3]: says the same path and name as stacks[1] ("apps/a"). Put the settings in one entry.',
    ]);
  });
});

describe("wrong types", () => {
  test("each message says what was expected and what was found", () => {
    expect(
      problems(
        'dashboard:\n  title: 5\n  pin: "yes"\nignore: "**/x"\nscan: []\nstacks:\n  - apps/a\n',
      ),
    ).toEqual([
      "dashboard.title: expected text, got 5.",
      'dashboard.pin: expected true or false, got "yes".',
      'ignore: expected a list, got "**/x".',
      "scan: expected a mapping, got a list.",
      'stacks[0]: expected a mapping, got "apps/a".',
    ]);
  });

  // Slice 2.17: a misspelled switch fails loudly, so a dashboard is never
  // read only, or not, by accident.
  test("dashboard.readOnly is true or false, and a wrong spelling is an unknown key", () => {
    expect(problems('dashboard:\n  readOnly: "yes"\n')).toEqual([
      'dashboard.readOnly: expected true or false, got "yes".',
    ]);
    expect(problems("dashboard:\n  read-only: true\n")).toEqual([
      'dashboard: unknown key "read-only". Known keys here: title, label, pin, redact, personality, readOnly, showValues, recentlyDeployed.',
    ]);
  });

  // Slice 4.11 (record 0062): how many lines Recently deployed lists.
  test("dashboard.recentlyDeployed is a whole number from 0 to 50", () => {
    expect(parseConfig("dashboard:\n  recentlyDeployed: 0\n").dashboard.recentlyDeployed).toBe(0);
    expect(parseConfig("dashboard:\n  recentlyDeployed: 50\n").dashboard.recentlyDeployed).toBe(50);
    for (const [value, shown] of [
      ["-1", "-1"],
      ["51", "51"],
      ["2.5", "2.5"],
      ['"ten"', '"ten"'],
    ]) {
      expect(problems(`dashboard:\n  recentlyDeployed: ${value}\n`)).toEqual([
        `dashboard.recentlyDeployed: expected a whole number of lines from 0 to 50, got ${shown}.`,
      ]);
    }
  });

  test("a glob must be text that is not empty", () => {
    expect(problems('ignore: [""]\nscan:\n  unrelated: [3]\n')).toEqual([
      "ignore[0]: must not be empty.",
      "scan.unrelated[0]: expected text, got 3.",
    ]);
  });

  test("title and label must not be empty", () => {
    expect(problems('dashboard:\n  title: ""\n  label: ""\n')).toEqual([
      "dashboard.title: must not be empty.",
      "dashboard.label: must not be empty.",
    ]);
  });
});

describe("a file that is not a mapping", () => {
  test("a list at the top level is refused", () => {
    expect(problems("- a\n- b\n")).toEqual(["expected a mapping, got a list."]);
  });

  test("broken YAML names the line and the column", () => {
    expect(problems("dashboard:\n  title: [unclosed\n")).toEqual([
      "line 3, column 1: not valid YAML. Flow sequence in block collection must be sufficiently indented and end with a ]",
    ]);
  });

  test("a key written twice is refused", () => {
    expect(problems("tickers: admin\ntickers: write\n")).toEqual([
      "line 2, column 1: not valid YAML. Map keys must be unique",
    ]);
  });
});

describe("the error", () => {
  test("names the file and lists every problem", () => {
    expect(() => parseConfig("tickerz: admin\ndashboard:\n  pin: 1\n")).toThrow(
      'sluiceway.yaml is not valid:\n- unknown key "tickerz". Known keys here: dashboard, tickers, deploys, ignore, scan, drift, stacks, mergeAndDeploy.\n- dashboard.pin: expected true or false, got 1.',
    );
  });
});

describe("scan.logDiff (record 0048)", () => {
  test("is off unless the file turns it on", () => {
    expect(parseConfig(undefined).scan.logDiff).toBe(false);
    expect(parseConfig("scan:\n  unrelated: ['**/*.md']\n").scan.logDiff).toBe(false);
    expect(parseConfig("scan:\n  logDiff: true\n").scan).toEqual({
      unrelated: [],
      logDiff: true,
    });
  });

  test("takes true or false and nothing else, so a typo never turns it on", () => {
    expect(() => parseConfig('scan:\n  logDiff: "yes"\n')).toThrow(
      'scan.logDiff: expected true or false, got "yes".',
    );
    expect(() => parseConfig("scan:\n  logdiff: true\n")).toThrow(
      'scan: unknown key "logdiff". Known keys here: unrelated, logDiff.',
    );
  });
});

// Slice 2.20 (record 0051): an exclusion can say why, so it never rots
// out of sight.
describe("ignore entries with a reason", () => {
  test("an entry is a glob as text, or a mapping with a glob and a reason", () => {
    expect(
      parseConfig(`
ignore:
  - "**/*:dev"
  - glob: "apps/legacy:*"
    reason: Moved to the platform team's pipeline
`).ignore,
    ).toEqual([
      "**/*:dev",
      { glob: "apps/legacy:*", reason: "Moved to the platform team's pipeline" },
    ]);
  });

  test("a mapping without a reason is an error, because the reason is the point of it", () => {
    expect(problems('ignore:\n  - glob: "apps/legacy:*"\n')).toEqual([
      'ignore[0].reason: is required. Say why the stack is left out, or write the glob as text: "apps/legacy:*".',
    ]);
  });

  test("a mapping needs a glob, and neither may be empty", () => {
    expect(problems("ignore:\n  - reason: gone\n")).toEqual([
      "ignore[0].glob: is required. It is matched against the stack id.",
    ]);
    expect(problems('ignore:\n  - glob: ""\n    reason: ""\n')).toEqual([
      "ignore[0].glob: must not be empty.",
      "ignore[0].reason: must not be empty.",
    ]);
  });

  test("a mapping takes no other key", () => {
    expect(problems('ignore:\n  - glob: "a:*"\n    reason: gone\n    until: 2027\n')).toEqual([
      'ignore[0]: unknown key "until". Known keys here: glob, reason.',
    ]);
  });

  test("an entry that is neither text nor a mapping is refused", () => {
    expect(problems("ignore:\n  - 3\n")).toEqual([
      "ignore[0]: expected a glob as text, or a mapping with glob and reason, got 3.",
    ]);
  });
});

// Slice 2.20 (record 0051): one reviewed line stops every deploy.
describe("deploys", () => {
  test("is on unless the file turns it off", () => {
    expect(parseConfig(undefined).deploys).toBe(true);
    expect(parseConfig("deploys: false\n").deploys).toBe(false);
  });

  test("takes true or false and nothing else", () => {
    expect(problems('deploys: "off"\n')).toEqual(['deploys: expected true or false, got "off".']);
  });
});

// Slice 4.2 (record 0054): pull requests by these authors may be merged and
// deployed with one tick. Off by default.
describe("mergeAndDeploy", () => {
  test("is off unless the file names authors", () => {
    expect(parseConfig(undefined).mergeAndDeploy).toEqual({ authors: [] });
    expect(parseConfig("mergeAndDeploy: {}\n").mergeAndDeploy).toEqual({ authors: [] });
  });

  test("takes logins of people and of apps, kept once each in lower case", () => {
    expect(
      parseConfig(
        "mergeAndDeploy:\n  authors:\n    - Renovate[bot]\n    - dependabot[bot]\n    - alice\n    - renovate[bot]\n",
      ).mergeAndDeploy.authors,
    ).toEqual(["renovate[bot]", "dependabot[bot]", "alice"]);
  });

  test("a login with an @ or a slash is refused", () => {
    expect(problems("mergeAndDeploy:\n  authors: ['@alice', org/bots]\n")).toEqual([
      'mergeAndDeploy.authors[0]: "@alice" is not a GitHub login. Write the login alone, without "@". An app is written with [bot], such as renovate[bot].',
      'mergeAndDeploy.authors[1]: "org/bots" is not a GitHub login. Write the login alone, without "@". An app is written with [bot], such as renovate[bot].',
    ]);
  });

  test("an unknown key is refused", () => {
    expect(problems("mergeAndDeploy:\n  author: [alice]\n")).toEqual([
      'mergeAndDeploy: unknown key "author". Known keys here: authors.',
    ]);
  });
});
