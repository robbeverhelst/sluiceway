import type { RefusalReason, TickTarget } from "../core/tick-rule.ts";
import { escapeText } from "./escape.ts";

// One of the two comments Sluiceway writes (record 0018, and 0051 for the
// other): one comment on the
// dashboard for the ticks of one `resolve` run that started nothing. It
// mentions each ticker, names the stack and states the rule, in plain words.
// The voice has no place here (record 0032).

export interface RefusedTick {
  target: TickTarget;
  // As GitHub writes it. It is mentioned, so the person hears about it.
  login: string;
  // "unverified" is a lookup that failed: no answer, so nothing to judge. The
  // other three are about the pull request of a merge tick (record 0054):
  // GitHub refused the merge, with its own words in `detail`; its head moved
  // since the tick; or it no longer qualifies, with why in `detail`.
  // "waits-on": a stack the pull request's stack depends on has a change
  // waiting or deploying (record 0056), with their ids in `waitsOn`.
  reason:
    | RefusalReason
    | "unverified"
    | "merge-refused"
    | "head-moved"
    | "not-qualified"
    | "waits-on";
  detail?: string | undefined;
  waitsOn?: readonly string[] | undefined;
}

function what(target: TickTarget): string {
  if (target.kind === "rescan") return "the rescan box";
  if (target.kind === "stack") return `**${escapeText(target.stackId)}**`;
  const stacks = target.stackIds.map((id) => `**${escapeText(id)}**`).join(" and ");
  return `the merge of #${target.pr} for ${stacks}`;
}

// GitHub's words end in a full stop or not. The sentence gets one.
function sentence(text: string): string {
  const trimmed = escapeText(text).trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function why({ target, reason, detail, waitsOn }: RefusedTick): string {
  if (reason === "merge-refused") return `GitHub refused the merge: ${sentence(detail ?? "")}`;
  if (reason === "waits-on") {
    const ids = (waitsOn ?? []).map((id) => `**${escapeText(id)}**`);
    const has = ids.length === 1 ? "has a change" : "have changes";
    return `It was not merged: the stack depends on ${ids.join(" and ")}, which ${has} waiting. Deploy that first, then tick this again.`;
  }
  if (reason === "head-moved") {
    return "The pull request changed since the tick, so it was not merged.";
  }
  if (reason === "not-qualified") {
    return `The pull request no longer qualifies: ${sentence(detail ?? "")}`;
  }
  if (reason === "unverified") {
    return "The tick could not be verified, because the permission lookup failed. Tick the box again for a fresh try.";
  }
  if (reason === "no-write-access" || target.kind === "rescan") {
    return "The tick was refused: ticking needs write access to this repository.";
  }
  if (typeof target.rule === "string") {
    return `The tick was refused: the tick rule of this stack is \`${target.rule}\`, which takes ${target.rule} access to this repository.`;
  }
  // Plain logins, without the "@", notify no one.
  const names = target.rule.map(escapeText).join(", ");
  return `The tick was refused: the tick rule of this stack names who can tick it: ${names}.`;
}

function line(refused: RefusedTick): string {
  return `@${refused.login} ticked ${what(refused.target)}. ${why(refused)}`;
}

export function refusedTicksComment(refused: RefusedTick[]): string {
  const [only, ...others] = refused;
  if (!only) throw new Error("A comment needs a tick to be about, and no refused tick was given.");
  if (others.length === 0) return `${line(only)} Nothing was started and the box is cleared.`;
  return [
    "Nothing was started for these ticks and their boxes are cleared.",
    "",
    ...refused.map((one) => `- ${line(one)}`),
  ].join("\n");
}
