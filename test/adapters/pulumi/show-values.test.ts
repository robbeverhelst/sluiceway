import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import { parsePreview } from "../../../src/adapters/pulumi/schema.ts";
import type { Change } from "../../../src/core/diff.ts";
import { diffHash } from "../../../src/core/diff-hash.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, FIXTURES, type Replay, ROOT, replay, VERSIONS } from "./replay.ts";

// `dashboard.showValues` (record 0052). The tool's document holds every value
// in plain text, except the ones it marks secret. The adapter reads a value
// only at a path the list names, and hands over nothing else of the document.

const K8S: Stack = { path: "generated/nested", name: "dev", options: {} };
const NETWORK_DEV: Stack = { path: "network", name: "dev", options: {} };

const IMAGE = "spec.template.spec.containers[0].image";
const ENV_VALUE = "spec.template.spec.containers[0].env[0].value";
const PROPERTIES = 'data["app.properties"]';

function previewWith(stack: Stack, { run }: Replay, showValues: string[]): Promise<PreviewResult> {
  return pulumi.preview(stack, { root: ROOT, env: {}, run, timeoutMinutes: 10, showValues });
}

function changes(result: PreviewResult): Change[] {
  if (!result.ok) throw new Error("expected a diff");
  return result.diff.changes;
}

function byName(result: PreviewResult, name: string): Change | undefined {
  return changes(result).find((change) => change.name === name);
}

for (const version of VERSIONS) {
  describe(`values of listed paths, replaying pulumi ${version}`, () => {
    test("an empty list gives the diff of every earlier version, with no values at all", async () => {
      const listed = await previewWith(K8S, replay(version, "nested-paths"), []);
      const unset = await pulumi.preview(K8S, {
        root: ROOT,
        env: {},
        run: replay(version, "nested-paths").run,
        timeoutMinutes: 10,
      });

      expect(listed).toEqual(unset);
      expect(changes(listed).every((change) => change.values === undefined)).toBe(true);
    });

    test("a listed path shows its old and new value, and an unlisted path on the same change shows none", async () => {
      const result = await previewWith(K8S, replay(version, "nested-paths"), [IMAGE]);

      expect(byName(result, "web")?.values).toEqual([
        { path: IMAGE, old: "nginx:1.27", new: "nginx:1.28" },
      ]);
      expect(byName(result, "settings")?.values).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(CANARY_VALUE);
    });

    test("a star matches part of one name", async () => {
      const result = await previewWith(K8S, replay(version, "nested-paths"), [
        "spec.template.spec.containers[*].image",
      ]);

      expect(byName(result, "web")?.values).toEqual([
        { path: IMAGE, old: "nginx:1.27", new: "nginx:1.28" },
      ]);
    });

    // The canary value sits in a value that changes. Listed, it may appear.
    test("a listed path shows the canary value, which is the user's choice", async () => {
      const result = await previewWith(K8S, replay(version, "nested-paths"), [
        ENV_VALUE,
        PROPERTIES,
      ]);

      expect(byName(result, "web")?.values).toEqual([
        { path: ENV_VALUE, old: CANARY_VALUE, new: `${CANARY_VALUE}-2` },
      ]);
      expect(byName(result, "settings")?.values).toEqual([
        { path: PROPERTIES, old: CANARY_VALUE, new: `${CANARY_VALUE}-3` },
      ]);
    });

    test("a listed path the tool marks secret shows nothing", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "changed-secret"), [
        "environment.TOKEN",
        "environment.*",
      ]);

      expect(changes(result).map((change) => change.changedKeys)).toEqual([["environment.TOKEN"]]);
      expect(changes(result)[0]?.values).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("[secret]");
    });

    // An added key has no old value.
    test("a key that is new has only a new value", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "update"), [
        "environment.STAGE",
      ]);

      expect(changes(result)[0]?.values).toEqual([{ path: "environment.STAGE", new: "second" }]);
    });

    // Record 0008 hashes names. The list decides what a row shows, never what
    // a tick approves, so turning it on voids no tick.
    test("the hash is the same with and without the list", async () => {
      const without = await previewWith(K8S, replay(version, "nested-paths"), []);
      const withList = await previewWith(K8S, replay(version, "nested-paths"), [
        IMAGE,
        ENV_VALUE,
        PROPERTIES,
      ]);

      if (!without.ok || !withList.ok) throw new Error("expected two diffs");
      expect(diffHash(withList.diff)).toBe(diffHash(without.diff));
    });

    test("the parsed document holds a value only at a listed path", () => {
      const stdout = readFileSync(
        join(FIXTURES, version, "nested-paths", "preview.stdout"),
        "utf8",
      );
      const parsed = JSON.stringify(parsePreview(stdout, [IMAGE]));

      expect(parsed).toContain("nginx:1.28");
      expect(parsed).not.toContain(CANARY_VALUE);
      expect(parsed).not.toContain("matchLabels");
      expect(JSON.stringify(parsePreview(stdout))).not.toContain("nginx");
    });
  });
}

type Document = { steps: Record<string, unknown>[] };

// No recording can hold a Helm release, which needs a cluster to preview, so
// the recorded update is changed into one in the shape the tool gives for
// every other nested change (as in preview-failures.test.ts).
function helmRelease(values: {
  old: Record<string, unknown>;
  new: Record<string, unknown>;
  paths: string[];
}): Replay {
  const file = join(FIXTURES, VERSIONS[0] ?? "", "update", "preview.stdout");
  const document = JSON.parse(readFileSync(file, "utf8")) as Document;
  const step = document.steps[1];
  if (step?.op !== "update") throw new Error("the update scenario has moved");
  step.urn = "urn:pulumi:dev::network::kubernetes:helm.sh/v3:Release::odoo-release";
  step.detailedDiff = Object.fromEntries(
    values.paths.map((path) => [path, { kind: "update", inputDiff: false }]),
  );
  step.diffReasons = ["values", "version"];
  step.oldState = { ...(step.oldState as object), inputs: values.old, outputs: values.old };
  step.newState = { ...(step.newState as object), inputs: values.new };
  const stdout = JSON.stringify(document);
  return answering({ status: "exited", exitCode: 0, stdout, stderr: "" });
}

const TOKEN_OLD = "ghs_rotatingTokenNumberOne";
const TOKEN_NEW = "ghs_rotatingTokenNumberTwo";

// The first real user's releases (onboarding log, hurdle 22), and the one
// value in them that the tool does not mark secret and must never show.
function odoo(): Replay {
  const release = (version: string, tag: string, token: string) => ({
    chart: "odoo",
    version,
    values: { image: { tag }, githubConfigSecret: { github_token: token } },
  });
  return helmRelease({
    old: release("17.0.3", "17.0.3-r1", TOKEN_OLD),
    new: release("17.0.4", "17.0.4-r1", TOKEN_NEW),
    paths: ["version", "values.image.tag", "values.githubConfigSecret.github_token"],
  });
}

describe("a Helm release", () => {
  test("the copy-in list shows the version bump and never the rotating token", async () => {
    const list = ["version", "chart.version", "values.image.tag", "image"];
    const result = await previewWith(NETWORK_DEV, odoo(), list);

    expect(changes(result)[0]?.values).toEqual([
      { path: "values.image.tag", old: "17.0.3-r1", new: "17.0.4-r1" },
      { path: "version", old: "17.0.3", new: "17.0.4" },
    ]);
    expect(JSON.stringify(result)).not.toContain("ghs_");
  });

  test("a star one level down does not reach the token", async () => {
    const result = await previewWith(NETWORK_DEV, odoo(), ["values.*"]);

    expect(changes(result)[0]?.values).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("ghs_");
  });

  // Nothing guesses: a list that names the token shows it. That is what
  // record 0052 says the list is for, and why it holds only what a person wrote.
  test("a list that names the token shows it", async () => {
    const result = await previewWith(NETWORK_DEV, odoo(), ["values.githubConfigSecret.*"]);

    expect(changes(result)[0]?.values).toEqual([
      { path: "values.githubConfigSecret.github_token", old: TOKEN_OLD, new: TOKEN_NEW },
    ]);
  });

  test("a value that is a whole object, a list, several lines or unknown shows nothing", async () => {
    const runner = helmRelease({
      old: { values: { a: "x" }, list: [1], text: "one", later: "known" },
      new: {
        values: { a: "y" },
        list: [2],
        text: "one\ntwo",
        later: "04da6b54-80e4-46f7-96ec-b56ff0331ba9",
      },
      paths: ["values", "list", "text", "later"],
    });
    const result = await previewWith(NETWORK_DEV, runner, ["values", "list", "text", "later"]);

    expect(changes(result)[0]?.values).toBeUndefined();
  });

  test("numbers and booleans show as the tool writes them, and a long value is shortened", async () => {
    const image = "registry.example.com/platform/team/service-name:17.0.4";
    const runner = helmRelease({
      old: { replicas: 1, enabled: false, image: "short:1" },
      new: { replicas: 2, enabled: true, image },
      paths: ["replicas", "enabled", "image"],
    });
    const result = await previewWith(NETWORK_DEV, runner, ["replicas", "enabled", "image"]);

    expect(changes(result)[0]?.values).toEqual([
      { path: "enabled", old: "false", new: "true" },
      { path: "image", old: "short:1", new: "registry.example.co…/service-name:17.0.4" },
      { path: "replicas", old: "1", new: "2" },
    ]);
    expect(JSON.stringify(result)).not.toContain("platform/team");
  });

  test("a key with a dot is found under its quoted path", async () => {
    const runner = helmRelease({
      old: { metadata: { annotations: { "example.com/revision": "1" } } },
      new: { metadata: { annotations: { "example.com/revision": "2" } } },
      paths: ['metadata.annotations["example.com/revision"]'],
    });
    const path = 'metadata.annotations["example.com/revision"]';
    const result = await previewWith(NETWORK_DEV, runner, [path]);

    expect(changes(result)[0]?.values).toEqual([{ path, old: "1", new: "2" }]);
  });
});
