import { escapeText } from "./escape.ts";

// The comment `apply` writes on the dashboard when a change moved since the
// tick (record 0051). A red job and a failure line do not reach the person who
// ticked, and a mention does, as for a refused tick (record 0018). It names
// the stack and nothing of its diff, so no type, name, path or value is in
// it. Plain words: the voice has no place here (record 0032).

export interface MovedTick {
  // As GitHub writes it. It is mentioned, so the person hears about it.
  login: string;
  stackId: string;
  // The record was opened on merge, and `login` is whoever merged (record
  // 0095). Nobody ticked, so the words say what happened instead.
  onMerge?: boolean | undefined;
}

export const MOVED_COMMENT_TAIL =
  "The row on the dashboard shows the change as it is now. Tick it again to deploy that.";

export function movedComment({ login, stackId, onMerge }: MovedTick): string {
  if (onMerge) {
    return `@${login} merged a change that **${escapeText(stackId)}** deploys on merge, and the change moved before the deploy, so nothing was deployed. The row on the dashboard shows the change as it is now. Tick it to deploy that.`;
  }
  return `@${login} ticked **${escapeText(stackId)}**, and the change moved since the tick, so nothing was deployed. ${MOVED_COMMENT_TAIL}`;
}
