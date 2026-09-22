import { describe, expect, test } from "bun:test";
import { applyConfig, ConfigError, type ConfigIssue, parseConfig } from "../../src/core/config.ts";
import type { Stack } from "../../src/core/stack.ts";

// Phases (slice 4.16, record 0067): `phases` is an ordered list of names, and
// a stack says which one it is in. A stack in a phase depends on every stack
// in every earlier phase, and `dependsOn` adds to that.

const stack = (path: string, name?: string, phaseKeys?: Record<string, string>): Stack => ({
  path,
  ...(name === undefined ? {} : { name }),
  options: {},
  ...(phaseKeys === undefined ? {} : { phaseKeys }),
});

const FOUND = [
  stack("network", "dev"),
  stack("network", "prod"),
  stack("app", "prod"),
  stack("site", "prod"),
];

const THREE = `phases: [infrastructure, monitoring, applications]
stacks:
  - path: network
    phase: infrastructure
  - path: app
    phase: monitoring
  - path: site
    phase: applications
`;

function configured(text: string, found = FOUND) {
  return applyConfig(parseConfig(text), found);
}

// The issues as facts. Their words are test/render/config-problems.test.ts's.
function issues(run: () => unknown): ConfigIssue[] {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error("expected the config to be refused");
}

const byId = (text: string, found = FOUND) =>
  Object.fromEntries(
    configured(text, found).map((one) => [
      `${one.stack.path}:${one.stack.name}`,
      { phase: one.phase, dependsOn: one.dependsOn },
    ]),
  );

describe("phases", () => {
  test("default to none, and no stack has a phase", () => {
    expect(parseConfig("").phases).toEqual([]);
    expect(configured("").every((one) => one.phase === undefined)).toBe(true);
  });

  test("a stack depends on every stack in every earlier phase", () => {
    expect(byId(THREE)).toEqual({
      "network:dev": { phase: "infrastructure", dependsOn: undefined },
      "network:prod": { phase: "infrastructure", dependsOn: undefined },
      "app:prod": { phase: "monitoring", dependsOn: ["network:dev", "network:prod"] },
      "site:prod": {
        phase: "applications",
        dependsOn: ["app:prod", "network:dev", "network:prod"],
      },
    });
  });

  test("dependsOn adds to the phase, inside a phase too", () => {
    const text = `phases: [infrastructure, applications]
stacks:
  - path: network
    phase: infrastructure
  - path: network
    name: prod
    dependsOn: [network:dev]
  - path: app
    phase: applications
    dependsOn: [site:prod]
`;
    expect(byId(text)).toEqual({
      "network:dev": { phase: "infrastructure", dependsOn: undefined },
      "network:prod": { phase: "infrastructure", dependsOn: ["network:dev"] },
      "app:prod": {
        phase: "applications",
        dependsOn: ["network:dev", "network:prod", "site:prod"],
      },
      "site:prod": { phase: undefined, dependsOn: undefined },
    });
  });

  test("a stack without a phase neither waits on a phase nor holds one back", () => {
    const text =
      "phases: [infrastructure, applications]\nstacks:\n  - path: app\n    phase: applications\n";
    expect(byId(text)["app:prod"]).toEqual({ phase: "applications", dependsOn: undefined });
  });

  test("an entry with a name wins over one without", () => {
    const text = `phases: [infrastructure, applications]
stacks:
  - path: network
    phase: applications
  - path: network
    name: dev
    phase: infrastructure
`;
    expect(byId(text)).toMatchObject({
      "network:dev": { phase: "infrastructure", dependsOn: undefined },
      "network:prod": { phase: "applications", dependsOn: ["network:dev"] },
    });
  });

  test("a phase with no stack is skipped over", () => {
    const text = `phases: [infrastructure, empty, applications]
stacks:
  - path: network
    phase: infrastructure
  - path: app
    phase: applications
`;
    expect(byId(text)["app:prod"]?.dependsOn).toEqual(["network:dev", "network:prod"]);
  });
});

describe("phases refused at load", () => {
  test("an unknown phase", () => {
    expect(
      issues(() =>
        parseConfig("phases: [infrastructure]\nstacks:\n  - path: app\n    phase: aplications\n"),
      ),
    ).toEqual([
      {
        kind: "unknown-phase",
        phase: "aplications",
        phases: ["infrastructure"],
        path: ["stacks", 0, "phase"],
      },
    ]);
  });

  test("a phase without a phases list", () => {
    expect(
      issues(() => parseConfig("stacks:\n  - path: app\n    phase: infrastructure\n")),
    ).toEqual([
      { kind: "unknown-phase", phase: "infrastructure", phases: [], path: ["stacks", 0, "phase"] },
    ]);
  });

  test("a phase named twice", () => {
    expect(issues(() => parseConfig("phases: [infrastructure, apps, infrastructure]\n"))).toEqual([
      { kind: "phase-named-twice", phase: "infrastructure", first: 0, path: ["phases", 2] },
    ]);
  });

  test("a phase name that is not a plain word", () => {
    expect(issues(() => parseConfig('phases: ["infra structure"]\n'))).toEqual([
      { kind: "not-a-phase-name", value: "infra structure", path: ["phases", 0] },
    ]);
  });

  test("a phase that is not a name or a mapping", () => {
    expect(
      issues(() => parseConfig("phases: [a]\nstacks:\n  - path: app\n    phase: [a]\n")),
    ).toEqual([{ kind: "not-a-phase", value: ["a"], path: ["stacks", 0, "phase"] }]);
  });

  test("a dependsOn on a stack of a later phase is a circle through the phases", () => {
    const text = `phases: [infrastructure, applications]
stacks:
  - path: network
    phase: infrastructure
  - path: network
    name: prod
    dependsOn: [app:prod]
  - path: app
    phase: applications
`;
    expect(issues(() => configured(text))).toEqual([
      {
        kind: "depends-on-earlier-phase",
        stackId: "app:prod",
        phase: "applications",
        stack: "network:prod",
        stackPhase: "infrastructure",
        path: ["stacks", 1, "dependsOn", 0],
      },
    ]);
  });

  test("a circle through a stack without a phase names the phase", () => {
    const text = `phases: [infrastructure, applications]
stacks:
  - path: network
    name: dev
    phase: infrastructure
    dependsOn: [site:prod]
  - path: site
    dependsOn: [app:prod]
  - path: app
    phase: applications
`;
    expect(issues(() => configured(text))).toEqual([
      {
        kind: "depends-on-circle",
        circle: [
          { stack: "app:prod" },
          { phase: "infrastructure" },
          { stack: "network:dev" },
          { stack: "site:prod" },
          { stack: "app:prod" },
        ],
        path: [],
      },
    ]);
  });
});

describe("phase: from", () => {
  const KEYED = [
    stack("network", "dev", { "example:phase": "infrastructure" }),
    stack("network", "prod", { "example:phase": "infrastructure" }),
    stack("app", "prod", { "example:phase": "applications" }),
    stack("site", "prod"),
  ];

  test("reads the phase from a key of the tool's own file", () => {
    const text =
      "phases: [infrastructure, applications]\nstacks:\n  - path: network\n    phase: { from: example:phase }\n  - path: app\n    phase:\n      from: example:phase\n";
    expect(byId(text, KEYED)).toMatchObject({
      "network:dev": { phase: "infrastructure", dependsOn: undefined },
      "app:prod": { phase: "applications", dependsOn: ["network:dev", "network:prod"] },
    });
    expect(configured(text, KEYED).find((one) => one.stack.path === "app")?.phaseFrom).toBe(
      "example:phase",
    );
  });

  test("a stack whose file has no such key is refused", () => {
    const text =
      "phases: [infrastructure]\nstacks:\n  - path: site\n    phase: { from: example:phase }\n";
    expect(issues(() => configured(text, KEYED))).toEqual([
      {
        kind: "no-phase-key",
        stackId: "site:prod",
        key: "example:phase",
        path: ["stacks", 0, "phase"],
      },
    ]);
  });

  test("a value that names no phase is refused, without quoting it", () => {
    const text =
      "phases: [infrastructure]\nstacks:\n  - path: app\n    phase: { from: example:phase }\n";
    // The issue holds no value to quote: it is a value of the tool's file.
    expect(issues(() => configured(text, KEYED))).toEqual([
      {
        kind: "phase-key-unknown",
        stackId: "app:prod",
        key: "example:phase",
        phases: ["infrastructure"],
        path: ["stacks", 0, "phase"],
      },
    ]);
  });

  test("from must not be empty, and nothing else goes in the mapping", () => {
    expect(
      issues(() =>
        parseConfig('phases: [a]\nstacks:\n  - path: app\n    phase: { from: "", at: x }\n'),
      ),
    ).toEqual([
      { kind: "empty", path: ["stacks", 0, "phase", "from"] },
      { kind: "unknown-key", key: "at", known: ["from"], path: ["stacks", 0, "phase"] },
    ]);
  });
});
