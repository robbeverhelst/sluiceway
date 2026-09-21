import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANARY_VALUE } from "../../../scripts/fixtures/example.ts";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, FIXTURES, type Replay, ROOT, replay, VERSIONS } from "./replay.ts";

// A preview that gives no diff is a preview failure with a reason from the
// fixed list of record 0022. The tool's words are in toolLog and nowhere else.

const NETWORK_DEV: Stack = { path: "network", name: "dev", options: {} };

function previewWith(stack: Stack, { run }: Replay): Promise<PreviewResult> {
  return pulumi.preview(stack, { root: ROOT, env: {}, run, timeoutMinutes: 10 });
}

for (const version of VERSIONS) {
  describe(`a failed preview, replaying pulumi ${version}`, () => {
    // The tool exits with an error, prints a whole document and leaves stderr
    // empty. What went wrong is only in the document's diagnostics.
    test("a program error gives the exit code, and the diagnostics without ANSI escapes", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "program-error"));

      expect(result).toEqual({
        ok: false,
        reason: { kind: "tool-error", exitCode: 1 },
        detail: [],
        toolLog: [
          'Error: error resolving type of resource subnet: unable to find resource type "random:NoSuchThing" in resource provider "random"\n\n',
          "  on Pulumi.yaml line 19:\n\n",
          "  19:     type: random:NoSuchThing\n\n",
        ].join(""),
      });
    });

    // Record 0022 as amended. The tool's words still go to the job log, and
    // the reason holds none of them, not even the stack's name.
    test("a stack the backend does not hold is a reason of its own, with the tool's stderr", async () => {
      const ghost: Stack = { path: "network", name: "ghost", options: {} };
      const result = await previewWith(ghost, replay(version, "missing-stack"));

      expect(result).toEqual({
        ok: false,
        reason: { kind: "stack-not-found" },
        detail: [],
        toolLog: "error: no stack named 'ghost' found\n",
      });
    });

    test("a missing config value gives the exit code and the tool's stderr", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "missing-config"));

      expect(result).toEqual({
        ok: false,
        reason: { kind: "tool-error", exitCode: 1 },
        detail: [],
        toolLog:
          "error: validating stack config: Stack 'dev' is missing configuration value 'zone'\n",
      });
    });
  });
}

// The reason is picked from the exit code the tool documents for a stack that
// is not found, and from nothing else (record 0022 as amended). The tool's
// message is never read, so no part of it can reach a row.
describe("which exit code means that the stack does not exist", () => {
  const MISSING = "error: no stack named 'ghost' found\n";

  test("exit code 6 gives the reason whatever the tool printed", async () => {
    const runner = answering({
      status: "exited",
      exitCode: 6,
      stdout: "",
      stderr: `${CANARY_VALUE}\n`,
    });

    expect(await previewWith(NETWORK_DEV, runner)).toEqual({
      ok: false,
      reason: { kind: "stack-not-found" },
      detail: [],
      toolLog: `${CANARY_VALUE}\n`,
    });
  });

  for (const exitCode of [1, 2, 3, 4, 5, 7, 8, 9, 255]) {
    test(`exit code ${exitCode} stays a tool error, also when the tool's words say the stack is missing`, async () => {
      const runner = answering({ status: "exited", exitCode, stdout: "", stderr: MISSING });

      expect(await previewWith(NETWORK_DEV, runner)).toEqual({
        ok: false,
        reason: { kind: "tool-error", exitCode },
        detail: [],
        toolLog: MISSING,
      });
    });
  }
});

describe("what a recording cannot hold", () => {
  test("a preview that ran out of time says how long it had", async () => {
    const runner = answering({ status: "timed-out", stdout: "", stderr: "^C\n" });
    const result = await pulumi.preview(NETWORK_DEV, {
      root: ROOT,
      env: {},
      run: runner.run,
      timeoutMinutes: 7,
    });

    expect(runner.runs[0]?.timeoutMs).toBe(7 * 60 * 1000);
    expect(result).toEqual({
      ok: false,
      reason: { kind: "timed-out", minutes: 7 },
      detail: [],
      toolLog: "^C\n",
    });
  });

  test("a tool that could not be started is a tool error without an exit code", async () => {
    const result = await previewWith(NETWORK_DEV, answering({ status: "not-started" }));

    expect(result).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: null },
      detail: [],
      toolLog: "",
    });
  });

  test("a tool that a signal ended is a tool error without an exit code", async () => {
    const ended = answering({ status: "exited", exitCode: null, stdout: "", stderr: "Killed\n" });
    const result = await previewWith(NETWORK_DEV, ended);

    expect(result).toEqual({
      ok: false,
      reason: { kind: "tool-error", exitCode: null },
      detail: [],
      toolLog: "Killed\n",
    });
  });
});

// The recorded document of the update scenario, changed in one place. These
// are not fixtures: they stand for a tool whose output moved.
type Document = { steps: Record<string, unknown>[] };

function changedOutput(change: (document: Document) => unknown): Replay {
  const file = join(FIXTURES, VERSIONS[0] ?? "", "update", "preview.stdout");
  const document = JSON.parse(readFileSync(file, "utf8")) as Document;
  const stdout = JSON.stringify(change(document) ?? document);
  return answering({ status: "exited", exitCode: 0, stdout, stderr: "" });
}

function theUpdateStep(document: Document): Record<string, unknown> {
  const step = document.steps[1];
  if (step?.op !== "update") throw new Error("the update scenario has moved");
  return step;
}

describe("output that Sluiceway cannot read", () => {
  test("text that is not JSON names no part of it", async () => {
    const runner = answering({
      status: "exited",
      exitCode: 0,
      stdout: `${CANARY_VALUE} is not JSON`,
      stderr: "",
    });

    expect(await previewWith(NETWORK_DEV, runner)).toEqual({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: ["The tool's output: expected one JSON document."],
      toolLog: "",
    });
  });

  test("a field of the wrong kind names its path and what was expected, never what was found", async () => {
    const runner = changedOutput((document) => {
      theUpdateStep(document).urn = { secret: CANARY_VALUE };
      theUpdateStep(document).diffReasons = "environment";
    });

    expect(await previewWith(NETWORK_DEV, runner)).toEqual({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: [
        "The tool's output, at steps[1].urn: expected text.",
        "The tool's output, at steps[1].diffReasons: expected a list.",
      ],
      toolLog: "",
    });
  });

  // An empty list of steps would read as in sync.
  test("a document without steps is not an empty diff", async () => {
    const runner = changedOutput(({ steps: _, ...rest }) => rest);

    expect(await previewWith(NETWORK_DEV, runner)).toEqual({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: ["The tool's output, at steps: expected a list."],
      toolLog: "",
    });
  });

  test("an address that is not a URN names the step", async () => {
    const runner = changedOutput((document) => {
      theUpdateStep(document).urn = CANARY_VALUE;
    });

    expect(await previewWith(NETWORK_DEV, runner)).toEqual({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: ["The tool's output, at steps[1].urn: expected the URN of a resource."],
      toolLog: "",
    });
  });

  // An address is unique within a diff (record 0007). The diff hash leaves
  // refusing such a diff to where diffs are built.
  test("two changes at one address are refused", async () => {
    const runner = changedOutput((document) => {
      document.steps.push({ ...theUpdateStep(document), op: "delete" });
    });

    expect(await previewWith(NETWORK_DEV, runner)).toEqual({
      ok: false,
      reason: { kind: "unreadable-output" },
      detail: [
        "The tool's output, at steps[2].urn: expected an address that no earlier step has, and steps[1] has it.",
      ],
      toolLog: "",
    });
  });

  test("a dropped step may share its address with a change", async () => {
    const runner = changedOutput((document) => {
      document.steps.push({ ...theUpdateStep(document), op: "same" });
    });
    const result = await previewWith(NETWORK_DEV, runner);

    expect(result.ok && result.diff.changes.map((change) => change.op)).toEqual(["update"]);
  });
});

describe("a step Sluiceway does not know", () => {
  test("fails the preview and is never shown as in sync", async () => {
    const runner = changedOutput((document) => {
      theUpdateStep(document).op = "discard-replaced";
    });

    expect(await previewWith(NETWORK_DEV, runner)).toEqual({
      ok: false,
      reason: { kind: "unknown-step" },
      detail: ["The tool's output, at steps[1].op: expected a step op that Sluiceway knows."],
      toolLog: "",
    });
  });

  // Record 0007 names them as steps that change nothing.
  for (const op of ["read", "refresh"]) {
    test(`a ${op} step is dropped`, async () => {
      const runner = changedOutput((document) => {
        theUpdateStep(document).op = op;
      });
      const result = await previewWith(NETWORK_DEV, runner);

      expect(result.ok && result.diff.changes).toEqual([]);
    });
  }
});

describe("the paths of a detailed diff", () => {
  test("give their first segment, whatever form the path has", async () => {
    const runner = changedOutput((document) => {
      theUpdateStep(document).detailedDiff = {
        "environment.STAGE": {},
        "environment.NOTE": {},
        "triggers[0]": {},
        '["dotted.name"].inner': {},
        '["with \\"quotes\\""]': {},
        plain: {},
      };
    });
    const result = await previewWith(NETWORK_DEV, runner);

    expect(result.ok && result.diff.changes[0]?.changedKeys).toEqual([
      "dotted.name",
      "environment",
      "plain",
      "triggers",
      'with "quotes"',
    ]);
  });

  // The names are the only source then, as on a replace.
  test("fall back to the tool's list of names when there are none", async () => {
    const runner = changedOutput((document) => {
      theUpdateStep(document).detailedDiff = {};
    });
    const result = await previewWith(NETWORK_DEV, runner);

    expect(result.ok && result.diff.changes[0]?.changedKeys).toEqual(["environment"]);
  });
});
