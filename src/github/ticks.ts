import {
  type Editor,
  isPerson,
  judgeTick,
  type Permission,
  type RefusalReason,
  type TickTarget,
} from "../core/tick-rule.ts";
import { type RefusedTick, refusedTicksComment } from "../render/refused-ticks.ts";
import type { GitHubPort } from "./port.ts";

// The ticks of one `resolve` run against GitHub's live answer (record 0018).
// The rules are in core/tick-rule.ts and the words in render/refused-ticks.ts.
// Here is only the lookup and the comment. What follows from an outcome (the
// deployment record, the row swap that clears a box, a red job) is the mode's.

// A ticked box and whoever the edit history names for it.
export interface Tick {
  target: TickTarget;
  editor: Editor;
}

export type TickOutcome = { tick: Tick } & (
  | { outcome: "allowed" }
  // No deployment record, the box is cleared, the person is told why, and the
  // job stays green.
  | { outcome: "refused"; reason: RefusalReason | "no-account" }
  // The lookup failed, so Sluiceway fails closed: as a refusal, and the job
  // goes red. The error is for the job log.
  | { outcome: "unverified"; error: unknown }
  // A bot or `ghost`. No lookup, no comment and no row swap. The next scan
  // clears the box as an orphan tick.
  | { outcome: "not-a-person" }
);

type Lookup = { permission: Permission | undefined } | { error: unknown };

// How long a failed lookup waits before its one second try (slice 5.9).
const PAUSE_MS = 1_000;

// One lookup, and one more try after a short pause when the first gave no
// answer (slice 5.9). A second failure fails closed.
async function lookUp(
  github: Pick<GitHubPort, "getPermission">,
  login: string,
  pauseMs: number,
): Promise<Lookup> {
  try {
    return { permission: await github.getPermission(login) };
  } catch {
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    return github.getPermission(login).then(
      (permission) => ({ permission }),
      (error: unknown) => ({ error }),
    );
  }
}

// Judges every tick on its own, in the order given. A person is looked up once
// per run, which is one request per ticker, or two when the first fails.
// Nothing is kept beyond the run.
export async function judgeTicks(
  github: Pick<GitHubPort, "getPermission">,
  ticks: Tick[],
  { pauseMs = PAUSE_MS }: { pauseMs?: number } = {},
): Promise<TickOutcome[]> {
  const lookups = new Map<string, Lookup>();
  const outcomes: TickOutcome[] = [];
  for (const tick of ticks) {
    if (!isPerson(tick.editor)) {
      outcomes.push({ tick, outcome: "not-a-person" });
      continue;
    }
    const { login } = tick.editor;
    const key = login.toLowerCase();
    let lookup = lookups.get(key);
    if (!lookup) {
      lookup = await lookUp(github, login, pauseMs);
      lookups.set(key, lookup);
    }
    if ("error" in lookup) {
      outcomes.push({ tick, outcome: "unverified", error: lookup.error });
      continue;
    }
    // An answer: GitHub has no account by the login any more. The job stays
    // green, as for any refusal (slice 5.9).
    if (lookup.permission === undefined) {
      outcomes.push({ tick, outcome: "refused", reason: "no-account" });
      continue;
    }
    // The rescan box needs only the first half of the test.
    const rule = tick.target.kind === "rescan" ? "write" : tick.target.rule;
    const verdict = judgeTick(rule, login, lookup.permission);
    outcomes.push(
      verdict.allowed
        ? { tick, outcome: "allowed" }
        : { tick, outcome: "refused", reason: verdict.reason },
    );
  }
  return outcomes;
}

// One comment for every tick of the run that was refused or could not be
// verified. Says whether a comment was written. The bot's comment starts no
// workflow (record 0017).
// `merges` are the merge ticks of the run that were allowed and still started
// nothing, because of their pull request (record 0054). They share the one
// comment.
export async function commentOnRefusedTicks(
  github: Pick<GitHubPort, "createComment">,
  dashboard: number,
  outcomes: TickOutcome[],
  merges: readonly RefusedTick[] = [],
): Promise<boolean> {
  const judged = outcomes.flatMap((outcome): RefusedTick[] => {
    if (outcome.outcome !== "refused" && outcome.outcome !== "unverified") return [];
    return [
      {
        target: outcome.tick.target,
        login: outcome.tick.editor.login,
        reason: outcome.outcome === "refused" ? outcome.reason : "unverified",
      },
    ];
  });
  const refused = [...judged, ...merges];
  if (refused.length === 0) return false;
  await github.createComment(dashboard, refusedTicksComment(refused));
  return true;
}
