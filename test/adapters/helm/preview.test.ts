import { describe, expect, test } from "bun:test";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { helm } from "../../../src/adapters/helm/index.ts";
import type { Change } from "../../../src/core/diff.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, ROOT, recorded, replay, VERSIONS } from "./replay.ts";
import { WEB, WORKER } from "./stacks.ts";

// The Helm preview (record 0058): `helm diff upgrade --output=structured` of
// the release against the chart and its values, and the diff from its
// entries. Every expected diff here is worked out by hand from what the
// scenario changes in examples/helm-basic, not from the adapter.

const options = (run: Parameters<typeof helm.preview>[1]["run"]) => ({
  root: ROOT,
  env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_secret" },
  run,
  timeoutMinutes: 10,
});

async function previewOf(
  version: string,
  scenario: string,
  stack: Stack = WEB,
  extra: { showValues?: string[] } = {},
): Promise<PreviewResult> {
  return helm.preview(stack, { ...options(replay(version, scenario).run), ...extra });
}

function changes(result: PreviewResult): Change[] {
  if (!result.ok) throw new Error(`The preview failed: ${JSON.stringify(result.reason)}`);
  return result.diff.changes;
}

// An object of the release namespace: the kind and the name, as a person
// reads them, and the address that keeps them apart.
const change = (
  kind: string,
  name: string,
  op: Change["op"],
  changedKeys: string[] = [],
  namespace = "sluiceway-web",
): Change => ({
  address: `${kind}/${namespace}/${name}`,
  type: kind,
  name,
  op,
  changedKeys,
  replaceKeys: [],
});

const WEB_CREATES = [
  change("ConfigMap", "web-settings", "create"),
  change("Secret", "web-token", "create"),
  change("Service", "web", "create"),
];

for (const version of VERSIONS) {
  describe(`helm ${version}: every change type as the diff plugin gives it`, () => {
    test("a release that is not installed is all creates, and creates list no keys", async () => {
      const result = await previewOf(version, "new-stack");
      expect(changes(result)).toEqual(WEB_CREATES);
      if (result.ok) expect(result.diff.stackId).toBe("web");
    });

    test("nothing changed", async () => {
      expect(changes(await previewOf(version, "no-changes"))).toEqual([]);
    });

    test("an update names property paths: a key with a dot, a label, a port in a list", async () => {
      expect(changes(await previewOf(version, "update"))).toEqual([
        change("ConfigMap", "web-settings", "update", [
          'data["app.properties"]',
          'metadata.labels["app.kubernetes.io/version"]',
        ]),
        change("Service", "web", "update", ["spec.ports[0].port"]),
      ]);
    });

    test("an object the chart adds is a create", async () => {
      expect(changes(await previewOf(version, "create"))).toEqual([
        change("ConfigMap", "web-extra", "create"),
      ]);
    });

    test("an object the chart no longer renders is a delete", async () => {
      expect(changes(await previewOf(version, "delete"))).toEqual([
        change("ConfigMap", "web-extra", "delete"),
      ]);
    });

    test("all three in one diff, sorted by address", async () => {
      expect(changes(await previewOf(version, "mixed"))).toEqual([
        change("ConfigMap", "web-extra", "delete"),
        change("ConfigMap", "web-nonce", "create"),
        change("ConfigMap", "web-settings", "update", ['data["app.properties"]']),
      ]);
    });

    test("a rotated secret is a changed path, and nothing more", async () => {
      expect(changes(await previewOf(version, "changed-secret"))).toEqual([
        change("Secret", "web-token", "update", ["data.token"]),
      ]);
    });

    test("the same diff twice gives the same changes", async () => {
      const { run } = replay(version, "same-diff-twice");
      const first = await helm.preview(WEB, options(run));
      const second = await helm.preview(WEB, options(run));
      expect(changes(second)).toEqual(changes(first));
      expect(changes(first).length).toBeGreaterThan(0);
    });

    test("another release in its own namespace, from a chart with a dependency", async () => {
      expect(changes(await previewOf(version, "dependencies", WORKER))).toEqual([
        change("ConfigMap", "worker-settings", "create", [], "sluiceway-worker"),
        change("Secret", "worker-token", "create", [], "sluiceway-worker"),
        change("Service", "worker", "create", [], "sluiceway-worker"),
      ]);
    });

    test("a chart that does not render fails with the exit code, and the words go to the log", async () => {
      const result = await previewOf(version, "program-error");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toEqual({ kind: "tool-error", exitCode: 1 });
      expect(result.detail).toEqual([]);
      expect(result.toolLog).toContain("greeting is required");
    });

    test("the command line, the directory and the environment", async () => {
      const { run, runs } = replay(version, "new-stack");
      await helm.preview(WEB, options(run));
      expect(runs).toHaveLength(1);
      expect(runs[0]?.argv).toEqual([
        "helm",
        "diff",
        "upgrade",
        "web",
        "../charts/web",
        "--namespace=sluiceway-web",
        "--install",
        "--reset-values",
        "--dry-run=server",
        "--output=structured",
        "--no-color",
        "--values=values.yaml",
      ]);
      expect(runs[0]?.cwd).toBe(`${ROOT}/web`);
      expect(runs[0]?.timeoutMs).toBe(600_000);
      expect(runs[0]?.env.PATH).toBe("/usr/bin");
      expect(runs[0]?.env.INPUT_GITHUB_TOKEN).toBeUndefined();
    });

    // Record 0052: a listed path shows its old and new value, as display
    // text, and nothing of a Secret ever does.
    test("the value list", async () => {
      const result = await previewOf(version, "update", WEB, {
        showValues: ["spec.ports[0].port", 'data["app.properties"]'],
      });
      expect(changes(result).map((one) => one.values)).toEqual([
        [{ path: 'data["app.properties"]', old: "color=blue", new: "color=green" }],
        [{ path: "spec.ports[0].port", old: "80", new: "8080" }],
      ]);
      const secret = await previewOf(version, "changed-secret", WEB, {
        showValues: ["data.token", "data.*"],
      });
      expect(changes(secret)[0]?.values).toBeUndefined();
    });
  });
}

const [VERSION = ""] = VERSIONS;
const printing = (stdout: string, exitCode = 0) =>
  answering({ status: "exited", exitCode, stdout, stderr: "" });

async function previewPrinting(stdout: string): Promise<PreviewResult> {
  return helm.preview(WEB, options(printing(stdout).run));
}

describe("output Sluiceway cannot read is never in sync", () => {
  const update = recorded(VERSION, "update", "diff");

  test("not JSON", async () => {
    const result = await previewPrinting("nothing to see\n");
    expect(result).toMatchObject({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: ["The tool's output: expected one JSON document."],
    });
  });

  test("an entry without a kind names the place and never what was there", async () => {
    const result = await previewPrinting(
      JSON.stringify([{ apiVersion: "v1", name: "CANARY-VALUE", changeType: "ADD" }]),
    );
    expect(result).toMatchObject({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: ["The tool's output, at [0].kind: expected text."],
    });
  });

  test("an update that names no path", async () => {
    const entries = JSON.parse(update) as Record<string, unknown>[];
    const result = await previewPrinting(
      JSON.stringify(entries.map(({ changes: _changes, ...rest }) => rest)),
    );
    expect(result).toMatchObject({ ok: false, reason: { kind: "unreadable-output" } });
    if (!result.ok) {
      expect(result.detail[0]).toBe(
        "The tool's output, at [0].changes: expected the paths that change on a MODIFY.",
      );
    }
  });

  test("changes the plugin was asked to hide", async () => {
    const entries = JSON.parse(update) as Record<string, unknown>[];
    const result = await previewPrinting(
      JSON.stringify(entries.map((entry) => ({ ...entry, changesSuppressed: true }))),
    );
    expect(result).toMatchObject({ ok: false, reason: { kind: "unreadable-output" } });
  });

  test("two entries for one object", async () => {
    const entries = JSON.parse(update) as unknown[];
    const result = await previewPrinting(JSON.stringify([entries[0], entries[0]]));
    expect(result).toMatchObject({ ok: false, reason: { kind: "unreadable-output" } });
    if (!result.ok) {
      expect(result.detail).toEqual([
        "The tool's output, at [1]: expected an object that no earlier entry has, and [0] has it.",
      ]);
    }
  });

  test("a change type Sluiceway does not know fails the preview", async () => {
    const result = await previewPrinting(update.replaceAll('"MODIFY"', '"OWNERSHIP"'));
    expect(result).toMatchObject({
      ok: false,
      reason: { kind: "unknown-step" },
    });
    if (!result.ok) {
      expect(result.detail[0]).toBe(
        "The tool's output, at [0].changeType: expected ADD, MODIFY or REMOVE.",
      );
    }
  });
});

test("a value of several lines, or an object, never shows", async () => {
  const update = recorded(VERSION, "update", "diff")
    .replace('"oldValue": "color=blue"', '"oldValue": "color=blue\\nsize=large"')
    .replace('"newValue": 8080', '"newValue": { "port": 8080 }');
  const result = await helm.preview(WEB, {
    ...options(printing(update).run),
    showValues: ["spec.ports[0].port", 'data["app.properties"]'],
  });
  expect(changes(result).map((one) => one.values)).toEqual([undefined, undefined]);
});

describe("a preview that does not end well", () => {
  test("a diff that runs out of time", async () => {
    const { run } = answering({ status: "timed-out", stdout: "", stderr: "still rendering" });
    const result = await helm.preview(WEB, { ...options(run), timeoutMinutes: 3 });
    expect(result).toMatchObject({
      ok: false,
      reason: { kind: "timed-out", minutes: 3 },
      toolLog: "still rendering",
    });
  });

  test("a helm that is not there", async () => {
    const { run } = answering({ status: "not-started" });
    expect(await helm.preview(WEB, options(run))).toMatchObject({
      ok: false,
      reason: { kind: "tool-error", exitCode: null },
    });
  });

  test("a failed diff never hands its stdout to the log", async () => {
    const { run } = answering({
      status: "exited",
      exitCode: 2,
      stdout: "CANARY-VALUE",
      stderr: "Error: something",
    });
    const result = await helm.preview(WEB, options(run));
    expect(result).toMatchObject({ ok: false, toolLog: "Error: something" });
  });

  test("a chart reference passes its version", async () => {
    const { run, runs } = printing("[]\n");
    const remote: Stack = {
      path: "apps/ingress",
      options: {
        tool: "helm",
        release: "ingress",
        namespace: "ingress",
        chart: "oci://registry.example/charts/ingress-nginx",
        version: "4.11.3",
        valuesFiles: [],
        createNamespace: false,
        builds: [],
      },
    };
    await helm.preview(remote, options(run));
    expect(runs[0]?.argv).toEqual([
      "helm",
      "diff",
      "upgrade",
      "ingress",
      "oci://registry.example/charts/ingress-nginx",
      "--namespace=ingress",
      "--version=4.11.3",
      "--install",
      "--reset-values",
      "--dry-run=server",
      "--output=structured",
      "--no-color",
    ]);
  });
});
