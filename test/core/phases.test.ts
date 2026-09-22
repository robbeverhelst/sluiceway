import { describe, expect, test } from "bun:test";
import { applyConfig, ConfigError, parseConfig } from "../../src/core/config.ts";
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

function problems(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
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
      problems(() =>
        parseConfig("phases: [infrastructure]\nstacks:\n  - path: app\n    phase: aplications\n"),
      ),
    ).toEqual([
      'stacks[0].phase: "aplications" is not one of the phases. The phases are: infrastructure.',
    ]);
  });

  test("a phase without a phases list", () => {
    expect(
      problems(() => parseConfig("stacks:\n  - path: app\n    phase: infrastructure\n")),
    ).toEqual([
      'stacks[0].phase: "infrastructure" is not one of the phases, and sluiceway.yaml has no phases. List them in order at the top: phases: [first, second].',
    ]);
  });

  test("a phase named twice", () => {
    expect(problems(() => parseConfig("phases: [infrastructure, apps, infrastructure]\n"))).toEqual(
      ['phases[2]: "infrastructure" is already phases[0]. Each phase is named once.'],
    );
  });

  test("a phase name that is not a plain word", () => {
    expect(problems(() => parseConfig('phases: ["infra structure"]\n'))).toEqual([
      'phases[0]: "infra structure" is not a phase name. Use letters, digits, ".", "_" and "-".',
    ]);
  });

  test("a phase that is not a name or a mapping", () => {
    expect(
      problems(() => parseConfig("phases: [a]\nstacks:\n  - path: app\n    phase: [a]\n")),
    ).toEqual(["stacks[0].phase: expected a phase name, or a mapping with from, got a list."]);
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
    expect(problems(() => configured(text))).toEqual([
      'stacks[1].dependsOn[0]: "app:prod" is in the applications phase, which comes after the infrastructure phase of network:prod. app:prod already waits on every stack of the infrastructure phase, so take this out, or move one of them to another phase.',
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
    expect(problems(() => configured(text))).toEqual([
      "dependsOn goes round in a circle: app:prod waits on the infrastructure phase, which holds network:dev, which depends on site:prod, which depends on app:prod. Nothing in a circle could ever deploy first, so take one of these out.",
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
    expect(problems(() => configured(text, KEYED))).toEqual([
      "stacks[0].phase: site:prod has no text under example:phase in its project file, under config or at the top level. Add it there, or name the phase here.",
    ]);
  });

  test("a value that names no phase is refused, without quoting it", () => {
    const text =
      "phases: [infrastructure]\nstacks:\n  - path: app\n    phase: { from: example:phase }\n";
    expect(problems(() => configured(text, KEYED))).toEqual([
      "stacks[0].phase: the text under example:phase in the project file of app:prod is not one of the phases. The phases are: infrastructure.",
    ]);
  });

  test("from must not be empty, and nothing else goes in the mapping", () => {
    expect(
      problems(() =>
        parseConfig('phases: [a]\nstacks:\n  - path: app\n    phase: { from: "", at: x }\n'),
      ),
    ).toEqual([
      "stacks[0].phase.from: must not be empty.",
      'stacks[0].phase: unknown key "at". Known keys here: from.',
    ]);
  });
});
