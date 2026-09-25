// What a run of an infrastructure tool comes to, as the rules of core/ and
// the rows of render/ read it: a preview, a deploy, the drift check, the
// tool's own diff, one entry of its history, one plain run. An adapter fills
// these in and nothing here names a tool, so core/ and render/ reach no
// adapters/ file, not even by a type import (issue 245): a consumer that
// reuses them as a library and walks imports never arrives at a tool. The
// interface an adapter implements, and what a call hands it, stay in
// adapters/adapter.ts.

import type { CostResult } from "./cost.ts";
import type { Change, Diff } from "./diff.ts";
import type { DeployFailureReason, PreviewFailureReason } from "./failure-reason.ts";

// The tool's own preview document, values and all (record 0021): Pulumi's
// preview JSON, the plan JSON of OpenTofu and Terraform, the manifests a Helm
// chart or a directory of Kubernetes manifests renders. It exists only for
// the policy runner, which writes it to a file of its own for as long as
// conftest runs (record 0106). Nothing else may take `text`: not a row, the
// summary, a page, the result file, an annotation or the job log.
export interface PreviewDocument {
  text: string;
  format: "json" | "yaml";
}

// The stacks a preview read that its stack depends on (record 0059). Only
// stack ids of the repo leave the adapter, never the name a program wrote.
export interface ReadDependencies {
  // In stack id order, each once, never the stack itself.
  stackIds: string[];
  // References that name no stack among the ones handed in, or more than one.
  // Nothing waits on them.
  elsewhere: number;
}

// A plan the tool saved, which only its own adapter can read. It lives inside
// one `apply` job, is never written anywhere Sluiceway writes and never
// travels between jobs (record 0053). A plan file holds values in plain text
// (record 0021), so dispose removes it.
export interface SavedPlan {
  dispose(): Promise<void>;
}

export type PreviewResult = (
  | {
      ok: true;
      diff: Diff;
      // Only when the preview was asked to save its plan and the tool can.
      plan?: SavedPlan;
      // Only when the preview was asked to read them and the tool can.
      dependencies?: ReadDependencies;
      // Only when the preview was asked to keep it (record 0106).
      document?: PreviewDocument;
      // Only when the preview was asked for it and the tool has an estimate:
      // what the change costs a month, or why no estimate came back. Never
      // part of the diff hash (record 0105).
      cost?: CostResult;
    }
  | {
      ok: false;
      reason: PreviewFailureReason;
      // Sluiceway's own words on what went wrong, for the job log. They name a
      // place in the tool's output and what was expected there, never what was
      // found (record 0021).
      detail: string[];
    }
) & {
  // The tool's own words: its stderr and its diagnostics, with ANSI escapes
  // stripped. They can quote a value, so they go to the job log and nowhere
  // else (record 0022).
  toolLog: string;
};

export type ApplyResult = (
  | { ok: true }
  // `moved`: the deploy did not start, because what it would deploy is no
  // longer what the fresh preview saw, and the tool cannot hold it to that
  // by itself. Only the Helm adapter gives it (record 0058).
  | { ok: false; reason: Extract<DeployFailureReason, { kind: "tool-error" } | { kind: "moved" }> }
) & {
  // The tool's own words, with ANSI escapes stripped. They go to the job log
  // and nowhere else (record 0022).
  toolLog: string;
};

// What the drift check found (record 0055): the changes made to real
// infrastructure outside the code, with the ops `update` (a property changed)
// and `delete` (the object is gone). No value, like a diff (record 0021).
export type DriftResult = (
  | { ok: true; drift: Change[] }
  | { ok: false; reason: PreviewFailureReason; detail: string[] }
) & {
  // The tool's own words, for the job log only (record 0022).
  toolLog: string;
};

// One deploy that the tool's own history holds for a stack (record 0073): a
// deploy that went out and changed something, by whoever ran it. It has no
// field that could hold a value, a message or a person.
export interface ToolDeploy {
  kind: "deploy" | "destroy";
  // When it ended, by the clock of the machine that ran it, in whole seconds.
  endedAt: Date;
  // The commit that was checked out, and whether the tree held changes that
  // are in no commit. Absent when the tool recorded none.
  commit?: { sha: string; dirty: boolean };
  // The GitHub Actions run it ran in, when it ran in one. Sluiceway's own
  // deploys are told apart by it.
  runId?: string;
}

// The tool's own diff (record 0048): what a deploy would change as the tool
// displays it, values included, except the ones the tool holds as secret. It
// exists only for the job log, in the group of its stack, and only when a repo
// turned `scan.logDiff` on. Nothing else may take `text`: not a row, the
// summary, the result file, an annotation or a deployment record.
export type ToolDiffResult = (
  | { ok: true; text: string }
  | { ok: false; reason: PreviewFailureReason }
) & {
  // The tool's other words, with ANSI escapes stripped (record 0022).
  toolLog: string;
};

// One run of a tool and what it came to: the tool's output, or a reason from
// the fixed list of record 0022. Every adapter starts its tool through
// adapters/tool-run.ts, which decides the reason in one place.
export type ToolRun =
  | {
      ok: true;
      exitCode: number;
      stdout: string;
      stderr: string;
      // Set when a stream printed more than the runner holds (slice 5.9).
      outputCutAt?: number;
    }
  | { ok: false; reason: PreviewFailureReason; stdout: string; stderr: string };
