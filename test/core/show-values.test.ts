import { describe, expect, test } from "bun:test";
import { ConfigError, parseConfig } from "../../src/core/config.ts";
import { isListedPath, shortValue } from "../../src/core/show-values.ts";

// `dashboard.showValues` (record 0052): the paths whose old and new value may
// appear. Only what a person wrote in the list matches. Sluiceway never
// guesses that a value is safe (record 0022).

function problems(text: string): string[] {
  try {
    parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error("expected the config to be refused");
}

describe("the config key", () => {
  test("is empty unless the file sets it, so nothing changes for anyone who does not", () => {
    expect(parseConfig(undefined).dashboard.showValues).toEqual([]);
    expect(parseConfig("dashboard:\n  redact: false\n").dashboard.showValues).toEqual([]);
  });

  test("keeps the paths as written", () => {
    const config = parseConfig(
      "dashboard:\n  showValues:\n    - version\n    - values.image.tag\n    - 'metadata.annotations[\"example.com/revision\"]'\n",
    );
    expect(config.dashboard.showValues).toEqual([
      "version",
      "values.image.tag",
      'metadata.annotations["example.com/revision"]',
    ]);
  });

  test("an entry must be text that is not empty", () => {
    expect(problems('dashboard:\n  showValues: ["", 3]\n')).toEqual([
      "dashboard.showValues[0]: must not be empty.",
      "dashboard.showValues[1]: expected text, got 3.",
    ]);
  });

  test("an entry that could match any path under it is refused", () => {
    expect(problems('dashboard:\n  showValues: ["values.**", "*", "*.*"]\n')).toEqual([
      'dashboard.showValues[0]: "values.**" uses "**". An entry matches one path, and "*" stands for part of one name. Write each path whose value may appear.',
      'dashboard.showValues[1]: "*" names no property. Write each path whose value may appear.',
      'dashboard.showValues[2]: "*.*" names no property. Write each path whose value may appear.',
    ]);
  });
});

describe("which paths an entry matches", () => {
  test("a path without a star matches itself and nothing else", () => {
    expect(isListedPath(["values.image.tag"], "values.image.tag")).toBe(true);
    expect(isListedPath(["values.image.tag"], "values.image.tags")).toBe(false);
    expect(isListedPath(["values.image.tag"], "values.image")).toBe(false);
    expect(isListedPath(["values.image"], "values.image.tag")).toBe(false);
    expect(isListedPath(["version"], "chart.version")).toBe(false);
  });

  test("an empty list matches nothing", () => {
    expect(isListedPath([], "version")).toBe(false);
  });

  test("a star stands for part of one name and never crosses a dot or a bracket", () => {
    expect(isListedPath(["values.*.tag"], "values.image.tag")).toBe(true);
    expect(isListedPath(["values.*.tag"], "values.sidecar.image.tag")).toBe(false);
    expect(isListedPath(["values.*"], "values.githubConfigSecret.github_token")).toBe(false);
    expect(isListedPath(["values.*.image"], "values.containers[0].image")).toBe(false);
    expect(isListedPath(["spec.containers[*].image"], "spec.containers[0].image")).toBe(true);
    expect(isListedPath(["image*"], "imageTag")).toBe(true);
  });

  test("everything but the star is taken as it is, brackets and quotes too", () => {
    expect(isListedPath(["data[0]"], "data[0]")).toBe(true);
    expect(isListedPath(["data[0]"], "data0")).toBe(false);
    expect(isListedPath(["a.b"], "aXb")).toBe(false);
    expect(isListedPath(['data["app.properties"]'], 'data["app.properties"]')).toBe(true);
    expect(isListedPath(['data["*"]'], 'data["app.properties"]')).toBe(false);
  });

  // The first real user's list and the one value in their stacks that must
  // never show (onboarding log, hurdle 22).
  test("the copy-in list for a Helm release leaves a rotating token alone", () => {
    const list = ["version", "chart.version", "values.image.tag", "image"];
    expect(isListedPath(list, "version")).toBe(true);
    expect(isListedPath(list, "values.image.tag")).toBe(true);
    expect(isListedPath(list, "values.githubConfigSecret.github_token")).toBe(false);
  });
});

describe("a long value", () => {
  test("up to 40 code points is shown whole", () => {
    expect(shortValue("17.0.4")).toBe("17.0.4");
    expect(shortValue("x".repeat(40))).toBe("x".repeat(40));
  });

  test("past 40 keeps its start and its end, where a tag is, in 40 code points", () => {
    const image = "registry.example.com/platform/team/service-name:17.0.4";
    const short = shortValue(image);
    expect(short).toBe("registry.example.co…/service-name:17.0.4");
    expect(Array.from(short)).toHaveLength(40);
  });

  test("never splits a character", () => {
    const short = shortValue("🌊".repeat(50));
    expect(short).toBe(`${"🌊".repeat(19)}…${"🌊".repeat(20)}`);
  });
});
