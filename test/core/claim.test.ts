import { describe, expect, test } from "bun:test";
import { type Claimant, claim } from "../../src/core/claim.ts";

function claimant(id: string, inputs: string[] = []): Claimant {
  const [path = ""] = id.split(":");
  return { id, path, inputs };
}

// Who claims what, as plain data a test can read.
function claimed(stacks: Claimant[], changed: string[], unrelated: string[] = []) {
  const result = claim(stacks, changed, unrelated);
  return {
    claims: Object.fromEntries(result.claims),
    unclaimed: result.unclaimed,
  };
}

describe("a file inside the stack's directory", () => {
  test("is claimed by the stack", () => {
    expect(claimed([claimant("apps/grafana:prod")], ["apps/grafana/index.ts"])).toEqual({
      claims: { "apps/grafana:prod": ["apps/grafana/index.ts"] },
      unclaimed: [],
    });
  });

  test("however deep it lies", () => {
    const { claims } = claimed([claimant("apps/grafana")], ["apps/grafana/a/b/c.json"]);
    expect(claims).toEqual({ "apps/grafana": ["apps/grafana/a/b/c.json"] });
  });

  test("a directory whose name only starts the same claims nothing", () => {
    expect(claimed([claimant("apps/graf")], ["apps/grafana/index.ts"])).toEqual({
      claims: {},
      unclaimed: ["apps/grafana/index.ts"],
    });
  });

  test("a file named like the directory is not inside it", () => {
    expect(claimed([claimant("apps/grafana")], ["apps/grafana"]).unclaimed).toEqual([
      "apps/grafana",
    ]);
  });

  test("both stacks of one directory claim a file in it", () => {
    const stacks = [claimant("network:dev"), claimant("network:prod"), claimant("site:prod")];
    expect(claimed(stacks, ["network/Pulumi.yaml"]).claims).toEqual({
      "network:dev": ["network/Pulumi.yaml"],
      "network:prod": ["network/Pulumi.yaml"],
    });
  });

  test("when one stack directory contains another, a file in the inner one is claimed by both", () => {
    const stacks = [claimant("platform:prod"), claimant("platform/dns:prod")];
    expect(claimed(stacks, ["platform/dns/zone.ts", "platform/main.ts"]).claims).toEqual({
      "platform:prod": ["platform/dns/zone.ts", "platform/main.ts"],
      "platform/dns:prod": ["platform/dns/zone.ts"],
    });
  });

  test("a stack at the repo root has the path . and claims every file", () => {
    const stacks = [claimant(".:prod"), claimant("apps/loki:prod")];
    expect(claimed(stacks, ["package.json", ".github/workflows/ci.yml", "apps/loki/a.ts"])).toEqual(
      {
        claims: {
          ".:prod": ["package.json", ".github/workflows/ci.yml", "apps/loki/a.ts"],
          "apps/loki:prod": ["apps/loki/a.ts"],
        },
        unclaimed: [],
      },
    );
  });
});

describe("inputs", () => {
  test("a file that matches an inputs glob is claimed by that stack", () => {
    const stacks = [claimant("app:prod", ["shared/**"]), claimant("site:prod")];
    expect(claimed(stacks, ["shared/motd.txt"])).toEqual({
      claims: { "app:prod": ["shared/motd.txt"] },
      unclaimed: [],
    });
  });

  test("inputs add claims and never remove them", () => {
    const stacks = [claimant("app:prod", ["shared/**"])];
    expect(claimed(stacks, ["app/Pulumi.yml"]).claims).toEqual({ "app:prod": ["app/Pulumi.yml"] });
  });

  test("the globs are the ones of every other list: * stops at a slash, a leading dot is nothing special", () => {
    const stacks = [claimant("workspaces/pi", ["workspaces/apps/*/dashboards/**", "*.env"])];
    expect(
      claimed(stacks, [
        "workspaces/apps/loki/dashboards/logs.json",
        "workspaces/apps/loki/deep/dashboards/logs.json",
        ".env",
        "config/.env",
      ]),
    ).toEqual({
      claims: { "workspaces/pi": ["workspaces/apps/loki/dashboards/logs.json", ".env"] },
      unclaimed: ["workspaces/apps/loki/deep/dashboards/logs.json", "config/.env"],
    });
  });

  test("a file claimed twice by one stack is listed once", () => {
    const stacks = [claimant("app", ["app/**", "**/*.ts"])];
    expect(claimed(stacks, ["app/index.ts"]).claims).toEqual({ app: ["app/index.ts"] });
  });
});

describe("a file no stack claims", () => {
  test("is handed back, in the order it came", () => {
    const stacks = [claimant("apps/loki:prod")];
    expect(claimed(stacks, ["package.json", "apps/loki/a.ts", "bun.lock"])).toEqual({
      claims: { "apps/loki:prod": ["apps/loki/a.ts"] },
      unclaimed: ["package.json", "bun.lock"],
    });
  });

  test("with no stacks every file is unclaimed", () => {
    expect(claimed([], ["a.txt"]).unclaimed).toEqual(["a.txt"]);
  });

  test("the same path twice counts once, as a rename and an edit of one file give", () => {
    expect(claimed([], ["a.txt", "a.txt"]).unclaimed).toEqual(["a.txt"]);
  });
});

describe("scan.unrelated", () => {
  test("an unrelated file claims nothing and forces nothing, also inside a stack's directory", () => {
    const stacks = [claimant("apps/loki:prod")];
    expect(claimed(stacks, ["README.md", "apps/loki/README.md"], ["**/*.md"])).toEqual({
      claims: {},
      unclaimed: [],
    });
  });

  test("and also when an inputs glob matches it", () => {
    const stacks = [claimant("app:prod", ["shared/**"])];
    expect(claimed(stacks, ["shared/notes.md"], ["**/*.md"]).claims).toEqual({});
  });

  test("every other file goes through the rule as before", () => {
    const stacks = [claimant("apps/loki:prod")];
    expect(claimed(stacks, ["docs/a.md", "apps/loki/a.ts", "Makefile"], ["docs/**"])).toEqual({
      claims: { "apps/loki:prod": ["apps/loki/a.ts"] },
      unclaimed: ["Makefile"],
    });
  });
});

// Slice 5.9: a few files that no program reads in practice claim nothing and
// force nothing without any setting, but only where no stack claims them. A
// stack still claims its own README, and an `inputs` glob still wins.
describe("the default unrelated files", () => {
  test("force nothing when no stack claims them", () => {
    const stacks = [claimant("apps/loki:prod")];
    expect(
      claimed(stacks, [
        "README.md",
        "docs/setup.md",
        "LICENSE",
        ".gitignore",
        "tools/.gitignore",
        ".editorconfig",
        ".github/workflows/deploy.yml",
        "package.json",
      ]),
    ).toEqual({ claims: {}, unclaimed: ["package.json"] });
  });

  test("are still claimed by the stack whose directory holds them", () => {
    const stacks = [claimant("apps/loki:prod")];
    expect(claimed(stacks, ["apps/loki/README.md"]).claims).toEqual({
      "apps/loki:prod": ["apps/loki/README.md"],
    });
  });

  test("are still claimed through an inputs glob", () => {
    const stacks = [claimant("app:prod", ["docs/**"])];
    expect(claimed(stacks, ["docs/setup.md"]).claims).toEqual({
      "app:prod": ["docs/setup.md"],
    });
  });

  test("a stack at the repo root claims them too", () => {
    const stacks = [claimant(".")];
    expect(claimed(stacks, ["README.md"]).claims).toEqual({ ".": ["README.md"] });
  });
});
