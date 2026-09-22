import { join } from "node:path";
import type { Change } from "../../core/diff.ts";
import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import type { Stack } from "../../core/stack.ts";
import type { DriftResult, PreviewOptions } from "../adapter.ts";
import type { Folded } from "../folded.ts";
import { runTool, stripAnsi } from "../tool-run.ts";
import { diffCommand, threeWayDiffCommand } from "./commands.ts";
import { helmEnvironment, optionsOf } from "./environment.ts";
import { addressOf, foldEntries } from "./fold.ts";
import { type Entry, parseEntries } from "./schema.ts";

// The drift check of a Helm stack (record 0069). The preview's diff compares
// the chart with the manifest helm stored for the release, so a change made
// to a live object with kubectl never shows in it. The diff plugin's
// three-way merge compares the chart with the live objects instead, the way
// a deploy merges it into them: it shows the code's changes and, next to
// them, what the deploy would put back. What it finds beyond the plain diff
// is drift:
//
// - an object the three-way diff adds and the plain diff does not is gone
//   from the cluster: `delete`;
// - a path the three-way diff changes and the plain diff does not was
//   changed outside the code: `update` with those paths. A path that both
//   change is the code's change, and the deploy sets it to the code's value
//   either way;
// - a removal the plain diff does not have cannot happen, since both read the
//   removed objects from the release, so it is output Sluiceway cannot read.
//
// A field nobody set in the chart, such as a label added by hand, is kept by
// a deploy, and neither diff shows it. Both run in the stack's directory with
// its time limit, one after the other, and neither changes anything.
export async function detectDrift(stack: Stack, options: PreviewOptions): Promise<DriftResult> {
  const helm = optionsOf(stack);
  const run = (argv: string[]) =>
    runTool(options.run, {
      argv,
      cwd: join(options.root, stack.path),
      env: helmEnvironment(options.env),
      timeoutMinutes: options.timeoutMinutes,
    });
  const failed = (
    reason: PreviewFailureReason,
    toolLog: string,
    detail: string[] = [],
  ): DriftResult => ({ ok: false, reason, detail, toolLog });

  const outputs: string[] = [];
  let words = "";
  for (const argv of [diffCommand(helm), threeWayDiffCommand(helm)]) {
    const result = await run(argv);
    // Never stdout: it holds the old and new value of every changed field,
    // the live ones included (record 0021).
    words += stripAnsi(result.stderr);
    if (!result.ok) return failed(result.reason, words);
    outputs.push(result.stdout);
  }

  const [plain, threeWay] = outputs.map(parseEntries);
  for (const parsed of [plain, threeWay]) {
    if (parsed !== undefined && !parsed.ok) {
      return failed({ kind: "unreadable-output" }, words, parsed.problems);
    }
  }
  if (!plain?.ok || !threeWay?.ok) return failed({ kind: "unreadable-output" }, words);
  const found = driftOf(plain.entries, threeWay.entries, helm.namespace);
  if (!found.ok) return failed({ kind: found.reason }, words, found.detail);
  return { ok: true, drift: found.changes, toolLog: words };
}

// What the three-way diff finds beyond the plain one. No value is read: the
// fold hands over paths only when no path is listed (record 0055).
function driftOf(plain: Entry[], threeWay: Entry[], namespace: string): Folded {
  const code = foldEntries(plain, namespace, []);
  if (!code.ok) return code;
  const live = foldEntries(threeWay, namespace, []);
  if (!live.ok) return live;

  const byAddress = new Map(code.changes.map((change) => [change.address, change]));
  const at = new Map(threeWay.map((entry, index) => [addressOf(entry), index]));
  const drift: Change[] = [];
  const unreadable: string[] = [];
  for (const change of live.changes) {
    const known = byAddress.get(change.address);
    if (change.op === "delete") {
      if (known?.op !== "delete") {
        unreadable.push(
          `The tool's output of the three-way diff, at [${at.get(change.address)}].changeType: expected a removal the plain diff has too.`,
        );
      }
    } else if (change.op === "create") {
      if (known?.op !== "create") drift.push({ ...change, op: "delete", changedKeys: [] });
    } else {
      const code = new Set(known?.changedKeys ?? []);
      const changedKeys = change.changedKeys.filter((path) => !code.has(path));
      if (changedKeys.length > 0) drift.push({ ...change, changedKeys });
    }
  }
  if (unreadable.length > 0) return { ok: false, reason: "unreadable-output", detail: unreadable };
  return { ok: true, changes: drift };
}
