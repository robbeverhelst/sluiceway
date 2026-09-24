import { describe, expect, test } from "bun:test";
import {
  applyConfig,
  ConfigError,
  type ConfigIssue,
  ignoredStacks,
  parseConfig,
} from "../../src/core/config.ts";
import type { DeployWindow } from "../../src/core/deploy-window.ts";
import type { Stack } from "../../src/core/stack.ts";

const stack = (path: string, name?: string): Stack =>
  name === undefined ? { path, options: {} } : { path, name, options: {} };

const FOUND = [stack("apps/grafana", "dev"), stack("apps/grafana", "prod"), stack("envs/prod")];

// The issues as facts. Their words are test/render/config-problems.test.ts's.
function issues(text: string, stacks: Stack[]): ConfigIssue[] {
  try {
    applyConfig(parseConfig(text), stacks);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("expected the config to be refused");
}

describe("zero config", () => {
  test("every stack gets the defaults, in the order discovery gave", () => {
    expect(applyConfig(parseConfig(undefined), FOUND)).toEqual(
      FOUND.map((found) => ({
        stack: found,
        environment: "sluiceway",
        tickers: "write",
        inputs: [],
      })),
    );
  });

  test("no stacks and no config is fine", () => {
    expect(applyConfig(parseConfig(undefined), [])).toEqual([]);
  });
});

describe("the top level tick rule", () => {
  test("is the default for every stack", () => {
    const configured = applyConfig(parseConfig("tickers: [Alice]\n"), FOUND);
    expect(configured.map((one) => one.tickers)).toEqual([["alice"], ["alice"], ["alice"]]);
  });
});

describe("a stacks entry", () => {
  test("with a name sets only that stack", () => {
    const configured = applyConfig(
      parseConfig(`
tickers: maintain
stacks:
  - path: apps/grafana
    name: prod
    environment: production
    tickers: admin
    inputs: ["shared/**"]
    previewTimeout: 25
`),
      FOUND,
    );
    expect(configured).toEqual([
      { stack: FOUND[0] as Stack, environment: "sluiceway", tickers: "maintain", inputs: [] },
      {
        stack: FOUND[1] as Stack,
        environment: "production",
        tickers: "admin",
        inputs: ["shared/**"],
        previewTimeout: 25,
      },
      { stack: FOUND[2] as Stack, environment: "sluiceway", tickers: "maintain", inputs: [] },
    ]);
  });

  test("without a name covers every stack in the path", () => {
    const configured = applyConfig(
      parseConfig("stacks:\n  - path: apps/grafana\n    environment: grafana\n"),
      FOUND,
    );
    expect(configured.map((one) => one.environment)).toEqual(["grafana", "grafana", "sluiceway"]);
  });

  test("without a name matches a stack that has no name", () => {
    const configured = applyConfig(
      parseConfig("stacks:\n  - path: envs/prod\n    previewTimeout: 3\n"),
      FOUND,
    );
    expect(configured.map((one) => one.previewTimeout)).toEqual([undefined, undefined, 3]);
  });

  test("with a name wins over the entry for the whole path, key by key, in any order", () => {
    const configured = applyConfig(
      parseConfig(`
stacks:
  - path: apps/grafana
    name: prod
    tickers: admin
    inputs: ["prod-only/**", "shared/**"]
  - path: apps/grafana
    environment: grafana
    tickers: maintain
    inputs: ["shared/**"]
`),
      FOUND,
    );
    expect(configured.slice(0, 2)).toEqual([
      {
        stack: FOUND[0] as Stack,
        environment: "grafana",
        tickers: "maintain",
        inputs: ["shared/**"],
      },
      {
        stack: FOUND[1] as Stack,
        environment: "grafana",
        tickers: "admin",
        inputs: ["shared/**", "prod-only/**"],
      },
    ]);
  });

  test("never creates a stack: one that matches nothing is a config error", () => {
    expect(
      issues(
        "stacks:\n  - path: apps/loki\n  - path: apps/grafana\n    name: staging\n  - path: envs/prod\n    name: prod\n",
        FOUND,
      ),
    ).toEqual([
      { kind: "entry-no-stack", stackPath: "apps/loki", path: ["stacks", 0] },
      {
        kind: "entry-no-named-stack",
        name: "staging",
        stackPath: "apps/grafana",
        names: ["dev", "prod"],
        path: ["stacks", 1],
      },
      {
        kind: "entry-no-named-stack",
        name: "prod",
        stackPath: "envs/prod",
        names: [],
        path: ["stacks", 2],
      },
    ]);
  });

  test("does not match a directory inside its path", () => {
    expect(issues("stacks:\n  - path: apps\n", FOUND)).toEqual([
      { kind: "entry-no-stack", stackPath: "apps", path: ["stacks", 0] },
    ]);
  });
});

describe("ignore", () => {
  test("an ignored stack is dropped before any entry sees it", () => {
    const configured = applyConfig(parseConfig('ignore: ["**/*:dev"]\n'), FOUND);
    expect(configured.map((one) => one.stack)).toEqual([
      stack("apps/grafana", "prod"),
      stack("envs/prod"),
    ]);
  });

  test("an entry for a path still works when only some of its stacks are ignored", () => {
    const text =
      'ignore: ["**/*:dev"]\nstacks:\n  - path: apps/grafana\n    environment: monitoring\n';
    const configured = applyConfig(parseConfig(text), FOUND);
    expect(configured.map((one) => one.environment)).toEqual(["monitoring", "sluiceway"]);
  });

  test("an entry that only names ignored stacks is a config error that says so", () => {
    const text = [
      'ignore: ["apps/grafana:dev", "envs/**"]',
      "stacks:",
      "  - path: apps/grafana",
      "    name: dev",
      "  - path: envs/prod",
      "",
    ].join("\n");
    expect(issues(text, FOUND)).toEqual([
      { kind: "entry-only-ignored", stackIds: ["apps/grafana:dev"], path: ["stacks", 0] },
      { kind: "entry-only-ignored", stackIds: ["envs/prod"], path: ["stacks", 1] },
    ]);
  });

  test("two stacks with one id are refused here too", () => {
    expect(() =>
      applyConfig(parseConfig(undefined), [stack("apps", "web:prod"), stack("apps:web", "prod")]),
    ).toThrow('two stacks have the id "apps:web:prod"');
  });
});

// Slice 2.20 (record 0051): the stacks an entry with a reason leaves out,
// for the fold under In sync.
describe("ignored stacks with a reason", () => {
  const found = [...FOUND, stack("apps/legacy", "prod"), stack("apps/legacy", "dev")];

  test("each stack an entry with a reason leaves out, with that reason, by stack id", () => {
    const config = parseConfig(`
ignore:
  - glob: "apps/legacy:*"
    reason: Deployed by the platform team
`);
    expect(ignoredStacks(config, found)).toEqual([
      { stackId: "apps/legacy:dev", reason: "Deployed by the platform team" },
      { stackId: "apps/legacy:prod", reason: "Deployed by the platform team" },
    ]);
    expect(applyConfig(config, found).map(({ stack: one }) => one.path)).not.toContain(
      "apps/legacy",
    );
  });

  test("a glob as text lists nothing, and the first entry that matches decides", () => {
    const config = parseConfig(`
ignore:
  - "**/*:dev"
  - glob: "apps/*:*"
    reason: Not ours
`);
    expect(ignoredStacks(config, found)).toEqual([
      { stackId: "apps/grafana:prod", reason: "Not ours" },
      { stackId: "apps/legacy:prod", reason: "Not ours" },
    ]);
  });

  test("no entry with a reason, nothing listed", () => {
    expect(ignoredStacks(parseConfig('ignore: ["apps/legacy:*"]'), found)).toEqual([]);
    expect(ignoredStacks(parseConfig(undefined), found)).toEqual([]);
  });
});

// Drift per stack (slice 4.7, record 0059): a stack entry turns the drift
// check on or off for its stacks, and the entry with a name wins.
describe("drift on a stack", () => {
  test("is absent when no entry sets it, so the top level decides", () => {
    expect(
      applyConfig(parseConfig("drift:\n  enabled: true\n"), FOUND).map((one) => one.drift),
    ).toEqual([undefined, undefined, undefined]);
  });

  test("an entry sets its stacks, and the entry with a name wins", () => {
    const configured = applyConfig(
      parseConfig(`
stacks:
  - path: apps/grafana
    name: prod
    drift:
      enabled: true
  - path: apps/grafana
    drift:
      enabled: false
`),
      FOUND,
    );
    expect(configured.map((one) => one.drift)).toEqual([false, true, undefined]);
  });
});

// Deploy on merge (record 0095): a stack entry may say that its stacks go out
// on merge. The default stays a tick, and a stack no entry sets carries no
// key at all, so a repo that does not use it is what it was.
describe("deploy on a stack", () => {
  test("is absent when no entry sets it: a person ticks", () => {
    expect(applyConfig(parseConfig(undefined), FOUND).map((one) => one.deploy)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("on-tick written out is the default, and leaves no key either", () => {
    const configured = applyConfig(
      parseConfig("stacks:\n  - path: envs/prod\n    deploy: on-tick\n"),
      FOUND,
    );
    expect(configured.map((one) => "deploy" in one)).toEqual([false, false, false]);
  });

  test("an entry sets its stacks, and the entry with a name wins", () => {
    const configured = applyConfig(
      parseConfig(`
stacks:
  - path: apps/grafana
    deploy: on-merge
  - path: apps/grafana
    name: prod
    deploy: on-tick
`),
      FOUND,
    );
    expect(configured.map((one) => one.deploy)).toEqual(["on-merge", undefined, undefined]);
  });

  test("any other value fails the config, because a typo would change what deploys without a person", () => {
    expect(() => parseConfig("stacks:\n  - path: envs/prod\n    deploy: on-push\n")).toThrow(
      'stacks[0].deploy: expected "on-tick" or "on-merge", got "on-push".',
    );
    expect(() => parseConfig("stacks:\n  - path: envs/prod\n    deploy: true\n")).toThrow(
      'stacks[0].deploy: expected "on-tick" or "on-merge", got true.',
    );
  });
});

// The value fingerprint per stack (record 0102): a stack entry turns it off or
// on for its stacks, and the entry with a name wins.
describe("the value fingerprint on a stack", () => {
  test("is absent when no entry sets it, so the top level decides", () => {
    expect(
      applyConfig(parseConfig("valueFingerprint: false\n"), FOUND).map(
        (one) => one.valueFingerprint,
      ),
    ).toEqual([undefined, undefined, undefined]);
  });

  test("an entry sets its stacks, and the entry with a name wins", () => {
    const configured = applyConfig(
      parseConfig(`
stacks:
  - path: apps/grafana
    name: prod
    valueFingerprint: true
  - path: apps/grafana
    valueFingerprint: false
`),
      FOUND,
    );
    expect(configured.map((one) => one.valueFingerprint)).toEqual([false, true, undefined]);
  });
});

// Slice 5.38 (record 0103): a stack may name the env file its tool gets,
// on top of the job's environment and the step's own file.
describe("the env file of a stack", () => {
  test("is absent when no entry names one, so the stack gets the environment of the step", () => {
    expect(applyConfig(parseConfig(undefined), FOUND).map((one) => one.envFile)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("an entry names the file of its stacks, and the entry with a name wins", () => {
    const configured = applyConfig(
      parseConfig(`
stacks:
  - path: apps/grafana
    name: prod
    envFile: ci/grafana-prod.env
  - path: apps/grafana
    envFile: ci/grafana.env
  - path: envs/prod
    envFile: /srv/credentials/prod.env
`),
      FOUND,
    );
    expect(configured.map((one) => one.envFile)).toEqual([
      "ci/grafana.env",
      "ci/grafana-prod.env",
      "/srv/credentials/prod.env",
    ]);
  });
});

// Deploy windows (record 0104): the top level sets the windows of every
// stack, an entry sets its own, and an entry with an empty list lets its
// stacks go out at any time. A stack with no window carries no key, so a
// repo without windows is what it was.
describe("deploy windows on a stack", () => {
  const WINDOW: DeployWindow = { days: ["monday"], from: "09:00", to: "17:00" };
  const SATURDAY: DeployWindow = { days: ["saturday"], from: "10:00", to: "11:00" };

  test("are absent when neither the top level nor an entry names any", () => {
    expect(applyConfig(parseConfig(undefined), FOUND).map((one) => "deployWindows" in one)).toEqual(
      [false, false, false],
    );
    expect(
      applyConfig(parseConfig("deployWindows: []\n"), FOUND).map((one) => "deployWindows" in one),
    ).toEqual([false, false, false]);
  });

  test("the top level gives every stack its windows", () => {
    const configured = applyConfig(
      parseConfig('deployWindows:\n  - days: [monday]\n    from: "09:00"\n    to: "17:00"\n'),
      FOUND,
    );
    expect(configured.map((one) => one.deployWindows)).toEqual([[WINDOW], [WINDOW], [WINDOW]]);
  });

  test("an entry replaces the top level for its stacks, and an empty list lifts every window", () => {
    const configured = applyConfig(
      parseConfig(`
deployWindows:
  - days: [monday]
    from: "09:00"
    to: "17:00"
stacks:
  - path: apps/grafana
    deployWindows:
      - days: [saturday]
        from: "10:00"
        to: "11:00"
  - path: apps/grafana
    name: prod
    deployWindows: []
`),
      FOUND,
    );
    expect(configured.map((one) => one.deployWindows)).toEqual([[SATURDAY], undefined, [WINDOW]]);
  });
});

// Policies (record 0106): `policies` at the top level names the directories
// of Rego policies every pending stack is tested against, and an entry's
// `policies` add to that for its stacks, the way inputs add up.
describe("the policies of a stack", () => {
  test("none by default, and the key is absent so a repo without policies changes nothing", () => {
    expect(applyConfig(parseConfig(undefined), FOUND).map((one) => one.policies)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("the top level names them for every stack, as written, each once", () => {
    const configured = applyConfig(
      parseConfig("policies: [policies, ./policies/common/, policies]\n"),
      FOUND,
    );
    expect(configured.map((one) => one.policies)).toEqual([
      ["policies", "policies/common"],
      ["policies", "policies/common"],
      ["policies", "policies/common"],
    ]);
  });

  test("an entry adds its own for its stacks, after the top level ones", () => {
    const configured = applyConfig(
      parseConfig(`
policies: [policies]
stacks:
  - path: apps/grafana
    name: prod
    policies: [policies/prod]
  - path: apps/grafana
    policies: [policies/apps, policies]
`),
      FOUND,
    );
    expect(configured.map((one) => one.policies)).toEqual([
      ["policies", "policies/apps"],
      ["policies", "policies/apps", "policies/prod"],
      ["policies"],
    ]);
    expect(
      applyConfig(parseConfig("stacks:\n  - path: envs/prod\n    policies: [p]\n"), FOUND).map(
        (one) => one.policies,
      ),
    ).toEqual([undefined, undefined, ["p"]]);
  });

  test("a path outside the repo, an absolute one and a backslash are refused as a stack path is", () => {
    expect(issues("policies: [/etc/policies]\n", FOUND)).toEqual([
      { kind: "absolute-path", value: "/etc/policies", path: ["policies", 0] },
    ]);
    expect(issues("policies: [../shared]\n", FOUND)).toEqual([
      { kind: "path-leaves-repo", value: "../shared", path: ["policies", 0] },
    ]);
    expect(issues("stacks:\n  - path: envs/prod\n    policies: ['a\\\\b']\n", FOUND)).toEqual([
      { kind: "backslash-in-path", value: "a\\\\b", path: ["stacks", 0, "policies", 0] },
    ]);
  });

  test("a value that is not a list of paths is refused", () => {
    expect(() => parseConfig("policies: policies\n")).toThrow("policies: expected a list");
  });
});

// Slice 5.42 (record 0107): a stack entry may ask the scan to create its
// stacks in the backend when it lacks them. Off unless an entry says so.
describe("creating a stack in the backend", () => {
  test("is absent when no entry asks, so nothing is ever created", () => {
    expect(applyConfig(parseConfig(undefined), FOUND).map((one) => one.createInBackend)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("an entry asks for its stacks, and the entry with a name wins", () => {
    const configured = applyConfig(
      parseConfig(`
stacks:
  - path: apps/grafana
    name: prod
    createInBackend: false
  - path: apps/grafana
    createInBackend: true
`),
      FOUND,
    );
    expect(configured.map((one) => one.createInBackend)).toEqual([true, undefined, undefined]);
  });

  test("the key is true or false", () => {
    expect(() => parseConfig("stacks:\n  - path: envs/prod\n    createInBackend: yes\n")).toThrow(
      "stacks[0].createInBackend: expected true or false",
    );
  });
});

// The cost estimate per stack (record 0105): an entry turns it on or off for
// its stacks and sets its own threshold, the entry with a name wins key by
// key, and a threshold on a stack whose estimate is off is refused.
describe("cost on a stack", () => {
  test("is absent when no entry sets it, so the top level decides", () => {
    expect(
      applyConfig(parseConfig("cost:\n  enabled: true\n  threshold: 50\n"), FOUND).map(
        (one) => one.cost,
      ),
    ).toEqual([undefined, undefined, undefined]);
  });

  test("an entry sets its stacks key by key, and the entry with a name wins", () => {
    const configured = applyConfig(
      parseConfig(`
cost:
  enabled: true
stacks:
  - path: apps/grafana
    name: prod
    cost:
      enabled: true
      threshold: 200
  - path: apps/grafana
    cost:
      enabled: false
`),
      FOUND,
    );
    expect(configured.map((one) => one.cost)).toEqual([
      { enabled: false },
      { enabled: true, threshold: 200 },
      undefined,
    ]);
  });

  test("a threshold on a stack whose estimate is off is refused, naming the entry", () => {
    expect(
      issues("stacks:\n  - path: apps/grafana\n    cost:\n      threshold: 10\n", FOUND),
    ).toEqual([
      { kind: "cost-threshold-without-enabled", path: ["stacks", 0, "cost", "threshold"] },
    ]);
    expect(
      issues(
        "cost:\n  enabled: true\nstacks:\n  - path: apps/grafana\n    name: prod\n    cost:\n      enabled: false\n  - path: apps/grafana\n    cost:\n      threshold: 10\n",
        FOUND,
      ),
    ).toEqual([
      { kind: "cost-threshold-without-enabled", path: ["stacks", 1, "cost", "threshold"] },
    ]);
  });
});
