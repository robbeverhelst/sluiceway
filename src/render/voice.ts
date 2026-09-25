// Every fixed line of the body outside the rows. The voice is allowed in
// exactly two of them, the good-news line and the first-run line (record
// 0032). A new place for the voice means amending that record.

export interface VoicedLines {
  // Under the Pending heading when every stack is in sync. `stacks` is how
  // many there are, and `day` the time of the scan the body shows, which
  // picks the warm line (record 0075). A warm line never carries a number.
  goodNews: (stacks: number, day: Date | undefined) => string;
  // Under the Pending heading when the scan found no stacks.
  firstRun: string;
}

// One water image, then the fact. Penny does not speak: the line describes
// the water. Three lines, so one read every day does not wear thin (record
// 0075).
export const GOOD_NEWS = [
  "Gate closed, water calm. Nothing to deploy.",
  "Level water on both sides of the gate. Nothing to deploy.",
  "Still water upstream. Nothing to deploy.",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

// One line per UTC day in turn, counted from 1970-01-01, so the same scan day
// always gives the same body (record 0004). Without a day, the first line.
function goodNewsOf(day: Date | undefined): string {
  const days = Math.floor((day?.getTime() ?? Number.NaN) / DAY_MS);
  return GOOD_NEWS[Number.isNaN(days) ? 0 : days % GOOD_NEWS.length] ?? GOOD_NEWS[0];
}

export const WARM: VoicedLines = {
  goodNews: (_stacks, day) => goodNewsOf(day),
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

// The same with drifted rows on the page (record 0055): nothing waits from
// the code, and a drifted row can still be deployed.
export const NOTHING_FROM_THE_CODE = "Nothing to deploy from the code.";

// Under the Drifted heading (record 0055).
export const DRIFTED_LINE =
  "Real infrastructure changed outside the code. Deploying a stack puts it back as its code says.";

export const INSTRUCTION_LINE = "Tick a box to deploy that stack exactly as its row shows it.";

// Under the heading of the updates waiting to merge (record 0054). Plain.
export const MERGE_LINE =
  "Tick a box to merge that pull request. Its stack is then previewed again and deployed as that preview shows it.";

// Above the updates waiting on their checks (record 0081). Plain.
export const WAITING_ON_CHECKS_LINE =
  "These wait on their own checks. Each gets a box here once its checks are green.";

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
// It names each section that has a shortened row, in the order of the body,
// so it is true for any mix and reads as it always did when only pending rows
// are shortened (record 0084).
export interface ShortenedSection {
  section: "pending" | "drifted";
  shortened: number;
  // The rows of the section, shortened or not.
  of: number;
}

export function shortenedNote(sections: readonly ShortenedSection[]): string {
  const named = sections.filter((one) => one.shortened > 0);
  const counts = named
    .map(
      ({ section, shortened, of }) => `${shortened} of ${of} ${section} row${of === 1 ? "" : "s"}`,
    )
    .join(" and ");
  const one = named.length === 1 && named[0]?.shortened === 1;
  return `> [!NOTE]\n> This dashboard is too large for one issue, so ${counts} ${
    one ? "is" : "are"
  } shortened. The summary that a shortened row links to shows every change. Deletes and replaces are the last thing to be cut.`;
}

// The destroy alert of `dashboard.destroyAlert: always` on a body with nothing
// to warn about (record 0114). A note and not a caution: a red block that
// warns of nothing every day teaches people to read past it.
export const NO_DESTROY_NOTE = "> [!NOTE]\n> No pending stack deletes or replaces resources.";
