// The coloured dots (record 0040). They are signals, like the signal colours
// in the picture, never the voice (record 0032): the words next to a dot
// always say what it means.

import type { HeaderState } from "./header-state.ts";
import type { ApplyResultOutcome } from "./result-file.ts";

// The count dots of the counts line. A count of 0 gets the white dot, so a
// red dot always means there is something to look at.
export const COUNT_DOT = {
  pending: "🟡",
  drift: "🟠",
  deploying: "🔵",
  "preview-failed": "🔴",
  "in-sync": "🟢",
  failed: "🔴",
} as const;
export const DOT_AT_ZERO = "⚪";

// The result of one `apply`, in front of its line in the recently deployed
// list, of its headline in the job log, and of a notification (slice 4.5).
// Green went out and red failed, as on the counts line. White is nothing went
// out, as a count of 0 is. Yellow is a refusal: nothing went out and the stack
// is pending again. Purple is a rehearsal, the one result the counts line has
// no colour for.
export const RESULT_DOT: Record<ApplyResultOutcome, string> = {
  deployed: "🟢",
  failed: "🔴",
  refused: COUNT_DOT.pending,
  "in-sync": DOT_AT_ZERO,
  rehearsed: "🟣",
};

// The result of a scan: the dashboard it wrote, as its header state says.
// Each state has the colour of the count that decides it.
export const HEADER_DOT: Record<HeaderState, string> = {
  failing: COUNT_DOT.failed,
  deploying: COUNT_DOT.deploying,
  pending: COUNT_DOT.pending,
  drift: COUNT_DOT.drift,
  "first-run": DOT_AT_ZERO,
  "in-sync": COUNT_DOT["in-sync"],
};
