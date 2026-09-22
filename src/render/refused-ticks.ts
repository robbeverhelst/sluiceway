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
  // "unverified" is a lookup that failed: no answer, so nothing to judge.
  reason: RefusalReason | "unverified";
}

function what(target: TickTarget): string {
  return target.kind === "rescan" ? "the rescan box" : `**${escapeText(target.stackId)}**`;
}

function why({ target, reason }: RefusedTick): string {
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
