// The notifier of one step, made once from its inputs by the glue of a mode
// that sends (record 0078): scan, resolve and apply.

import { type GetInput, readNotifyTargets } from "../github/inputs.ts";
import type { JobLog } from "../github/job-log.ts";
import { createNotifier, type Notifier } from "./send.ts";

// `mask` is `core.setSecret`: the runner then writes *** wherever a value
// would appear in the job log. Every value is masked before anything else,
// a wrong one too, because a wrong one is still somebody's secret.
export function stepNotifier(
  getInput: GetInput,
  log: JobLog,
  mask: (value: string) => void,
): Notifier | undefined {
  const { targets, problems, secrets } = readNotifyTargets(getInput);
  for (const secret of secrets) mask(secret);
  for (const problem of problems) log.warning(problem, "Notification channel not used");
  if (!targets.slack && !targets.telegram && !targets.webhook) return undefined;
  return createNotifier(targets, { fetch: (url, init) => fetch(url, init), log });
}
