import { BODY_LIMIT } from "../render/budget.ts";
import type { GitHubPort, Issue } from "./port.ts";
import { BodyTooLargeError, type BuildBody, type WriteResult, writeBody } from "./write-loop.ts";

// The bot is a constant (record 0017), so nothing is configured or discovered.
const BOT_LOGIN = "github-actions[bot]";
const BOT_TYPE = "Bot";

// The root marker on the first line (record 0009). Only its kind is read here.
// The version is not: a body of another version is still the dashboard, and
// the scan rewrites it in its own.
const ROOT_MARKER_LINE = /^<!-- sluiceway:dashboard(?: [^\r\n]*)? -->\r?(?:\n|$)/;

// The three dashboard keys of sluiceway.yaml that finding and creating need.
export interface DashboardSettings {
  label: string;
  title: string;
  pin: boolean;
}

// What the check reads of an issue, from the API or from an event payload.
export type DashboardCandidate = Pick<Issue, "labels" | "author" | "body">;

export interface DashboardResult extends WriteResult {
  number: number;
  found: "open" | "reopened" | "created";
  closedDuplicates: number[];
  pin: "not-tried" | "pinned" | "failed";
}

// Label, root marker and author together (record 0009). A person can put the
// label on any issue and can paste a marker, and cannot make the bot the
// author.
export function isDashboard(issue: DashboardCandidate, label: string): boolean {
  return issue.labels.includes(label) && isBotIssueWithRootMarker(issue);
}

// The half of that check that needs no config. `resolve` makes it first, on
// the payload of its event, so an edit of an ordinary issue never reads
// `sluiceway.yaml` (record 0017).
export function isBotIssueWithRootMarker(issue: Omit<DashboardCandidate, "labels">): boolean {
  return (
    issue.author.login === BOT_LOGIN &&
    issue.author.type === BOT_TYPE &&
    ROOT_MARKER_LINE.test(issue.body)
  );
}

// The dashboard as resolve, apply and settle look for it: the open match with
// the lowest number, or none. It never creates or repairs anything.
export async function findDashboard(github: GitHubPort, label: string): Promise<Issue | undefined> {
  return (await openMatches(github, label))[0];
}

// What a scan does with its result (record 0017: only scan creates or repairs
// the dashboard). With no dashboard, the builder gets "" as the live body.
export async function writeDashboard(
  github: GitHubPort,
  settings: DashboardSettings,
  build: BuildBody,
): Promise<DashboardResult> {
  const [dashboard, ...duplicates] = await openMatches(github, settings.label);
  if (dashboard) {
    for (const duplicate of duplicates) {
      await github.createComment(duplicate.number, duplicateComment(dashboard.number));
      await github.closeIssue(duplicate.number);
    }
    const written = await writeBody(github, dashboard.number, build);
    return {
      number: dashboard.number,
      found: "open",
      closedDuplicates: duplicates.map((duplicate) => duplicate.number),
      pin: "not-tried",
      ...written,
    };
  }

  // Reopening keeps the issue number, the pin and every link (record 0017).
  const closed = await newestClosedMatch(github, settings.label);
  if (closed) {
    await github.reopenIssue(closed.number);
    const written = await writeBody(github, closed.number, build);
    return {
      number: closed.number,
      found: "reopened",
      closedDuplicates: [],
      pin: "not-tried",
      ...written,
    };
  }

  // A create is refused over the limit, so the check comes first here too.
  const body = await build("");
  if (body.length > BODY_LIMIT) throw new BodyTooLargeError(body);
  const created = await github.createIssue({
    title: settings.title,
    body,
    labels: [settings.label],
  });
  const pin = settings.pin ? await tryPin(github, created) : "not-tried";
  // A create is a write like any other: it is read back, and the loop takes
  // over if what GitHub stored is not what was sent.
  const verified = await writeBody(github, created.number, build);
  return {
    number: created.number,
    found: "created",
    closedDuplicates: [],
    pin,
    ...verified,
    written: true,
  };
}

function duplicateComment(dashboard: number): string {
  return `Sluiceway found more than one dashboard in this repo. The dashboard is #${dashboard}, the one with the lowest number, so this one was closed.`;
}

// Only a new dashboard is pinned. One that exists is left as it is, so a
// person who unpins it does not find it pinned again after the next scan.
// Best effort: a repo holds three pinned issues, and a failed pin is no reason
// to fail a scan.
async function tryPin(github: GitHubPort, issue: Issue): Promise<"pinned" | "failed"> {
  try {
    await github.pinIssue(issue.nodeId);
    return "pinned";
  } catch {
    return "failed";
  }
}

// "Newest" is the one closed last. By number, a duplicate that a scan closed
// long ago would win over the real dashboard that a person closed yesterday.
async function newestClosedMatch(github: GitHubPort, label: string): Promise<Issue | undefined> {
  const closed = await github.listIssues({ label, state: "closed" });
  return closed
    .filter((issue) => isDashboard(issue, label))
    .sort((a, b) => compare(b.closedAt ?? "", a.closedAt ?? "") || b.number - a.number)[0];
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

async function openMatches(github: GitHubPort, label: string): Promise<Issue[]> {
  const open = await github.listIssues({ label, state: "open" });
  return open.filter((issue) => isDashboard(issue, label)).sort((a, b) => a.number - b.number);
}
