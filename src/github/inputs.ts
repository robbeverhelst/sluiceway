import type { NotifyTargets } from "../notify/send.ts";

// The inputs of the action (build plan, section 3). GitHub hands each one over
// as text. They are read once, here, and passed on as data.

// `core.getInput`, or a table in a test. It gives "" for an input that is not
// set.
export type GetInput = (name: string) => string;

export interface ScanInputs {
  // The size of the preview pool (record 0012).
  concurrency: number;
  previewTimeoutMinutes: number;
  // The workflow's own token (record 0017).
  token: string;
  // The job goes red on any preview failure, after the dashboard is written
  // (slice 5.9). Off by default: a job that is red for one broken stack on
  // every push teaches people to ignore red (record 0012).
  strict: boolean;
}

// The defaults of action.yml, which GitHub applies only when a workflow leaves
// an input out. A workflow that passes one through from its own inputs sends
// "" instead, and that means the default too (record 0084). A test holds
// these to action.yml.
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_PREVIEW_TIMEOUT_MINUTES = 10;

// An empty input, or one of white space only, is `fallback`. Anything else
// must be a whole number of 1 or more.
function wholeNumber<Fallback extends number | undefined>(
  getInput: GetInput,
  name: string,
  fallback: Fallback,
  hint = "",
): number | Fallback {
  const text = getInput(name).trim();
  if (text === "") return fallback;
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(
      `The "${name}" input must be a whole number of 1 or more, and it is ${JSON.stringify(text)}.${hint}`,
    );
  }
  return Number(text);
}

// The one input every mode reads: the workflow's own token (record 0017).
export function readToken(getInput: GetInput): string {
  const token = getInput("github-token");
  // It has no default to fall back to: action.yml's is the run's own token,
  // and an empty one can only be a workflow that set it so (record 0084).
  if (token.trim() === "") {
    throw new Error(
      'The "github-token" input is empty. Leave it out of the workflow, so it takes the GITHUB_TOKEN of the run.',
    );
  }
  return token;
}

const MINUTES = " It is a number of whole minutes.";

export function readScanInputs(getInput: GetInput): ScanInputs {
  const concurrency = wholeNumber(getInput, "concurrency", DEFAULT_CONCURRENCY);
  const previewTimeoutMinutes = wholeNumber(
    getInput,
    "preview-timeout",
    DEFAULT_PREVIEW_TIMEOUT_MINUTES,
    MINUTES,
  );
  return {
    concurrency,
    previewTimeoutMinutes,
    token: readToken(getInput),
    strict: readBoolean(getInput, "strict"),
  };
}

// The id of the running job (record 0044). GitHub puts it in no variable of
// the job's environment, so action.yml takes it from `job.check_run_id` as the
// default of the `job-id` input, which needs no permission. A runner that
// does not know it gives "", and the links then fall back to the summary.
export function readJobId(getInput: GetInput): string | undefined {
  const text = getInput("job-id").trim();
  if (text === "") return undefined;
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(
      `The "job-id" input must be the id of the running job, a whole number, and it is ${JSON.stringify(text)}. Leave it out of the workflow, so it takes the id GitHub gives the job.`,
    );
  }
  return text;
}

export interface ApplyInputs {
  // The deployment record to deploy (record 0035).
  deploymentId: number;
  // A rehearsal: everything up to the hash check, and no deploy (record 0051).
  dryRun: boolean;
  // The time limit of the fresh preview, in whole minutes.
  previewTimeoutMinutes: number;
  token: string;
  // A time limit on the deploy itself, in whole minutes, or none (slice 5.9).
  deployTimeoutMinutes: number | undefined;
}

export function readApplyInputs(getInput: GetInput): ApplyInputs {
  const text = getInput("deployment-id").trim();
  if (text === "") {
    throw new Error(
      'The "deployment-id" input is required in apply mode. Set it to the deployment of the matrix entry: deployment-id: ${{ matrix.deployment }}.',
    );
  }
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(
      `The "deployment-id" input must be the id of a deployment record, a whole number, and it is ${JSON.stringify(text)}.`,
    );
  }
  const previewTimeoutMinutes = wholeNumber(
    getInput,
    "preview-timeout",
    DEFAULT_PREVIEW_TIMEOUT_MINUTES,
    MINUTES,
  );
  return {
    deploymentId: Number(text),
    previewTimeoutMinutes,
    token: readToken(getInput),
    dryRun: readBoolean(getInput, "dry-run"),
    deployTimeoutMinutes: wholeNumber(getInput, "deploy-timeout", undefined, MINUTES),
  };
}

// The words GitHub's own boolean inputs use. Anything else is refused, so a
// typo never deploys when a rehearsal was meant (record 0051). Empty is the
// default of every one of them, false (record 0084).
function readBoolean(getInput: GetInput, name: string): boolean {
  const text = getInput(name).trim();
  if (text === "" || text === "false") return false;
  if (text === "true") return true;
  throw new Error(`The "${name}" input is true or false, and it is ${JSON.stringify(text)}.`);
}

// `backend: true` makes the check ask the backend which stacks it holds, with
// the credentials of its job (record 0074). Off by default, and read the way
// dry-run is, so a typo never starts a tool.
export function readBackend(getInput: GetInput): boolean {
  const text = getInput("backend").trim();
  if (text === "" || text === "false") return false;
  if (text === "true") return true;
  throw new Error(`The "backend" input is true or false, and it is ${JSON.stringify(text)}.`);
}

// `deployment-id` is an error in every mode but apply (record 0035), so a
// workflow that hands it to the wrong step hears about it.
// `dry-run: true` is refused the same way (record 0051). Its default, false,
// reaches every mode and says nothing.
// `backend: true` is refused in every mode but check (record 0074).
export function refuseDeploymentId(mode: string, getInput: GetInput): void {
  const only = (name: string, of = "apply") =>
    new Error(
      `The "${name}" input is only for ${of} mode, and this step runs ${mode} mode. Take it out of this step.`,
    );
  // `strict: true` belongs to a scan the same way (slice 5.9), and
  // `backend: true` to the check.
  // Auto mode may run every mode but init, so it takes their inputs, and
  // only deployment-id is wrong there: it deploys what resolve and the scan
  // of the same step hand on (record 0077).
  const auto = mode === "auto";
  if (!auto && mode !== "check" && getInput("backend").trim() === "true") {
    throw only("backend", "check");
  }
  if (!auto && mode !== "scan" && getInput("strict").trim() === "true") {
    throw only("strict", "scan");
  }
  if (mode === "apply") return;
  if (getInput("deployment-id").trim() !== "") throw only("deployment-id");
  if (auto) return;
  if (getInput("deploy-timeout").trim() !== "") throw only("deploy-timeout");
  if (getInput("dry-run").trim() === "true") throw only("dry-run");
}

// The channels of the built-in notifications (record 0078), each from a
// secret of the repo. In the order action.yml lists them.
export const NOTIFY_INPUTS = [
  "slack-webhook-url",
  "telegram-bot-token",
  "telegram-chat-id",
  "webhook-url",
] as const;

export interface NotifyInputs {
  targets: NotifyTargets;
  // A channel set up wrong sends nothing and is a warning, never an error: a
  // notification never stops a scan or a deploy. No problem quotes a value.
  problems: string[];
  // Every value that was set, for the runner to mask, the wrong ones too.
  secrets: string[];
}

// A token as BotFather gives it: digits, a colon, and letters, digits, "_"
// and "-". It goes into the path of the address, so nothing else may.
const TELEGRAM_TOKEN = /^\d+:[\w-]+$/;
// A chat id, or the @ name of a public channel.
const TELEGRAM_CHAT = /^(-?\d+|@\w+)$/;

export function readNotifyTargets(getInput: GetInput): NotifyInputs {
  const [slack, token, chatId, webhook] = NOTIFY_INPUTS.map((name) => getInput(name).trim());
  const targets: NotifyTargets = {};
  const problems: string[] = [];
  const secrets = [slack, token, chatId, webhook].filter((value): value is string => !!value);
  if (slack) {
    if (/^https:\/\//.test(slack)) targets.slack = slack;
    else
      problems.push(
        'The "slack-webhook-url" input is not an https:// address, so nothing is sent to Slack. Set it to the address of an incoming webhook, from a secret.',
      );
  }
  if (token && !chatId) {
    problems.push(
      'The "telegram-bot-token" input is set and "telegram-chat-id" is not, so nothing is sent to Telegram. Set both.',
    );
  } else if (chatId && !token) {
    problems.push(
      'The "telegram-chat-id" input is set and "telegram-bot-token" is not, so nothing is sent to Telegram. Set both.',
    );
  } else if (token && chatId) {
    if (!TELEGRAM_TOKEN.test(token)) {
      problems.push(
        'The "telegram-bot-token" input is not a bot token as BotFather gives it, so nothing is sent to Telegram.',
      );
    } else if (!TELEGRAM_CHAT.test(chatId)) {
      problems.push(
        'The "telegram-chat-id" input is not a chat id or an @ name, so nothing is sent to Telegram.',
      );
    } else {
      targets.telegram = { token, chatId };
    }
  }
  if (webhook) {
    if (/^https?:\/\//.test(webhook)) targets.webhook = webhook;
    else
      problems.push(
        'The "webhook-url" input is not an http:// or https:// address, so nothing is sent to it.',
      );
  }
  return { targets, problems, secrets };
}

// `settle`, `check` and `init` send nothing, so a channel there is a mistake
// worth a warning, and never an error. Auto mode runs scan, resolve and
// apply, which do send (record 0077).
export function unusedNotifyInputs(mode: string, getInput: GetInput): string[] {
  if (mode === "auto" || mode === "scan" || mode === "resolve" || mode === "apply") return [];
  return NOTIFY_INPUTS.filter((name) => getInput(name).trim() !== "");
}
