import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CANARY_SECRET, CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import { kubectl } from "../../../src/adapters/kubectl/index.ts";
import { canonicalDiff } from "../../../src/core/diff-hash.ts";
import { previewFailureText } from "../../../src/core/failure-reason.ts";
import { stackId } from "../../../src/core/stack.ts";
import { scanResultFile } from "../../../src/render/result-file.ts";
import { renderRow } from "../../../src/render/row.ts";
import { renderSummary } from "../../../src/render/summary.ts";
import { annex, RESULT, rows } from "../canary-surfaces.ts";
import { FIXTURES, ROOT, readRecording, replay, scenarioNames, VERSIONS } from "./replay.ts";
import { CACHE, WEB } from "./stacks.ts";

// The canary test of record 0021, for Kubernetes manifests (record 0060).
// kubectl diff prints both sides of every object in plain text: CANARY-VALUE
// in a ConfigMap and in a container's arguments. The Secret's CANARY-SECRET is
// in the manifests and in the rendered set, and kubectl masks it as "***" in
// what it prints. Every recorded diff goes through the adapter, the core and
// every renderer, and nothing that comes out may hold the canary, the secret,
// its base64 form or kubectl's mask. This test stays in the suite forever.

const SECRET_BASE64 = Buffer.from(CANARY_SECRET).toString("base64");
const FORBIDDEN = [CANARY_VALUE, CANARY_SECRET, SECRET_BASE64, "CANARY", "***"];

function leaks(text: string): string[] {
  return FORBIDDEN.filter((word) => text.includes(word));
}

type Command = ReturnType<typeof readRecording>["commands"][number];

const isPreviewDiff = (command: Command) =>
  command.argv[1] === "diff" && command.env?.KUBECTL_EXTERNAL_DIFF !== undefined;
const isToolDiff = (command: Command) =>
  command.argv[1] === "diff" && command.env?.KUBECTL_EXTERNAL_DIFF === undefined;

const stackOf = (command: Command) => (command.cwd === "cache" ? CACHE : WEB);

describe("the check itself", () => {
  // Otherwise the tests below could pass on recordings that hold nothing.
  test("the diff holds the canary value in plain text and the secret masked", () => {
    for (const version of VERSIONS) {
      const raw = ["update", "changed-secret"]
        .map((scenario) => readFileSync(join(FIXTURES, version, scenario, "diff.stdout"), "utf8"))
        .join("\n");
      expect(leaks(raw)).toEqual([CANARY_VALUE, "CANARY", "***"]);
    }
  });

  test("the rendered set of web holds the secret itself", () => {
    expect(readFileSync(join(ROOT, "web", "secret.yaml"), "utf8")).toContain(CANARY_SECRET);
  });
});

for (const version of VERSIONS) {
  describe(`no value leaves the adapter, replaying kubectl ${version}`, () => {
    for (const scenario of scenarioNames(version)) {
      const commands = readRecording(version, scenario).commands;
      const previews = commands.filter(isPreviewDiff);
      const toolDiffs = commands.filter(isToolDiff);
      if (previews.length + toolDiffs.length === 0) continue;

      test(scenario, async () => {
        const runner = replay(version, scenario);
        const options = { root: ROOT, env: {}, run: runner.run, timeoutMinutes: 10 };
        // The tool's own diff holds values on purpose (record 0048). Only its
        // text may, and only the job log takes that.
        for (const command of toolDiffs) {
          const result = await kubectl.toolDiff(stackOf(command), options);
          const { text: _text, ...rest } = result.ok ? result : { ...result, text: "" };
          expect(leaks(JSON.stringify(rest))).toEqual([]);
        }
        for (const command of previews) {
          const stack = stackOf(command);
          const result = await kubectl.preview(stack, { ...options, savePlan: true });
          const failed = {
            kind: "preview-failed",
            stackId: stackId(stack),
            reason: result.ok ? "" : previewFailureText(result.reason),
          } as const;
          const made = result.ok
            ? canonicalDiff(result.diff) + rows(result.diff) + annex(result.diff)
            : renderSummary([failed]).text +
              scanResultFile({ ...RESULT, stacks: [{ stack: failed, milliseconds: 1 }] }) +
              renderRow({
                state: "preview-failed",
                stackId: stackId(stack),
                reason: previewFailureText(result.reason),
                runUrl: "run-url",
              });
          const { plan, ...handed } = result.ok ? result : { ...result, plan: undefined };
          expect(leaks(JSON.stringify(handed) + made)).toEqual([]);
          // A deploy of the rendered set hands over nothing with a value
          // either, and the set, which holds every value, goes.
          if (plan !== undefined) {
            if (commands.some((one) => one.argv[1] === "apply")) {
              const applied = await kubectl.apply(stack, options, plan);
              expect(leaks(JSON.stringify(applied))).toEqual([]);
            }
            await plan.dispose();
          }
        }
        for (const set of runner.sets) expect(existsSync(dirname(set.path))).toBe(false);
      });
    }
  });

  // The worst list there is: every path that any recorded diff changes.
  // Values of the manifests may then appear. A Secret's never does, and
  // neither does kubectl's mask.
  describe(`a list that names every changed path, replaying kubectl ${version}`, () => {
    for (const scenario of scenarioNames(version)) {
      const previews = readRecording(version, scenario).commands.filter(isPreviewDiff);
      if (previews.length === 0) continue;
      test(scenario, async () => {
        for (const command of previews) {
          const options = { root: ROOT, env: {}, timeoutMinutes: 10 };
          const first = await kubectl.preview(stackOf(command), {
            ...options,
            run: replay(version, scenario).run,
          });
          const every = first.ok ? first.diff.changes.flatMap((change) => change.changedKeys) : [];
          const result = await kubectl.preview(stackOf(command), {
            ...options,
            run: replay(version, scenario).run,
            showValues: [...every, "data.*", "data", "stringData.*"],
          });
          const made = result.ok ? rows(result.diff) + annex(result.diff) : "";
          const text = JSON.stringify(result) + made;
          expect(text).not.toContain(CANARY_SECRET);
          expect(text).not.toContain(SECRET_BASE64);
          expect(text).not.toContain("***");
        }
      });
    }
  });

  test(`a listed path shows its value and is hashed, replaying kubectl ${version}`, async () => {
    const result = await kubectl.preview(WEB, {
      root: ROOT,
      env: {},
      run: replay(version, "update").run,
      timeoutMinutes: 10,
      showValues: ["spec.replicas", "spec.template.spec.containers[*].image"],
    });
    if (!result.ok) throw new Error("expected a diff");
    const deployment = result.diff.changes.find((change) => change.type === "Deployment");
    expect(deployment?.values).toEqual([
      { path: "spec.replicas", old: "1", new: "2" },
      {
        path: "spec.template.spec.containers[0].image",
        old: "registry.k8s.io/pause:3.10",
        new: "registry.k8s.io/pause:3.9",
      },
    ]);
    // An unlisted path on another object shows nothing.
    const settings = result.diff.changes.find((change) => change.type === "ConfigMap");
    expect(settings?.values).toBeUndefined();
    expect(canonicalDiff(result.diff)).toContain('"new":"2"');
  });
}

test("every scenario but the version check and the failed kustomization is covered", () => {
  for (const version of VERSIONS) {
    const without = scenarioNames(version).filter((scenario) =>
      readRecording(version, scenario).commands.every(
        (command) => !isPreviewDiff(command) && !isToolDiff(command),
      ),
    );
    expect(without).toEqual(["kustomize-error", "version"]);
  }
});
