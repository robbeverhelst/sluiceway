import type { Change } from "../core/diff.ts";

// What a fold of the tool's output into changes came to (record 0007). Each
// tool folds its own output, and a tool whose output has no step Sluiceway
// could fail to know narrows the reasons to "unreadable-output".
export type Folded<
  Reason extends "unreadable-output" | "unknown-step" = "unreadable-output" | "unknown-step",
> =
  | { ok: true; changes: Change[] }
  // The detail names a place in the tool's output and what was expected
  // there, never what was found (record 0021).
  | { ok: false; reason: Reason; detail: string[] };
