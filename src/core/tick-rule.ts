import type { BulkSection } from "../render/marker.ts";
import type { TickRule } from "./config.ts";

// The test every tick passes (record 0018): the ticker is a person with write
// access to the repo, and the ticker meets the stack's tick rule. It is judged
// against GitHub's live answer, which is handed in as data. Nothing is cached.

// The three booleans of GitHub's answer to the permission lookup. Levels are
// read from them and never from a role name, so custom organization roles need
// no special handling.
export interface Permission {
  push: boolean;
  maintain: boolean;
  admin: boolean;
}

// Whoever made an edit, as the edit history names them.
export interface Editor {
  login: string;
  // "User", "Bot" and so on, as GitHub writes it.
  type: string;
}

// What a box belongs to. The rescan box has no rule of its own: it needs only
// the first half of the test, a person with write access.
// A merge tick is judged by the rule of the stacks its pull request belongs to
// (records 0054 and 0071): it ends in a deploy of each. `resolve` judges it
// once per stack, with one id in `stackIds`.
export type TickTarget =
  | { kind: "stack"; stackId: string; rule: TickRule }
  | { kind: "merge"; pr: number; stackIds: string[]; rule: TickRule }
  | { kind: "rescan" }
  // The bulk box of a section (record 0083). Like the rescan box it deploys
  // nothing, so it needs only the first half of the test. The confirm box is
  // judged as one tick per stack, each by that stack's rule.
  | { kind: "bulk"; section: BulkSection };

// Why a tick is refused. "unverified" is not one of these: a lookup that
// failed gave no answer to judge.
export type RefusalReason = "no-write-access" | "below-level" | "not-on-list";

export type TickVerdict = { allowed: true } | { allowed: false; reason: RefusalReason };

// GitHub's placeholder for an account that is gone. Its docs warn against
// trusting it.
const GHOST = "ghost";

// Only a person can tick. A tick by anyone else gets no comment and no row
// swap. The next scan clears it as an orphan tick.
export function isPerson(editor: Editor): boolean {
  return editor.type === "User" && editor.login !== "" && editor.login.toLowerCase() !== GHOST;
}

// A rule narrows and never widens: write access comes first, whatever the
// rule. The rescan box needs only that first half, which is the rule "write".
// A list holds lower case logins, as config loading leaves them.
export function judgeTick(rule: TickRule, login: string, permission: Permission): TickVerdict {
  if (!permission.push) return { allowed: false, reason: "no-write-access" };
  if (typeof rule !== "string") {
    return rule.includes(login.toLowerCase())
      ? { allowed: true }
      : { allowed: false, reason: "not-on-list" };
  }
  const meets = rule === "write" || (rule === "maintain" ? permission.maintain : permission.admin);
  return meets ? { allowed: true } : { allowed: false, reason: "below-level" };
}
