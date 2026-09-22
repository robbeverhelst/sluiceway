import { describe, expect, test } from "bun:test";
import { helm } from "../../../src/adapters/helm/index.ts";
import type { Change } from "../../../src/core/diff.ts";
import { answering, ROOT, recorded, replay, VERSIONS } from "./replay.ts";
import { WEB } from "./stacks.ts";

// The drift check of a Helm stack (record 0069): the diff plugin's three-way
// merge compares the chart with the live objects, and what it finds beyond
// the plain diff against the release is what changed outside the code.

const options = (run: Parameters<typeof helm.preview>[1]["run"], showValues?: string[]) => ({
  root: ROOT,
  env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_secret" },
  run,
  timeoutMinutes: 7,
  ...(showValues === undefined ? {} : { showValues }),
});

const exited = (stdout: string, exitCode = 0, stderr = "") =>
  ({ status: "exited", exitCode, stdout, stderr }) as const;

const settings = (changedKeys: string[]): Change => ({
  address: "ConfigMap/sluiceway-web/web-settings",
  type: "ConfigMap",
  name: "web-settings",
  op: "update",
  changedKeys,
  replaceKeys: [],
});

async function driftOf(version: string, scenario: string, showValues?: string[]) {
  const replayed = replay(version, scenario);
  const result = await helm.detectDrift?.(WEB, options(replayed.run, showValues));
  return { ...replayed, result };
}

test("Helm stacks have a drift check", () => {
  expect(helm.detectDrift).toBeDefined();
});

for (const version of VERSIONS) {
  describe(`helm ${version}`, () => {
    test("drift is what the three-way diff finds beyond the plain one: a changed field, a changed list item, an object that is gone", async () => {
      const { result, runs } = await driftOf(version, "drift");
      expect(result).toEqual({
        ok: true,
        drift: [
          settings(["data.greeting"]),
          {
            address: "Secret/sluiceway-web/web-token",
            type: "Secret",
            name: "web-token",
            op: "delete",
            changedKeys: [],
            replaceKeys: [],
          },
          {
            address: "Service/sluiceway-web/web",
            type: "Service",
            name: "web",
            op: "update",
            changedKeys: ["spec.ports[0].targetPort"],
            replaceKeys: [],
          },
        ],
        toolLog: expect.any(String),
      });
      expect(runs.map((one) => one.argv)).toEqual([
        [
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
        ],
        [
          "helm",
          "diff",
          "upgrade",
          "web",
          "../charts/web",
          "--namespace=sluiceway-web",
          "--install",
          "--reset-values",
          "--dry-run=server",
          "--three-way-merge",
          "--no-hooks",
          "--output=structured",
          "--no-color",
          "--values=values.yaml",
        ],
      ]);
      // The same directory, environment and time limit as the preview.
      expect(runs.every((one) => one.cwd === `${ROOT}/web`)).toBe(true);
      expect(runs.every((one) => one.timeoutMs === 420_000)).toBe(true);
      expect(runs.every((one) => one.env.INPUT_GITHUB_TOKEN === undefined)).toBe(true);
    });

    test("a field the code changes is the code's change, and only the field changed by hand is drift", async () => {
      const { result } = await driftOf(version, "drift-and-change");
      expect(result).toMatchObject({ ok: true, drift: [settings(["data.greeting"])] });
    });

    test("a hook that deletes itself once it ran is no drift", async () => {
      const { result } = await driftOf(version, "drift-hooks");
      expect(result).toMatchObject({ ok: true, drift: [] });
    });

    test("after the deploy that put it back, the check finds nothing", async () => {
      const { result } = await driftOf(version, "drift-repaired");
      // The recording holds the drift first and the check after the deploy.
      expect(result?.ok && result.drift.length).toBe(2);
      const after = recorded(version, "drift-repaired", "three-way-after");
      const { run } = answering(exited("[]"), exited(after));
      expect(await helm.detectDrift?.(WEB, options(run))).toEqual({
        ok: true,
        drift: [],
        toolLog: "",
      });
    });

    test("drift holds no value, whatever showValues lists", async () => {
      const { result } = await driftOf(version, "drift", ["data.*", "spec.ports[0].targetPort"]);
      expect(result?.ok).toBe(true);
      if (!result?.ok) return;
      expect(result.drift.every((one) => one.values === undefined)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("CANARY");
    });

    test("a release that is not installed has no drift: both diffs add everything", async () => {
      const added = recorded(version, "new-stack", "diff");
      const { run } = answering(exited(added), exited(added));
      expect(await helm.detectDrift?.(WEB, options(run))).toMatchObject({ ok: true, drift: [] });
    });
  });
}

describe("a drift check that cannot say", () => {
  const [version = ""] = VERSIONS;
  const plain = () => recorded(version, "drift", "diff");

  test("a plain diff that fails fails the check with its exit code and words, and the three-way diff never runs", async () => {
    const { run, runs } = answering(exited("", 1, "Error: cluster unreachable\n"));
    expect(await helm.detectDrift?.(WEB, options(run))).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: 1 },
      detail: [],
      toolLog: "Error: cluster unreachable\n",
    });
    expect(runs).toHaveLength(1);
  });

  test("a three-way diff that runs out of time", async () => {
    const { run } = answering(exited(plain()), {
      status: "timed-out",
      stdout: "",
      stderr: "",
    });
    expect(await helm.detectDrift?.(WEB, options(run))).toMatchObject({
      ok: false,
      reason: { kind: "timed-out", minutes: 7 },
    });
  });

  test("a three-way diff that is not JSON names the place, never what it found", async () => {
    const { run } = answering(exited(plain()), exited("CANARY-VALUE"));
    const result = await helm.detectDrift?.(WEB, options(run));
    expect(result).toMatchObject({ ok: false, reason: { kind: "unreadable-output" } });
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });

  test("a change type Sluiceway does not know", async () => {
    const entry = {
      apiVersion: "v1",
      kind: "ConfigMap",
      namespace: "sluiceway-web",
      name: "web-settings",
      changeType: "OWNERSHIP",
    };
    const { run } = answering(exited(plain()), exited(JSON.stringify([entry])));
    expect(await helm.detectDrift?.(WEB, options(run))).toMatchObject({
      ok: false,
      reason: { kind: "unknown-step" },
      detail: ["The tool's output, at [0].changeType: expected ADD, MODIFY or REMOVE."],
    });
  });

  test("a removal that the plain diff does not have is output Sluiceway cannot read", async () => {
    const entry = {
      apiVersion: "v1",
      kind: "ConfigMap",
      namespace: "sluiceway-web",
      name: "web-extra",
      changeType: "REMOVE",
    };
    const { run } = answering(exited("[]"), exited(JSON.stringify([entry])));
    expect(await helm.detectDrift?.(WEB, options(run))).toMatchObject({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: [
        "The tool's output of the three-way diff, at [0].changeType: expected a removal the plain diff has too.",
      ],
    });
  });
});
