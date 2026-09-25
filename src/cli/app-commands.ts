// The commands that talk to the app (record 0116): login, logout, status,
// stack, tick, rescan and settings. Each calls the app's /api/v1 with the
// token the person gave at login, as that person, and nothing else: no
// GitHub API, no other address. Every answer is the app's own words; the
// command line adds none that claim a deploy went out.

import type {
  Config,
  Counts,
  Deploy,
  Me,
  Org,
  PullRequestAnswer,
  Repo,
  RescanAnswer,
  Stack,
  StackLine,
  TickAnswer,
} from "./app-api.ts";
import { type AppClient, AppError, appClient } from "./app-client.ts";
import type { Command } from "./args.ts";
import { EXIT } from "./exit.ts";
import type { TokenStore } from "./token-store.ts";

export interface AppIo {
  version: string;
  out: (line: string) => void;
  err: (line: string) => void;
  fetch: typeof fetch;
  tokens: TokenStore;
  // The token, from a prompt that does not echo it or from stdin.
  readToken: (prompt: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
}

type AppCommand = Extract<
  Command,
  { command: "login" | "logout" | "status" | "stack" | "tick" | "rescan" | "settings" }
>;

// How often and how long a tick polls its deployment record.
const POLL_MS = 2_000;
const POLL_FOR_MS = 60_000;

// What a command ends with: lines for a person, a document for --json, and
// the exit code.
interface Ending {
  exit: number;
  lines: string[];
  // Lines that say the command did not do what it says, to stderr.
  errors?: string[];
  json: unknown;
}

export async function runAppCommand(parsed: AppCommand, io: AppIo): Promise<number> {
  let ending: Ending;
  try {
    ending = await dispatch(parsed, io);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    ending = {
      exit: error.exit,
      lines: [],
      errors: [error.message, ...error.problems.map((problem) => `  ${problem}`)],
      json: {
        error: error.message,
        code: error.code,
        exit: error.exit,
        ...(error.problems.length > 0 ? { problems: error.problems } : {}),
      },
    };
  }
  if (parsed.json) io.out(JSON.stringify(ending.json, null, 2));
  else {
    for (const line of ending.lines) io.out(line);
    for (const line of ending.errors ?? []) io.err(line);
  }
  return ending.exit;
}

function tokensPage(app: string): string {
  return `${app}/settings/tokens`;
}

async function dispatch(parsed: AppCommand, io: AppIo): Promise<Ending> {
  const { app } = parsed;
  if (parsed.command === "login") return login(app, io);
  if (parsed.command === "logout") return logout(app, io);

  const token = await io.tokens.read(app);
  if (token === undefined) {
    throw new AppError(
      `Not signed in to ${app}. Make a token on ${tokensPage(app)}, then run sluiceway login.`,
      "not-signed-in",
      EXIT.signedOut,
    );
  }
  const client = appClient({ app, token, version: io.version, fetch: io.fetch });
  const me = await client.get<Me>("/api/v1/me");
  const org = `/api/v1/orgs/${encodeURIComponent(me.org)}`;
  const repoPath = (repo: string) => `${org}/repos/${encodeURIComponent(repoName(me.org, repo))}`;

  switch (parsed.command) {
    case "status":
      return parsed.repo === undefined
        ? orgStatus(await client.get<Org>(org))
        : repoStatus(await client.get<Repo>(repoPath(parsed.repo)));
    case "stack":
      return stackRow(
        await client.get<Stack>(
          `${repoPath(parsed.repo)}/stacks/${encodeURIComponent(parsed.stack)}`,
        ),
      );
    case "tick":
      return tick(client, repoPath(parsed.repo), parsed, io);
    case "rescan":
      return rescan(await client.post<RescanAnswer>(`${repoPath(parsed.repo)}/rescan`));
    case "settings":
      return parsed.changes === undefined
        ? settings(await client.get<Config>(`${repoPath(parsed.repo)}/config`))
        : pullRequest(
            await client.post<PullRequestAnswer>(`${repoPath(parsed.repo)}/config/pull-request`, {
              changes: parsed.changes,
            }),
          );
  }
}

// A repo by its name, or by org/name when that org is the token's.
function repoName(org: string, repo: string): string {
  const slash = repo.indexOf("/");
  if (slash === -1) return repo;
  if (repo.slice(0, slash).toLowerCase() !== org.toLowerCase()) {
    throw new AppError(
      `The token is for ${org}, and ${repo} is not in it.`,
      "not-found",
      EXIT.notFound,
    );
  }
  return repo.slice(slash + 1);
}

async function login(app: string, io: AppIo): Promise<Ending> {
  const token = (await io.readToken(`Paste a token from ${tokensPage(app)}: `)).trim();
  if (token === "") {
    throw new AppError(
      `No token was given. Make one on ${tokensPage(app)} and paste it, or pipe it in.`,
      "no-token",
      EXIT.usage,
    );
  }
  // A token of another kind, a GitHub one pasted by mistake, is never sent.
  if (!token.startsWith("sluiceway_")) {
    throw new AppError(
      `That is not a Sluiceway token: one starts with sluiceway_. Make one on ${tokensPage(app)}.`,
      "not-a-sluiceway-token",
      EXIT.usage,
    );
  }
  const me = await appClient({ app, token, version: io.version, fetch: io.fetch }).get<Me>(
    "/api/v1/me",
  );
  const kept = await io.tokens.write(app, token);
  return {
    exit: EXIT.ok,
    lines: [
      `Signed in to ${app} as ${me.login}, for ${me.org}, with the token ${me.token.name}, which works until ${me.token.expiresAt}.`,
      `The token is kept in ${kept}.`,
    ],
    json: { app, ...me, kept },
  };
}

async function logout(app: string, io: AppIo): Promise<Ending> {
  const places = await io.tokens.remove(app);
  if (places.length === 0) {
    return {
      exit: EXIT.ok,
      lines: [`There was no token for ${app}.`],
      json: { app, removed: [] },
    };
  }
  return {
    exit: EXIT.ok,
    lines: [
      `Signed out of ${app}: the token is gone from ${places.join(" and ")}.`,
      `It still works until it expires. Revoke it on ${tokensPage(app)} to stop it now.`,
    ],
    json: { app, removed: places },
  };
}

const STATES = ["pending", "deploying", "drifted", "failed", "in-sync"] as const;

function countsWords(counts: Counts, total: number): string {
  const parts = STATES.filter((state) => counts[state] > 0).map(
    (state) => `${counts[state]} ${state === "in-sync" ? "in sync" : state}`,
  );
  return [...parts, `${total} ${total === 1 ? "stack" : "stacks"}`].join(", ");
}

// The org view's groups (the app's grouping.ts): Needs you, In flight, In
// sync. Inside a group the states in that order, and a pending stack that
// deletes or replaces before the other pending stacks; then the app's order.
const GROUPS = [
  { label: "Needs you", states: ["pending", "drifted", "failed"] },
  { label: "In flight", states: ["deploying"] },
  { label: "In sync", states: ["in-sync"] },
] as const;

function grouped(stacks: StackLine[], withRepo: boolean): string[] {
  const lines: string[] = [];
  for (const group of GROUPS) {
    const states: readonly string[] = group.states;
    const rank = (row: StackLine) => states.indexOf(row.state) * 2 + (row.destroys ? 0 : 1);
    const rows = stacks
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => states.includes(row.state))
      .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
      .map(({ row }) => row);
    if (rows.length === 0) continue;
    lines.push(group.label);
    for (const row of rows) {
      const name = withRepo ? `${row.repo}  ${row.stack}` : row.stack;
      if (row.state === "in-sync") {
        lines.push(`  ${name}`);
        continue;
      }
      const word = row.destroys ? `${row.word}, deletes or replaces` : row.word;
      lines.push(`  ${name}  ${word}${row.line === "" ? "" : `  ${row.line}`}`);
    }
  }
  return lines;
}

function orgStatus(org: Org): Ending {
  const lines = [
    `${org.org.login}: ${countsWords(org.counts, org.total)}`,
    org.lastScan === null
      ? "No scan yet."
      : `Last scan: ${org.lastScan.sha.slice(0, 7)} of ${org.lastScan.repo} at ${org.lastScan.at}`,
    "",
    ...grouped(org.stacks, true),
  ];
  const writers = org.repos.filter((repo) => repo.recordWriter !== null);
  if (writers.length > 0) {
    lines.push("", ...writers.map((repo) => `${repo.name}: ${repo.recordWriter}`));
  }
  if (org.locked.length > 0 || org.allowance.sentence !== null) {
    lines.push(
      "",
      ...org.locked.map((repo) => `Locked: ${repo.name} (${countsWords(repo.counts, repo.total)})`),
      ...(org.allowance.sentence === null ? [] : [org.allowance.sentence]),
    );
  }
  return { exit: EXIT.ok, lines, json: org };
}

function repoStatus(repo: Repo): Ending {
  const scan =
    repo.scan === null
      ? "No scan yet."
      : `Last scan: ${repo.scan.sha.slice(0, 7)}${repo.scan.at === null ? "" : ` at ${repo.scan.at}`}`;
  return {
    exit: EXIT.ok,
    lines: [
      `${repo.repo.name}: ${countsWords(repo.counts, repo.total)}`,
      scan,
      ...(repo.repo.dashboard === null ? [] : [`Dashboard: ${repo.repo.dashboard}`]),
      ...(repo.repo.recordWriter === null ? [] : [repo.repo.recordWriter]),
      "",
      ...grouped(repo.stacks, false),
    ],
    json: repo,
  };
}

function deployWords(deploy: Deploy): string {
  return `${deploy.result}, ${deploy.who}, at ${deploy.at}`;
}

function stackRow(stack: Stack): Ending {
  const lines = [`${stack.stack} in ${stack.repo}: ${stack.word}`];
  if (stack.line !== "") lines.push(stack.line);
  if (stack.changes !== null) lines.push(`Changes: ${stack.changes}`);
  if (stack.destroys !== null) lines.push(`Deletes or replaces: ${stack.destroys}`);
  if (stack.drift !== null) lines.push(`Drift: ${stack.drift}`);
  if (stack.ticked) lines.push("Ticked on the dashboard.");
  if (stack.preview !== null) lines.push(`Preview: ${stack.preview.name}, on ${stack.preview.url}`);
  if (stack.run !== null) lines.push(`Run: ${stack.run}`);
  if (stack.lastDeploy !== null) lines.push(`Last deploy: ${deployWords(stack.lastDeploy)}`);
  lines.push(`Dashboard: ${stack.dashboard}`);
  return { exit: EXIT.ok, lines, json: stack };
}

// A tick, as the person (record 0222 of the app): the app judges it by the
// action's own rule, opens the deployment record, and answers. The command
// line then polls the record until the app shows it, and stops there: the
// workflow deploys it through a fresh preview and the hash check, and the
// command line never waits for that or says it went out.
async function tick(
  client: AppClient,
  repoPath: string,
  parsed: Extract<Command, { command: "tick" }>,
  io: AppIo,
): Promise<Ending> {
  const stackPath = `${repoPath}/stacks/${encodeURIComponent(parsed.stack)}`;
  const stack = await client.get<Stack>(stackPath);
  if (stack.destroys !== null && !parsed.yes) {
    throw new AppError(
      `${parsed.stack} deletes or replaces resources (${stack.destroys}). Run the tick again with --yes to deploy that.`,
      "needs-yes",
      EXIT.refused,
    );
  }
  const answer = await client.post<TickAnswer>(`${stackPath}/tick`);
  if (answer.outcome !== "asked") {
    return {
      exit: answer.outcome === "failed" ? EXIT.failed : EXIT.refused,
      lines: [],
      errors: [answer.sentence],
      json: { tick: answer, deploy: null },
    };
  }
  const follow = `The workflow deploys it through a fresh preview and the hash check, and the dashboard says how it went: ${answer.dashboard}`;
  if (answer.deployment === null) {
    return {
      exit: EXIT.ok,
      lines: [answer.sentence, follow],
      json: { tick: answer, deploy: null },
    };
  }
  const id = answer.deployment.id;
  const deploy = await poll(client, `${repoPath}/deployments/${id}`, io);
  if (deploy === undefined) {
    const message = `The app has not shown deployment record ${id} yet. See it with sluiceway stack ${parsed.repo} ${parsed.stack}.`;
    return {
      exit: EXIT.later,
      lines: [answer.sentence],
      errors: [message],
      json: { tick: answer, deploy: null, error: message, code: "not-shown-yet", exit: EXIT.later },
    };
  }
  const json = { tick: answer, deploy };
  if (deploy.state === "failed") {
    return {
      exit: EXIT.failed,
      lines: [
        answer.sentence,
        `Deployment record ${id}: failed.`,
        `The dashboard says why: ${answer.dashboard}`,
      ],
      json,
    };
  }
  const open = deploy.result === "waiting to start" || deploy.result === "deploying now";
  return {
    exit: EXIT.ok,
    lines: [
      answer.sentence,
      open
        ? `Deployment record ${id}: ${deploy.result}.`
        : `Deployment record ${id}: the app says ${deploy.result}.`,
      follow,
    ],
    json,
  };
}

// The record, once the app shows it, or nothing after a minute.
async function poll(client: AppClient, path: string, io: AppIo): Promise<Deploy | undefined> {
  for (let waited = 0; ; waited += POLL_MS) {
    try {
      return await client.get<Deploy>(path);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "not-found") throw error;
    }
    if (waited >= POLL_FOR_MS) return undefined;
    await io.sleep(POLL_MS);
  }
}

function rescan(answer: RescanAnswer): Ending {
  if (answer.outcome === "asked") {
    return {
      exit: EXIT.ok,
      lines: [answer.sentence, `Dashboard: ${answer.dashboard}`],
      json: answer,
    };
  }
  return {
    exit: answer.outcome === "failed" ? EXIT.failed : EXIT.refused,
    lines: [],
    errors: [answer.sentence],
    json: answer,
  };
}

function settings(config: Config): Ending {
  const sha = config.sha === null ? "" : ` at ${config.sha.slice(0, 7)}`;
  const head =
    config.file === null
      ? `${config.repo} has no sluiceway.yaml${sha}: every key has the action's default.`
      : `${config.file} of ${config.repo}${sha}: ${config.url ?? ""}`;
  return {
    exit: EXIT.ok,
    lines: [
      head,
      ...(config.problem === null ? [] : [config.problem]),
      ...Object.entries(config.keys).map(([key, value]) => `  ${key} = ${JSON.stringify(value)}`),
    ],
    json: config,
  };
}

function pullRequest(answer: PullRequestAnswer): Ending {
  const lines = [
    answer.sentence,
    ...answer.changes.map((change) => `  ${change}`),
    ...(answer.url === null ? [] : [answer.url]),
  ];
  switch (answer.outcome) {
    case "opened":
    case "nothing-to-change":
      return { exit: EXIT.ok, lines, json: answer };
    case "read-failed":
    case "write-failed":
      return { exit: EXIT.failed, lines: [], errors: lines, json: answer };
    default:
      return {
        exit: EXIT.refused,
        lines: [],
        errors: [...lines, ...answer.problems.map((problem) => `  ${problem}`)],
        json: answer,
      };
  }
}
