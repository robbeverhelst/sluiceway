import { describe, expect, test } from "bun:test";
import { type Config, ConfigError, type ConfigIssue, parseConfig } from "../../src/core/config.ts";

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
    timeZone: "UTC",
    sections: [
      "deploying",
      "updates",
      "pending",
      "drifted",
      "previewFailed",
      "inSync",
      "recentlyDeployed",
    ],
    deployingSection: true,
    driftedSection: true,
    inSyncSection: "fold",
    zeroCounts: true,
    destroyAlert: "destroys",
    pendingDetail: "full",
    deployAll: true,
    repairAll: true,
    rescanBox: true,
    footer: true,
  },
  tickers: "write",
  deploys: true,
  recordWriters: [],
  deployWindows: [],
  ignore: [],
  scan: { unrelated: [], logDiff: false },
  drift: { enabled: false },
  valueFingerprint: true,
  policies: [],
  cost: { enabled: false },
  attribution: { lookback: 100, names: 5 },
  phases: [],
  stacks: [],
  discovery: {},
  mergeAndDeploy: { authors: [], preview: false },
  notify: { events: ["pending", "drift", "failed", "refused"] },
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
valueFingerprint: false
policies: [policies]
cost:
  enabled: true
  threshold: 100
phases: [infrastructure, applications]
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
        timeZone: "UTC",
        sections: [
          "deploying",
          "updates",
          "pending",
          "drifted",
          "previewFailed",
          "inSync",
          "recentlyDeployed",
        ],
        deployingSection: true,
        driftedSection: true,
        inSyncSection: "fold",
        zeroCounts: true,
        destroyAlert: "destroys",
        pendingDetail: "full",
        deployAll: true,
        repairAll: true,
        rescanBox: true,
        footer: true,
      },
      tickers: "admin",
      deploys: true,
      recordWriters: [],
      deployWindows: [],
      ignore: ["**/*:dev"],
      scan: { unrelated: ["**/*.md"], logDiff: false },
      drift: { enabled: true },
      valueFingerprint: false,
      policies: ["policies"],
      cost: { enabled: true, threshold: 100 },
      attribution: { lookback: 100, names: 5 },
      phases: ["infrastructure", "applications"],
      stacks: [],
      discovery: {},
      mergeAndDeploy: { authors: [], preview: false },
      notify: { events: ["pending", "drift", "failed", "refused"] },
    });
  });
});

// Every issue in the file, in file order, as facts. The words each issue gets
// are test/render/config-problems.test.ts's.
function issues(text: string): ConfigIssue[] {
  try {
    parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("expected the config to be refused");
}

const TOP_KEYS = [
  "dashboard",
  "tickers",
  "deploys",
  "recordWriters",
  "deployWindows",
  "ignore",
  "scan",
  "drift",
  "valueFingerprint",
  "policies",
  "cost",
  "attribution",
  "phases",
  "stacks",
  "discovery",
  "mergeAndDeploy",
  "notify",
];

describe("unknown keys", () => {
  test("a typo at the top level is an error that lists the known keys", () => {
    expect(issues("tickerz: admin\n")).toEqual([
      { kind: "unknown-key", key: "tickerz", known: TOP_KEYS, path: [] },
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
    expect(issues("stacks:\n  - path: apps/a\n    drift: true\n")).toEqual([
      { kind: "stack-drift-not-a-mapping", value: true, path: ["stacks", 0, "drift"] },
    ]);
  });

  test("another key names the known ones", () => {
    expect(
      issues("stacks:\n  - path: apps/a\n    drift:\n      enabled: true\n      schedule: daily\n"),
    ).toEqual([
      { kind: "unknown-key", key: "schedule", known: ["enabled"], path: ["stacks", 0, "drift"] },
    ]);
  });
});

describe("drift (record 0055)", () => {
  test("is off by default, and drift.enabled turns it on", () => {
    expect(parseConfig(undefined).drift).toEqual({ enabled: false });
    expect(parseConfig("drift:\n  enabled: true\n").drift).toEqual({ enabled: true });
    expect(parseConfig("drift: {}\n").drift).toEqual({ enabled: false });
  });

  test("enabled is true or false", () => {
    expect(issues("drift:\n  enabled: yes please\n")).toEqual([
      { kind: "wrong-type", expected: "boolean", value: "yes please", path: ["drift", "enabled"] },
    ]);
  });

  test("a schedule is the workflow's, so drift.schedule says where it goes", () => {
    expect(issues('drift:\n  enabled: true\n  schedule: "0 6 * * *"\n')).toEqual([
      { kind: "drift-schedule", path: ["drift"] },
    ]);
  });

  test("another unknown key names the known ones", () => {
    expect(issues("drift:\n  enable: true\n")).toEqual([
      { kind: "unknown-key", key: "enable", known: ["enabled"], path: ["drift"] },
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
    expect(issues("tickers: Admin\n")).toEqual([
      { kind: "not-a-tick-rule", value: "Admin", path: ["tickers"] },
    ]);
  });

  test("a level below write does not exist", () => {
    expect(issues("tickers: triage\n")).toEqual([
      { kind: "not-a-tick-rule", value: "triage", path: ["tickers"] },
    ]);
  });

  test("an entry with a slash fails, because teams are not supported yet", () => {
    expect(issues("tickers: [alice, acme/platform]\n")).toEqual([
      { kind: "a-team", value: "acme/platform", path: ["tickers", 1] },
    ]);
  });

  test("an entry that cannot be a username is refused", () => {
    expect(issues('tickers: ["@alice", "bob smith", ""]\n')).toEqual([
      { kind: "not-a-username", value: "@alice", path: ["tickers", 0] },
      { kind: "not-a-username", value: "bob smith", path: ["tickers", 1] },
      { kind: "not-a-username", value: "", path: ["tickers", 2] },
    ]);
  });

  test("an empty list is refused, because nobody could tick", () => {
    expect(issues("tickers: []\n")).toEqual([{ kind: "no-tickers", path: ["tickers"] }]);
  });

  test("a stack entry takes the same rule, with the same errors", () => {
    const config = parseConfig("stacks:\n  - path: apps/a\n    tickers: [Alice]\n");
    expect(config.stacks[0]?.tickers).toEqual(["alice"]);
    expect(issues("stacks:\n  - path: apps/a\n    tickers: [acme/platform]\n")).toEqual([
      { kind: "a-team", value: "acme/platform", path: ["stacks", 0, "tickers", 0] },
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
      issues(
        'stacks:\n  - path: /srv/infra\n  - path: ../other\n  - path: apps/../../x\n  - path: "apps\\\\a"\n  - path: ""\n',
      ),
    ).toEqual([
      { kind: "absolute-path", value: "/srv/infra", path: ["stacks", 0, "path"] },
      { kind: "path-leaves-repo", value: "../other", path: ["stacks", 1, "path"] },
      { kind: "path-leaves-repo", value: "apps/../../x", path: ["stacks", 2, "path"] },
      { kind: "backslash-in-path", value: "apps\\a", path: ["stacks", 3, "path"] },
      { kind: "empty-stack-path", path: ["stacks", 4, "path"] },
    ]);
  });

  test("path is required", () => {
    expect(issues("stacks:\n  - name: prod\n")).toEqual([
      { kind: "required-stack-path", path: ["stacks", 0, "path"] },
    ]);
  });

  test("name and environment must not be empty", () => {
    expect(issues('stacks:\n  - path: a\n    name: ""\n    environment: ""\n')).toEqual([
      { kind: "empty", path: ["stacks", 0, "name"] },
      { kind: "empty", path: ["stacks", 0, "environment"] },
    ]);
  });

  // Slice 5.38 (record 0103): one file per entry, named on one line.
  test("envFile is one path on one line, and never empty", () => {
    expect(issues('stacks:\n  - path: a\n    envFile: ""\n')).toEqual([
      { kind: "empty", path: ["stacks", 0, "envFile"] },
    ]);
    expect(issues('stacks:\n  - path: a\n    envFile: "ci/a.env\\nci/b.env"\n')).toEqual([
      {
        kind: "worded",
        text: "envFile names one file on one line. To load several files, join them in a step before Sluiceway.",
        path: ["stacks", 0, "envFile"],
      },
    ]);
  });

  test("previewTimeout is whole minutes, 1 or more", () => {
    const refused = (value: string) =>
      issues(`stacks:\n  - path: a\n    previewTimeout: ${value}\n`);
    for (const [value, read] of [
      ["0", 0],
      ["2.5", 2.5],
      ["10m", "10m"],
    ] as const) {
      expect(refused(value)).toEqual([
        {
          kind: "not-a-count",
          counts: "minutes",
          min: 1,
          value: read,
          path: ["stacks", 0, "previewTimeout"],
        },
      ]);
    }
  });

  test("a stack that discovery finds from its files takes no options", () => {
    expect(issues("stacks:\n  - path: a\n    options:\n      refresh: true\n")).toEqual([
      { kind: "option-without-tool", option: "refresh", path: ["stacks", 0, "options"] },
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
    expect(issues('stacks:\n  - path: a\n    tool: ""\n')).toEqual([
      { kind: "empty", path: ["stacks", 0, "tool"] },
    ]);
  });

  test("the brief's old keys are unknown keys", () => {
    const known = [
      "path",
      "name",
      "tool",
      "id",
      "environment",
      "tickers",
      "inputs",
      "previewTimeout",
      "dependsOn",
      "phase",
      "deploy",
      "deployWindows",
      "drift",
      "valueFingerprint",
      "envFile",
      "policies",
      "createInBackend",
      "cost",
      "options",
    ];
    expect(issues("stacks:\n  - path: a\n    stack: prod\n    approvers: write\n")).toEqual([
      { kind: "unknown-key", key: "stack", known, path: ["stacks", 0] },
      { kind: "unknown-key", key: "approvers", known, path: ["stacks", 0] },
    ]);
  });

  test("two entries for the same path and name are an error", () => {
    expect(
      issues(
        "stacks:\n  - path: apps/a\n    name: prod\n  - path: apps/a\n  - path: ./apps/a/\n    name: prod\n  - path: apps/a\n",
      ),
    ).toEqual([
      { kind: "same-entry", first: 0, stackId: "apps/a:prod", path: ["stacks", 2] },
      { kind: "same-entry", first: 1, stackId: "apps/a", path: ["stacks", 3] },
    ]);
  });

  // Found while taking the words out of core: the id's own rule has words
  // that never show, because the username rule claims every pattern it does
  // not know. Kept as it is by that refactor.
  test("an id that is not plain is refused, for now in the words of a username", () => {
    expect(issues('stacks:\n  - path: a\n    id: "web prod"\n')).toEqual([
      { kind: "not-a-username", value: "web prod", path: ["stacks", 0, "id"] },
    ]);
  });
});

describe("wrong types", () => {
  test("each issue holds what was expected and what was found", () => {
    expect(
      issues(
        'dashboard:\n  title: 5\n  pin: "yes"\nignore: "**/x"\nscan: []\nstacks:\n  - apps/a\n',
      ),
    ).toEqual([
      { kind: "wrong-type", expected: "string", value: 5, path: ["dashboard", "title"] },
      { kind: "wrong-type", expected: "boolean", value: "yes", path: ["dashboard", "pin"] },
      { kind: "wrong-type", expected: "array", value: "**/x", path: ["ignore"] },
      { kind: "wrong-type", expected: "object", value: [], path: ["scan"] },
      { kind: "wrong-type", expected: "object", value: "apps/a", path: ["stacks", 0] },
    ]);
  });

  // Slice 2.17: a misspelled switch fails loudly, so a dashboard is never
  // read only, or not, by accident.
  test("dashboard.readOnly is true or false, and a wrong spelling is an unknown key", () => {
    expect(issues('dashboard:\n  readOnly: "yes"\n')).toEqual([
      { kind: "wrong-type", expected: "boolean", value: "yes", path: ["dashboard", "readOnly"] },
    ]);
    expect(issues("dashboard:\n  read-only: true\n")).toEqual([
      {
        kind: "unknown-key",
        key: "read-only",
        known: [
          "title",
          "label",
          "pin",
          "redact",
          "personality",
          "readOnly",
          "showValues",
          "recentlyDeployed",
          "timeZone",
          "sections",
          "deployingSection",
          "driftedSection",
          "inSyncSection",
          "zeroCounts",
          "destroyAlert",
          "pendingDetail",
          "deployAll",
          "repairAll",
          "rescanBox",
          "footer",
        ],
        path: ["dashboard"],
      },
    ]);
  });

  // Slice 4.11 (record 0062): how many lines Recently deployed lists.
  test("dashboard.recentlyDeployed is a whole number from 0 to 50", () => {
    expect(parseConfig("dashboard:\n  recentlyDeployed: 0\n").dashboard.recentlyDeployed).toBe(0);
    expect(parseConfig("dashboard:\n  recentlyDeployed: 50\n").dashboard.recentlyDeployed).toBe(50);
    for (const [value, read] of [
      ["-1", -1],
      ["51", 51],
      ["2.5", 2.5],
      ['"ten"', "ten"],
    ] as const) {
      expect(issues(`dashboard:\n  recentlyDeployed: ${value}\n`)).toEqual([
        {
          kind: "not-a-count",
          counts: "lines",
          min: 0,
          max: 50,
          value: read,
          path: ["dashboard", "recentlyDeployed"],
        },
      ]);
    }
  });

  // Slice 5.5 (record 0072): how far attribution looks back, and how many
  // pull requests and direct pushes a row names.
  test("attribution.lookback is a whole number of commits from 1 to 1000", () => {
    expect(parseConfig("attribution:\n  lookback: 1\n").attribution.lookback).toBe(1);
    expect(parseConfig("attribution:\n  lookback: 1000\n").attribution).toEqual({
      lookback: 1000,
      names: 5,
    });
    for (const [value, read] of [
      ["0", 0],
      ["1001", 1001],
      ["2.5", 2.5],
      ['"all"', "all"],
    ] as const) {
      expect(issues(`attribution:\n  lookback: ${value}\n`)).toEqual([
        {
          kind: "not-a-count",
          counts: "commits",
          min: 1,
          max: 1000,
          value: read,
          path: ["attribution", "lookback"],
        },
      ]);
    }
  });

  // Record 0089: the zone every time on the dashboard is shown in.
  test("dashboard.timeZone is an IANA zone name, UTC when left out", () => {
    expect(parseConfig(undefined).dashboard.timeZone).toBe("UTC");
    expect(parseConfig("dashboard:\n  timeZone: Europe/Brussels\n").dashboard.timeZone).toBe(
      "Europe/Brussels",
    );
    expect(parseConfig("dashboard:\n  timeZone: Asia/Kolkata\n").dashboard.timeZone).toBe(
      "Asia/Kolkata",
    );
    expect(parseConfig("dashboard:\n  timeZone: UTC\n").dashboard.timeZone).toBe("UTC");
    for (const value of ["Europe/Brusels", "Mars/Olympus_Mons", "+02:00", "UTC+2", " "]) {
      expect(issues(`dashboard:\n  timeZone: "${value}"\n`)).toEqual([
        { kind: "not-a-time-zone", value, path: ["dashboard", "timeZone"] },
      ]);
    }
    expect(issues("dashboard:\n  timeZone: 2\n")).toEqual([
      { kind: "wrong-type", expected: "string", value: 2, path: ["dashboard", "timeZone"] },
    ]);
  });

  test("a name that is not a zone is refused with a valid example", () => {
    expect(() => parseConfig("dashboard:\n  timeZone: Europe/Brusels\n")).toThrow(
      'sluiceway.yaml is not valid:\n- dashboard.timeZone: "Europe/Brusels" is not a time zone. Write an IANA name, such as Europe/Brussels or America/New_York, or leave the key out for UTC.',
    );
  });

  test("attribution.names is a whole number from 0 to 20", () => {
    expect(parseConfig("attribution:\n  names: 0\n").attribution.names).toBe(0);
    expect(parseConfig("attribution:\n  names: 20\n").attribution.names).toBe(20);
    for (const [value, read] of [
      ["-1", -1],
      ["21", 21],
      ["2.5", 2.5],
      ['"five"', "five"],
    ] as const) {
      expect(issues(`attribution:\n  names: ${value}\n`)).toEqual([
        {
          kind: "not-a-count",
          counts: "names",
          min: 0,
          max: 20,
          value: read,
          path: ["attribution", "names"],
        },
      ]);
    }
  });

  test("a glob must be text that is not empty", () => {
    expect(issues('ignore: [""]\nscan:\n  unrelated: [3]\n')).toEqual([
      { kind: "empty", path: ["ignore", 0] },
      { kind: "wrong-type", expected: "string", value: 3, path: ["scan", "unrelated", 0] },
    ]);
  });

  test("title and label must not be empty", () => {
    expect(issues('dashboard:\n  title: ""\n  label: ""\n')).toEqual([
      { kind: "empty", path: ["dashboard", "title"] },
      { kind: "empty", path: ["dashboard", "label"] },
    ]);
  });
});

describe("a file that is not a mapping", () => {
  test("a list at the top level is refused", () => {
    expect(issues("- a\n- b\n")).toEqual([
      { kind: "wrong-type", expected: "object", value: ["a", "b"], path: [] },
    ]);
  });

  test("broken YAML names the line and the column", () => {
    expect(issues("dashboard:\n  title: [unclosed\n")).toEqual([
      {
        kind: "not-yaml",
        line: 3,
        column: 1,
        detail: "Flow sequence in block collection must be sufficiently indented and end with a ]",
        path: [],
      },
    ]);
  });

  test("a key written twice is refused", () => {
    expect(issues("tickers: admin\ntickers: write\n")).toEqual([
      { kind: "not-yaml", line: 2, column: 1, detail: "Map keys must be unique", path: [] },
    ]);
  });
});

// The seam between the rules and the words: the error a mode reports.
describe("the error", () => {
  test("names the file and lists every problem in words, top to bottom", () => {
    expect(() => parseConfig("tickerz: admin\ndashboard:\n  pin: 1\n")).toThrow(
      'sluiceway.yaml is not valid:\n- unknown key "tickerz". Known keys here: dashboard, tickers, deploys, recordWriters, deployWindows, ignore, scan, drift, valueFingerprint, policies, cost, attribution, phases, stacks, discovery, mergeAndDeploy, notify.\n- dashboard.pin: expected true or false, got 1.',
    );
  });

  test("holds each issue with its words, in the same order", () => {
    try {
      parseConfig('dashboard:\n  pin: 1\ndeploys: "off"\n');
      throw new Error("expected the config to be refused");
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      expect(error.problems).toEqual([
        "dashboard.pin: expected true or false, got 1.",
        'deploys: expected true or false, got "off".',
      ]);
      expect(error.issues.map((issue) => issue.path)).toEqual([["dashboard", "pin"], ["deploys"]]);
    }
  });

  test("takes a problem already in words, such as an adapter's, as it is", () => {
    const error = new ConfigError(["stacks[0].options.x: not an option."], "sluiceway.yml");
    expect(error.issues).toEqual([
      { kind: "worded", text: "stacks[0].options.x: not an option.", path: [] },
    ]);
    expect(error.message).toBe(
      "sluiceway.yml is not valid:\n- stacks[0].options.x: not an option.",
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
    expect(issues('scan:\n  logDiff: "yes"\n')).toEqual([
      { kind: "wrong-type", expected: "boolean", value: "yes", path: ["scan", "logDiff"] },
    ]);
    expect(issues("scan:\n  logdiff: true\n")).toEqual([
      { kind: "unknown-key", key: "logdiff", known: ["unrelated", "logDiff"], path: ["scan"] },
    ]);
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
    expect(issues('ignore:\n  - glob: "apps/legacy:*"\n')).toEqual([
      { kind: "required-ignore-reason", glob: "apps/legacy:*", path: ["ignore", 0, "reason"] },
    ]);
  });

  test("a mapping needs a glob, and neither may be empty", () => {
    expect(issues("ignore:\n  - reason: gone\n")).toEqual([
      { kind: "required-ignore-glob", path: ["ignore", 0, "glob"] },
    ]);
    expect(issues('ignore:\n  - glob: ""\n    reason: ""\n')).toEqual([
      { kind: "empty", path: ["ignore", 0, "glob"] },
      { kind: "empty", path: ["ignore", 0, "reason"] },
    ]);
  });

  test("a mapping takes no other key", () => {
    expect(issues('ignore:\n  - glob: "a:*"\n    reason: gone\n    until: 2027\n')).toEqual([
      { kind: "unknown-key", key: "until", known: ["glob", "reason"], path: ["ignore", 0] },
    ]);
  });

  test("an entry that is neither text nor a mapping is refused", () => {
    expect(issues("ignore:\n  - 3\n")).toEqual([
      { kind: "not-an-ignore-entry", value: 3, path: ["ignore", 0] },
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
    expect(issues('deploys: "off"\n')).toEqual([
      { kind: "wrong-type", expected: "boolean", value: "off", path: ["deploys"] },
    ]);
  });
});

// Slice 5.44 (record 0109): the logins whose open deployment records a
// dispatched or scheduled run deploys. Nobody by default.
describe("recordWriters", () => {
  test("names nobody unless the file does", () => {
    expect(parseConfig(undefined).recordWriters).toEqual([]);
    expect(parseConfig("recordWriters: []\n").recordWriters).toEqual([]);
  });

  test("takes logins of people and of apps, kept once each in lower case", () => {
    expect(
      parseConfig("recordWriters:\n  - Deploy-Bot[bot]\n  - alice\n  - deploy-bot[bot]\n")
        .recordWriters,
    ).toEqual(["deploy-bot[bot]", "alice"]);
  });

  test("a login with an @ or a slash is refused", () => {
    expect(issues("recordWriters: ['@alice', org/bots]\n")).toEqual([
      { kind: "not-a-login", value: "@alice", path: ["recordWriters", 0] },
      { kind: "not-a-login", value: "org/bots", path: ["recordWriters", 1] },
    ]);
  });
});

// Slice 4.2 (record 0054): pull requests by these authors may be merged and
// deployed with one tick. Off by default.
describe("mergeAndDeploy", () => {
  test("is off unless the file names authors", () => {
    expect(parseConfig(undefined).mergeAndDeploy).toEqual({ authors: [], preview: false });
    expect(parseConfig("mergeAndDeploy: {}\n").mergeAndDeploy).toEqual({
      authors: [],
      preview: false,
    });
  });

  test("takes logins of people and of apps, kept once each in lower case", () => {
    expect(
      parseConfig(
        "mergeAndDeploy:\n  authors:\n    - Renovate[bot]\n    - dependabot[bot]\n    - alice\n    - renovate[bot]\n",
      ).mergeAndDeploy.authors,
    ).toEqual(["renovate[bot]", "dependabot[bot]", "alice"]);
  });

  test("a login with an @ or a slash is refused", () => {
    expect(issues("mergeAndDeploy:\n  authors: ['@alice', org/bots]\n")).toEqual([
      { kind: "not-a-login", value: "@alice", path: ["mergeAndDeploy", "authors", 0] },
      { kind: "not-a-login", value: "org/bots", path: ["mergeAndDeploy", "authors", 1] },
    ]);
  });

  test("an unknown key is refused", () => {
    expect(issues("mergeAndDeploy:\n  author: [alice]\n")).toEqual([
      {
        kind: "unknown-key",
        key: "author",
        known: ["authors", "preview"],
        path: ["mergeAndDeploy"],
      },
    ]);
  });

  // Slice 5.4 (record 0071): an extra preview of the branch of each listed
  // update, shown on its row. Off by default.
  test("previews the branches of the updates only when preview is true", () => {
    expect(parseConfig("mergeAndDeploy:\n  preview: true\n").mergeAndDeploy.preview).toBe(true);
    expect(issues("mergeAndDeploy:\n  preview: yes please\n")).toEqual([
      {
        kind: "wrong-type",
        expected: "boolean",
        value: "yes please",
        path: ["mergeAndDeploy", "preview"],
      },
    ]);
  });
});

// Record 0102: the value fingerprint is on for every repo, and a repo or a
// stack entry turns it off.
describe("the value fingerprint switch", () => {
  test("is on by default and can be turned off for the repo", () => {
    expect(parseConfig("").valueFingerprint).toBe(true);
    expect(parseConfig("valueFingerprint: false\n").valueFingerprint).toBe(false);
  });

  test("a stack entry takes it too, and leaves it out when unset", () => {
    expect(parseConfig("stacks:\n  - path: apps/a\n    valueFingerprint: false\n").stacks).toEqual([
      { path: "apps/a", valueFingerprint: false },
    ]);
    expect(parseConfig("stacks:\n  - path: apps/a\n").stacks).toEqual([{ path: "apps/a" }]);
  });

  test("anything but true or false is a config error at the key", () => {
    expect(issues("valueFingerprint: maybe\n").map((issue) => issue.path)).toEqual([
      ["valueFingerprint"],
    ]);
    expect(
      issues("stacks:\n  - path: apps/a\n    valueFingerprint: 1\n").map((issue) => issue.path),
    ).toEqual([["stacks", 0, "valueFingerprint"]]);
  });
});

// Deploy windows (record 0104): when the stacks of a repo may go out, written
// in the dashboard zone. A tick outside a window waits for it.
describe("deployWindows", () => {
  test("is empty unless the file names windows, and empty means always", () => {
    expect(parseConfig(undefined).deployWindows).toEqual([]);
    expect(parseConfig("deployWindows: []\n").deployWindows).toEqual([]);
  });

  test("takes windows of days, a start and an end, as written", () => {
    expect(
      parseConfig(
        'deployWindows:\n  - days: [monday, tuesday, wednesday, thursday]\n    from: "09:00"\n    to: "17:00"\n  - days: [friday]\n    from: "09:00"\n    to: "12:00"\n',
      ).deployWindows,
    ).toEqual([
      { days: ["monday", "tuesday", "wednesday", "thursday"], from: "09:00", to: "17:00" },
      { days: ["friday"], from: "09:00", to: "12:00" },
    ]);
  });

  test("a day is a full name of the week in lower case, and nothing else", () => {
    expect(issues('deployWindows:\n  - days: [mon]\n    from: "09:00"\n    to: "17:00"\n')).toEqual(
      [{ kind: "not-a-weekday", value: "mon", path: ["deployWindows", 0, "days", 0] }],
    );
    expect(issues('deployWindows:\n  - days: []\n    from: "09:00"\n    to: "17:00"\n')).toEqual([
      { kind: "no-days", path: ["deployWindows", 0, "days"] },
    ]);
  });

  test("a start and an end are HH:MM on a 24 hour clock, quoted or not, and a number is refused", () => {
    expect(
      issues('deployWindows:\n  - days: [monday]\n    from: "9am"\n    to: "17:00"\n'),
    ).toEqual([{ kind: "not-a-clock-time", value: "9am", path: ["deployWindows", 0, "from"] }]);
    // YAML 1.2 reads an unquoted 09:00 as text, so the quotes are a habit and
    // not a need. A number is what an older parser would have made of it.
    expect(
      parseConfig("deployWindows:\n  - days: [monday]\n    from: 09:00\n    to: 17:00\n")
        .deployWindows,
    ).toEqual([{ days: ["monday"], from: "09:00", to: "17:00" }]);
    expect(issues("deployWindows:\n  - days: [monday]\n    from: 540\n    to: 17:00\n")).toEqual([
      { kind: "not-a-clock-time", value: 540, path: ["deployWindows", 0, "from"] },
    ]);
  });

  test("the end comes after the start, so a window over midnight is two windows", () => {
    expect(
      issues('deployWindows:\n  - days: [monday]\n    from: "22:00"\n    to: "06:00"\n'),
    ).toEqual([
      { kind: "window-ends-first", from: "22:00", to: "06:00", path: ["deployWindows", 0] },
    ]);
    expect(
      parseConfig(
        'deployWindows:\n  - days: [monday]\n    from: "22:00"\n    to: "24:00"\n  - days: [tuesday]\n    from: "00:00"\n    to: "06:00"\n',
      ).deployWindows,
    ).toHaveLength(2);
  });

  test("a window takes no other key, and every key is required", () => {
    expect(
      issues(
        'deployWindows:\n  - days: [monday]\n    from: "09:00"\n    to: "17:00"\n    zone: UTC\n',
      ),
    ).toEqual([
      {
        kind: "unknown-key",
        key: "zone",
        known: ["days", "from", "to"],
        path: ["deployWindows", 0],
      },
    ]);
    expect(issues("deployWindows:\n  - days: [monday]\n")).toEqual([
      {
        kind: "wrong-type",
        expected: "string",
        value: undefined,
        path: ["deployWindows", 0, "from"],
      },
      {
        kind: "wrong-type",
        expected: "string",
        value: undefined,
        path: ["deployWindows", 0, "to"],
      },
    ]);
  });

  test("a stack entry takes the same list", () => {
    expect(
      parseConfig(
        'stacks:\n  - path: apps/grafana\n    deployWindows:\n      - days: [saturday]\n        from: "10:00"\n        to: "11:00"\n',
      ).stacks[0]?.deployWindows,
    ).toEqual([{ days: ["saturday"], from: "10:00", to: "11:00" }]);
    expect(
      issues(
        'stacks:\n  - path: apps/grafana\n    deployWindows:\n      - days: [monday]\n        from: "17:00"\n        to: "09:00"\n',
      ),
    ).toEqual([
      {
        kind: "window-ends-first",
        from: "17:00",
        to: "09:00",
        path: ["stacks", 0, "deployWindows", 0],
      },
    ]);
  });
});

// The cost estimate (record 0105): off unless a repo opts in, and a
// threshold only next to the switch that turns it on.
describe("cost (record 0105)", () => {
  test("is off by default, and cost.enabled turns it on", () => {
    expect(parseConfig(undefined).cost).toEqual({ enabled: false });
    expect(parseConfig("cost:\n  enabled: true\n").cost).toEqual({ enabled: true });
    expect(parseConfig("cost: {}\n").cost).toEqual({ enabled: false });
  });

  test("a threshold is an amount a month, 0 or more, next to enabled: true", () => {
    expect(parseConfig("cost:\n  enabled: true\n  threshold: 100\n").cost).toEqual({
      enabled: true,
      threshold: 100,
    });
    expect(parseConfig("cost:\n  enabled: true\n  threshold: 0\n").cost).toEqual({
      enabled: true,
      threshold: 0,
    });
    expect(parseConfig("cost:\n  enabled: true\n  threshold: 12.5\n").cost).toEqual({
      enabled: true,
      threshold: 12.5,
    });
  });

  test("a threshold without the switch is refused, so it never gates nothing in silence", () => {
    expect(issues("cost:\n  threshold: 100\n")).toEqual([
      { kind: "cost-threshold-without-enabled", path: ["cost", "threshold"] },
    ]);
    expect(issues("cost:\n  enabled: false\n  threshold: 100\n")).toEqual([
      { kind: "cost-threshold-without-enabled", path: ["cost", "threshold"] },
    ]);
  });

  test("a threshold that is not an amount is refused", () => {
    expect(issues("cost:\n  enabled: true\n  threshold: -1\n")).toEqual([
      { kind: "not-an-amount", value: -1, path: ["cost", "threshold"] },
    ]);
    expect(issues("cost:\n  enabled: true\n  threshold: cheap\n")).toEqual([
      { kind: "not-an-amount", value: "cheap", path: ["cost", "threshold"] },
    ]);
  });

  test("an unknown key under cost lists the known ones", () => {
    expect(issues("cost:\n  enabled: true\n  currency: EUR\n")).toEqual([
      { kind: "unknown-key", key: "currency", known: ["enabled", "threshold"], path: ["cost"] },
    ]);
  });

  test("a stack entry takes the same mapping, key by key", () => {
    expect(
      parseConfig("stacks:\n  - path: apps/a\n    cost:\n      enabled: false\n").stacks,
    ).toEqual([{ path: "apps/a", cost: { enabled: false } }]);
    expect(
      parseConfig("stacks:\n  - path: apps/a\n    cost:\n      threshold: 20\n").stacks,
    ).toEqual([{ path: "apps/a", cost: { threshold: 20 } }]);
    expect(issues("stacks:\n  - path: apps/a\n    cost: true\n")).toEqual([
      { kind: "stack-cost-not-a-mapping", value: true, path: ["stacks", 0, "cost"] },
    ]);
    expect(
      issues("stacks:\n  - path: apps/a\n    cost:\n      enabled: false\n      threshold: 5\n"),
    ).toEqual([
      { kind: "cost-threshold-without-enabled", path: ["stacks", 0, "cost", "threshold"] },
    ]);
    expect(issues("stacks:\n  - path: apps/a\n    cost:\n      threshold: -5\n")).toEqual([
      { kind: "not-an-amount", value: -5, path: ["stacks", 0, "cost", "threshold"] },
    ]);
  });
});
