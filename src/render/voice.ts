// Every fixed line of the body outside the rows. The voice is allowed in
// exactly two of them, the good-news line and the first-run line (record
// 0032). A new place for the voice means amending that record.

export interface VoicedLines {
  // Under the Pending heading when every stack is in sync. `stacks` is how
  // many there are. A warm line never carries a number.
  goodNews: (stacks: number) => string;
  // Under the Pending heading when the scan found no stacks.
  firstRun: string;
}

// One water image, then the fact. Penny does not speak: the line describes
// the water.
export const WARM: VoicedLines = {
  goodNews: () => "Gate closed, water calm. Nothing to deploy.",
  firstRun: "The channel is dry. Add a stack to `sluiceway.yaml` and the next scan fills it.",
};

// Not a fallback of lower quality: what a dashboard with
// `dashboard.personality: false` shows (record 0034).
export const DRY: VoicedLines = {
  goodNews: (stacks) =>
    `Nothing to deploy. ${stacks === 1 ? "1 stack is" : `All ${stacks} stacks are`} in sync.`,
  firstRun: "No stacks found yet. Add one to `sluiceway.yaml` and the next scan lists it here.",
};

// The dry line without the count: nothing is pending, and the page is not
// calm. The rows that are not calm speak for themselves.
export const NOTHING_TO_DEPLOY = "Nothing to deploy.";

export const INSTRUCTION_LINE = "Tick a box to deploy that stack exactly as its row shows it.";

// Under the heading of the updates waiting to merge (record 0054). Plain.
export const MERGE_LINE =
  "Tick a box to merge that pull request. Its stack is then previewed again and deployed as that preview shows it.";

// Under the Pending heading of a read-only dashboard while rows are pending
// (slice 2.17). Plain, like every line but the two of record 0032.
export const READ_ONLY_LINE =
  "This dashboard is read only, so rows have no boxes and nothing deploys from here. Rows get their boxes when `dashboard.readOnly` comes out of `sluiceway.yaml`.";

export const PREVIEW_FAILED_LINE =
  "These stacks could not be previewed, so they cannot be deployed from here until a scan succeeds.";

// The note under the scan line when the size budget shortened rows (record
// 0028). An alert renders there, because it is outside any list. It links
// nothing itself: a row that a narrowed scan carried through links to the
// summary of an earlier run, so every shortened row holds its own link.
export function shortenedNote(shortened: number, pending: number): string {
  const rows = `${pending} pending row${pending === 1 ? "" : "s"}`;
  return `> [!NOTE]\n> This dashboard is too large for one issue, so ${shortened} of ${rows} ${
    shortened === 1 ? "is" : "are"
  } shortened. The summary that a shortened row links to shows every change. Deletes and replaces are the last thing to be cut.`;
}
