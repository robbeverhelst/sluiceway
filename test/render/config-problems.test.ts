import { describe, expect, test } from "bun:test";
import type { ConfigIssue } from "../../src/core/config.ts";
import { configErrorText, configProblemText } from "../../src/render/config-problems.ts";

// The words of each config issue. Which issues a file has is the rules'
// business, and test/core/config.test.ts and its neighbours test that.

const text = configProblemText;

describe("where a problem is", () => {
  test("the path leads, with indexes in brackets, and the file itself has none", () => {
    expect(text({ kind: "empty", path: ["stacks", 0, "name"] })).toBe(
      "stacks[0].name: must not be empty.",
    );
    expect(text({ kind: "empty", path: ["ignore", 0] })).toBe("ignore[0]: must not be empty.");
    expect(text({ kind: "wrong-type", expected: "object", value: [], path: [] })).toBe(
      "expected a mapping, got a list.",
    );
  });
});

describe("the whole error", () => {
  test("names the file and lists every problem", () => {
    expect(configErrorText("sluiceway.yml", ["one.", "two."])).toBe(
      "sluiceway.yml is not valid:\n- one.\n- two.",
    );
  });
});

describe("the file", () => {
  test("broken YAML names the line and the column, and the parser's words", () => {
    expect(
      text({ kind: "not-yaml", line: 2, column: 1, detail: "Map keys must be unique", path: [] }),
    ).toBe("line 2, column 1: not valid YAML. Map keys must be unique");
  });

  test("both spellings, and a directory", () => {
    expect(
      text({ kind: "two-config-files", files: ["sluiceway.yaml", "sluiceway.yml"], path: [] }),
    ).toBe("found both sluiceway.yaml and sluiceway.yml. Keep one of them.");
    expect(text({ kind: "not-a-file", path: [] })).toBe("it is not a file.");
  });
});

describe("keys", () => {
  test("an unknown key lists the known ones", () => {
    expect(text({ kind: "unknown-key", key: "enable", known: ["enabled"], path: ["drift"] })).toBe(
      'drift: unknown key "enable". Known keys here: enabled.',
    );
    expect(text({ kind: "unknown-key", key: "tickerz", known: ["a", "b"], path: [] })).toBe(
      'unknown key "tickerz". Known keys here: a, b.',
    );
  });

  test("drift.schedule says where the cron goes", () => {
    expect(text({ kind: "drift-schedule", path: ["drift"] })).toBe(
      'drift: "schedule" is not a key of sluiceway.yaml. A drift check runs in every scan that a schedule starts, so the cron goes in the workflow, under `on: schedule`.',
    );
  });

  test("an unknown key under notify says where a channel goes", () => {
    expect(
      text({ kind: "notify-unknown-key", key: "slack", known: ["events"], path: ["notify"] }),
    ).toBe(
      'notify: unknown key "slack". Known keys here: events. A channel is an input of the step, from a secret, never a key of sluiceway.yaml.',
    );
  });

  test("a reserved key is not in this version yet", () => {
    expect(text({ kind: "reserved-key", key: "later", path: ["stacks", 0] })).toBe(
      'stacks[0]: "later" is not in this version of Sluiceway yet. Remove it.',
    );
  });

  test("a stack entry that takes no options", () => {
    expect(
      text({ kind: "option-without-tool", option: "refresh", path: ["stacks", 0, "options"] }),
    ).toBe(
      'stacks[0].options: unknown option "refresh". A stack that discovery finds from its files takes no options. Only an entry with tool takes them.',
    );
  });
});

describe("required and empty", () => {
  test("each required key says what it is for", () => {
    expect(text({ kind: "required-stack-path", path: ["stacks", 0, "path"] })).toBe(
      "stacks[0].path: is required. It is the directory of the stack, relative to the repo root.",
    );
    expect(
      text({
        kind: "required-ignore-reason",
        glob: "apps/legacy:*",
        path: ["ignore", 0, "reason"],
      }),
    ).toBe(
      'ignore[0].reason: is required. Say why the stack is left out, or write the glob as text: "apps/legacy:*".',
    );
    expect(text({ kind: "required-ignore-glob", path: ["ignore", 0, "glob"] })).toBe(
      "ignore[0].glob: is required. It is matched against the stack id.",
    );
  });

  test("an empty list of tickers, an empty path and any other empty text", () => {
    expect(text({ kind: "no-tickers", path: ["tickers"] })).toBe(
      "tickers: the list is empty, so nobody could tick. Name at least one username or use a level.",
    );
    expect(text({ kind: "empty-stack-path", path: ["stacks", 4, "path"] })).toBe(
      'stacks[4].path: must not be empty. Use "." for the repo root.',
    );
    expect(text({ kind: "empty", path: ["dashboard", "title"] })).toBe(
      "dashboard.title: must not be empty.",
    );
  });
});

describe("values", () => {
  test("a value from the file is quoted back as a person would recognise it", () => {
    const got = (value: unknown) =>
      text({ kind: "wrong-type", expected: "string", value, path: ["x"] });
    expect(got(5)).toBe("x: expected text, got 5.");
    expect(got("yes")).toBe('x: expected text, got "yes".');
    expect(got(null)).toBe("x: expected text, got nothing.");
    expect(got(undefined)).toBe("x: expected text, got nothing.");
    expect(got([1])).toBe("x: expected text, got a list.");
    expect(got({ a: 1 })).toBe("x: expected text, got a mapping.");
  });

  test("the types are named in plain words, and an unforeseen one as the library names it", () => {
    const expected = (type: string) =>
      text({ kind: "wrong-type", expected: type, value: 1, path: [] });
    expect(expected("string")).toBe("expected text, got 1.");
    expect(expected("boolean")).toBe("expected true or false, got 1.");
    expect(expected("array")).toBe("expected a list, got 1.");
    expect(expected("object")).toBe("expected a mapping, got 1.");
    expect(expected("bigint")).toBe("expected bigint, got 1.");
  });

  test("a count names what it counts and its range", () => {
    expect(
      text({
        kind: "not-a-count",
        counts: "lines",
        min: 0,
        max: 50,
        value: "ten",
        path: ["dashboard", "recentlyDeployed"],
      }),
    ).toBe('dashboard.recentlyDeployed: expected a whole number of lines from 0 to 50, got "ten".');
    expect(
      text({
        kind: "not-a-count",
        counts: "minutes",
        min: 1,
        value: 2.5,
        path: ["stacks", 0, "previewTimeout"],
      }),
    ).toBe("stacks[0].previewTimeout: expected a whole number of minutes, 1 or more, got 2.5.");
  });

  test("the unions each say both of their forms", () => {
    expect(text({ kind: "not-an-ignore-entry", value: 3, path: ["ignore", 0] })).toBe(
      "ignore[0]: expected a glob as text, or a mapping with glob and reason, got 3.",
    );
    expect(
      text({
        kind: "not-a-depends-on",
        value: "network:prod",
        auto: "auto",
        path: ["stacks", 0, "dependsOn"],
      }),
    ).toBe('stacks[0].dependsOn: expected a list of stack ids, or auto, got "network:prod".');
    expect(text({ kind: "not-a-phase", value: 3, path: ["stacks", 0, "phase"] })).toBe(
      "stacks[0].phase: expected a phase name, or a mapping with from, got 3.",
    );
    expect(text({ kind: "not-a-tick-rule", value: "Admin", path: ["tickers"] })).toBe(
      'tickers: expected "write", "maintain", "admin" or a list of usernames, got "Admin".',
    );
  });

  test("drift on a stack says how the top level writes it, with the value given", () => {
    const drift = (value: unknown) =>
      text({ kind: "stack-drift-not-a-mapping", value, path: ["stacks", 0, "drift"] });
    expect(drift(false)).toBe(
      "stacks[0].drift: expected a mapping, got false. Write it as the top level has it: drift: { enabled: false }.",
    );
    expect(drift([])).toBe(
      "stacks[0].drift: expected a mapping, got a list. Write it as the top level has it: drift: { enabled: true }.",
    );
  });

  test("events, phase names, logins, teams and usernames", () => {
    expect(
      text({
        kind: "not-an-event",
        value: "merged",
        events: ["pending", "failed"],
        path: ["notify", "events", 0],
      }),
    ).toBe('notify.events[0]: "merged" is not an event. The events are: pending, failed.');
    expect(text({ kind: "not-a-phase-name", value: "x y", path: ["phases", 0] })).toBe(
      'phases[0]: "x y" is not a phase name. Use letters, digits, ".", "_" and "-".',
    );
    expect(
      text({ kind: "not-a-login", value: "@alice", path: ["mergeAndDeploy", "authors", 0] }),
    ).toBe(
      'mergeAndDeploy.authors[0]: "@alice" is not a GitHub login. Write the login alone, without "@". An app is written with [bot], such as renovate[bot].',
    );
    expect(text({ kind: "a-team", value: "acme/platform", path: ["tickers", 1] })).toBe(
      'tickers[1]: "acme/platform" looks like a team. Teams are not supported yet. Use a level ("write", "maintain", "admin") or usernames.',
    );
    expect(text({ kind: "not-a-username", value: "@alice", path: ["tickers", 0] })).toBe(
      'tickers[0]: "@alice" is not a GitHub username. Write the login alone, without "@".',
    );
  });

  test("a stack path that leaves the form of a stack id", () => {
    expect(text({ kind: "backslash-in-path", value: "apps\\a", path: ["stacks", 3, "path"] })).toBe(
      'stacks[3].path: "apps\\\\a" must use forward slashes.',
    );
    expect(text({ kind: "absolute-path", value: "/srv/infra", path: ["stacks", 0, "path"] })).toBe(
      'stacks[0].path: "/srv/infra" must be relative to the repo root.',
    );
    expect(text({ kind: "path-leaves-repo", value: "../other", path: ["stacks", 1, "path"] })).toBe(
      'stacks[1].path: "../other" must stay inside the repo, so ".." is not allowed.',
    );
  });
});

describe("entries and phases", () => {
  test("two entries for one stack", () => {
    expect(
      text({ kind: "same-entry", first: 0, stackId: "apps/a:prod", path: ["stacks", 2] }),
    ).toBe(
      'stacks[2]: says the same path and name as stacks[0] ("apps/a:prod"). Put the settings in one entry.',
    );
  });

  test("a phase named twice, and one that is not among the phases", () => {
    expect(text({ kind: "phase-named-twice", phase: "a", first: 0, path: ["phases", 2] })).toBe(
      'phases[2]: "a" is already phases[0]. Each phase is named once.',
    );
    expect(
      text({ kind: "unknown-phase", phase: "b", phases: ["a"], path: ["stacks", 0, "phase"] }),
    ).toBe('stacks[0].phase: "b" is not one of the phases. The phases are: a.');
    expect(
      text({ kind: "unknown-phase", phase: "b", phases: [], path: ["stacks", 0, "phase"] }),
    ).toBe(
      'stacks[0].phase: "b" is not one of the phases, and sluiceway.yaml has no phases. List them in order at the top: phases: [first, second].',
    );
  });

  test("a phase read from the project file", () => {
    expect(
      text({ kind: "no-phase-key", stackId: "y:b", key: "tier", path: ["stacks", 1, "phase"] }),
    ).toBe(
      "stacks[1].phase: y:b has no text under tier in its project file, under config or at the top level. Add it there, or name the phase here.",
    );
    const unknown = (phases: string[]) =>
      text({ kind: "phase-key-unknown", stackId: "x:a", key: "tier", phases, path: [] });
    expect(unknown(["early", "late"])).toBe(
      "the text under tier in the project file of x:a is not one of the phases. The phases are: early, late.",
    );
    expect(unknown([])).toBe(
      "the text under tier in the project file of x:a is not one of the phases. The phases are: none, sluiceway.yaml has no phases.",
    );
  });
});

describe("against the stacks discovery found", () => {
  test("an entry that covers nothing that exists", () => {
    expect(text({ kind: "entry-only-ignored", stackIds: ["old"], path: ["stacks", 0] })).toBe(
      'stacks[0]: the stack "old" is left out by ignore, so these settings would do nothing. Remove the entry, or change ignore.',
    );
    expect(
      text({ kind: "entry-only-ignored", stackIds: ["net:prod", "net:dev"], path: ["stacks", 0] }),
    ).toBe(
      'stacks[0]: the stacks "net:prod", "net:dev" are left out by ignore, so these settings would do nothing. Remove the entry, or change ignore.',
    );
    expect(text({ kind: "entry-no-stack", stackPath: "nope", path: ["stacks", 0] })).toBe(
      'stacks[0]: no stack was found in "nope". An entry adds settings to a stack that exists, it never creates one.',
    );
    const named = (names: string[]) =>
      text({ kind: "entry-no-named-stack", name: "z", stackPath: "net", names, path: [] });
    expect(named(["prod", "dev"])).toBe(
      'no stack named "z" was found in "net". Found there: prod, dev.',
    );
    expect(named([])).toBe(
      'no stack named "z" was found in "net". The stack found there has no name.',
    );
  });

  test("an id an entry gives", () => {
    const at = ["stacks", 0, "id"];
    expect(text({ kind: "id-covers-no-stack", id: "net", path: at })).toBe(
      "stacks[0].id: the entry covers no stack, so there is nothing to name net.",
    );
    expect(text({ kind: "id-covers-stacks", stackIds: ["net:prod", "net:dev"], path: at })).toBe(
      "stacks[0].id: the entry covers 2 stacks (net:prod, net:dev), and an id names one. Give the entry a name.",
    );
    expect(text({ kind: "id-given-twice", stackId: "y:b", id: "q1", path: at })).toBe(
      "stacks[0].id: y:b already has the id q1.",
    );
    expect(text({ kind: "id-taken", id: "network:prod", path: at })).toBe(
      'stacks[0].id: "network:prod" is the id of another stack already. Every stack id is unique.',
    );
  });

  test("a dependency that could never hold anything back", () => {
    const at = ["stacks", 0, "dependsOn", 1];
    expect(text({ kind: "depends-on-ignored", stackId: "net:dev", path: at })).toBe(
      'stacks[0].dependsOn[1]: "net:dev" is left out by ignore, so it never has a change to wait for. Remove it here, or change ignore.',
    );
    expect(text({ kind: "depends-on-ignored", stackId: "net:dev", reason: "gone", path: at })).toBe(
      'stacks[0].dependsOn[1]: "net:dev" is left out by ignore ("gone"), so it never has a change to wait for. Remove it here, or change ignore.',
    );
    expect(text({ kind: "depends-on-unknown", stackId: "zz", example: "net:prod", path: at })).toBe(
      'stacks[0].dependsOn[1]: "zz" is not a stack that discovery found. Write the stack id as a row shows it, such as "net:prod".',
    );
    expect(text({ kind: "depends-on-unknown", stackId: "zz", path: at })).toBe(
      'stacks[0].dependsOn[1]: "zz" is not a stack that discovery found. Write the stack id as a row shows it, such as "network:dev".',
    );
    expect(text({ kind: "depends-on-itself", stackId: "app:prod", path: at })).toBe(
      'stacks[0].dependsOn[1]: "app:prod" is the stack itself. A stack cannot depend on itself.',
    );
    expect(
      text({
        kind: "depends-on-earlier-phase",
        stackId: "net:prod",
        phase: "late",
        stack: "app:dev",
        stackPhase: "early",
        path: at,
      }),
    ).toBe(
      'stacks[0].dependsOn[1]: "net:prod" is in the late phase, which comes after the early phase of app:dev. net:prod already waits on every stack of the early phase, so take this out, or move one of them to another phase.',
    );
  });

  test("a circle of stacks", () => {
    const circle: ConfigIssue = {
      kind: "depends-on-circle",
      circle: [{ stack: "a" }, { stack: "b" }, { stack: "c" }, { stack: "a" }],
      path: [],
    };
    expect(text(circle)).toBe(
      "dependsOn goes round in a circle: a depends on b, which depends on c, which depends on a. Nothing in a circle could ever deploy first, so take one of these out.",
    );
  });

  test("a circle through a phase names the phase, not every stack in it", () => {
    const circle: ConfigIssue = {
      kind: "depends-on-circle",
      circle: [
        { stack: "app:prod" },
        { phase: "early" },
        { stack: "net:prod" },
        { stack: "y:b" },
        { stack: "app:prod" },
      ],
      path: [],
    };
    expect(text(circle)).toBe(
      "dependsOn goes round in a circle: app:prod waits on the early phase, which holds net:prod, which depends on y:b, which depends on app:prod. Nothing in a circle could ever deploy first, so take one of these out.",
    );
  });
});

describe("words chosen elsewhere", () => {
  test("pass through as they are, after the path", () => {
    expect(text({ kind: "worded", text: "an adapter's words.", path: [] })).toBe(
      "an adapter's words.",
    );
    expect(text({ kind: "worded", text: "uses **.", path: ["dashboard", "showValues", 1] })).toBe(
      "dashboard.showValues[1]: uses **.",
    );
  });
});
