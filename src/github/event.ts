// The payload of the event that woke the job, as the runner wrote it to
// `GITHUB_EVENT_PATH`. For `resolve` it is only a wake-up (record 0025): the
// one thing read from it is the edited issue, for the cheap check of record
// 0017 that costs no API call. Nothing about a tick is ever taken from it,
// because its body is the newest one at delivery time and not the body of its
// own edit (issue 28).

import { MERGE_SCAN_INPUT, readMergeScanInput } from "../core/merge-scan.ts";
import type { Issue } from "./port.ts";

export type EventIssue = Pick<Issue, "number" | "state" | "body" | "labels" | "author">;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The issue an `issues` event is about, or nothing for a payload of any other
// event. GitHub gives null for a missing body and for an author that is gone.
export function editedIssue(payload: unknown): EventIssue | undefined {
  const issue = record(record(payload)?.issue);
  if (!issue || typeof issue.number !== "number" || issue.pull_request !== undefined) {
    return undefined;
  }
  const user = record(issue.user);
  const labels = Array.isArray(issue.labels) ? issue.labels : [];
  return {
    number: issue.number,
    // Only an issue GitHub calls open is open.
    state: issue.state === "open" ? "open" : "closed",
    body: text(issue.body),
    labels: labels.flatMap((label) => {
      const name = typeof label === "string" ? label : record(label)?.name;
      return typeof name === "string" ? [name] : [];
    }),
    author: { login: text(user?.login), type: text(user?.type) },
  };
}

// The payload as the runner wrote it, read once by the glue. A job without a
// readable payload has no issue to look at, which `resolve` treats like an
// event that is not about an issue.
export function readEventPayload(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string,
): unknown {
  const path = env.GITHUB_EVENT_PATH;
  if (!path) return undefined;
  try {
    return JSON.parse(readFile(path));
  } catch {
    return undefined;
  }
}

// Whether the repository is public, from the payload of the event (record
// 0048). GitHub gives `private: false` for a public repository and `true` for
// a private or internal one. Nothing when the payload does not say.
export function publicRepo(payload: unknown): boolean | undefined {
  const isPrivate = record(record(payload)?.repository)?.private;
  return typeof isPrivate === "boolean" ? !isPrivate : undefined;
}

// Whether a person started the run, from the sender of the event (record
// 0055). A dispatch by the workflow token, as `settle` and the rescan box
// send, names the bot. Nothing that does not say is a person.
export function startedByPerson(payload: unknown): boolean {
  return record(record(payload)?.sender)?.type === "User";
}

// The pull requests `resolve` merged before it dispatched this run, from the
// dispatch's input (record 0064). A run a person started with the input filled
// in by hand is theirs, and stays a full scan.
export function mergedBeforeDispatch(payload: unknown): number[] {
  if (startedByPerson(payload)) return [];
  return readMergeScanInput(record(record(payload)?.inputs)?.[MERGE_SCAN_INPUT]);
}

// Who merged, for a stack set to on-merge (record 0095): the sender of a push
// to the default branch, the person who pressed merge or an app that merges,
// as GitHub names them. Nobody for any other event or branch, or a payload
// that does not say, so only the scan of a merge deploys on merge.
export function mergedBy(eventName: string, payload: unknown): string | undefined {
  if (eventName !== "push") return undefined;
  const body = record(payload);
  const branch = record(body?.repository)?.default_branch;
  if (typeof branch !== "string" || branch === "" || body?.ref !== `refs/heads/${branch}`) {
    return undefined;
  }
  const login = record(body?.sender)?.login;
  return typeof login === "string" && login !== "" ? login : undefined;
}
