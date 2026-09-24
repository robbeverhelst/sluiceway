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

// The comment for a value that changed since the tick (record 0102): the same
// place and the same plain words as a moved change, naming no value, no path
// and no side. With `everyRun` the value differed between two previews of the
// same commit, so the comment names the switch instead of asking for a tick
// that would be refused again.
export const VALUE_CHANGED_TAIL =
  "The row on the dashboard shows the change as it is now. Look at it and tick it again to deploy that.";

const EVERY_RUN_TAIL = (tick: string) =>
  `A value in the program may differ on every run, and no tick can approve it while the value fingerprint is on. Turn it off for this stack with \`valueFingerprint: false\` on its \`stacks\` entry in \`sluiceway.yaml\`, then ${tick}.`;

export function valueChangedComment({
  login,
  stackId,
  onMerge,
  everyRun,
}: MovedTick & { everyRun: boolean }): string {
  const stack = `**${escapeText(stackId)}**`;
  if (onMerge) {
    const head = `@${login} merged a change that ${stack} deploys on merge, and a value the row does not show changed before the deploy`;
    return everyRun
      ? `${head} with no new commit in between, so nothing was deployed. ${EVERY_RUN_TAIL("tick it")}`
      : `${head}, so nothing was deployed. The row on the dashboard shows the change as it is now. Look at it and tick it to deploy that.`;
  }
  const head = `@${login} ticked ${stack}, and a value the row does not show changed`;
  return everyRun
    ? `${head} between the tick and the deploy with no new commit in between, so nothing was deployed. ${EVERY_RUN_TAIL("tick again")}`
    : `${head} since the tick, so nothing was deployed. ${VALUE_CHANGED_TAIL}`;
}

export function movedComment({ login, stackId, onMerge }: MovedTick): string {
  if (onMerge) {
    return `@${login} merged a change that **${escapeText(stackId)}** deploys on merge, and the change moved before the deploy, so nothing was deployed. The row on the dashboard shows the change as it is now. Tick it to deploy that.`;
  }
  return `@${login} ticked **${escapeText(stackId)}**, and the change moved since the tick, so nothing was deployed. ${MOVED_COMMENT_TAIL}`;
}
