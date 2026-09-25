// The arguments of the command line (records 0094 and 0116). They are the
// only input: no INPUT_* variable, no GITHUB_* variable, no token from the
// environment, nothing else the environment holds.

// A key of sluiceway.yaml and the value a pull request sets it to.
export interface KeyChange {
  key: string;
  value: unknown;
}

// What every command that talks to the app shares: the app's address, and
// whether the answer is JSON for an agent.
interface AppOptions {
  app: string;
  json: boolean;
}

export type Command =
  | { command: "init"; force: boolean; path: string | undefined }
  | { command: "check"; path: string | undefined }
  | ({ command: "login" } & AppOptions)
  | ({ command: "logout" } & AppOptions)
  | ({ command: "status"; repo: string | undefined } & AppOptions)
  | ({ command: "stack"; repo: string; stack: string } & AppOptions)
  | ({ command: "tick"; repo: string; stack: string; yes: boolean } & AppOptions)
  | ({ command: "rescan"; repo: string } & AppOptions)
  | ({ command: "settings"; repo: string; changes: KeyChange[] | undefined } & AppOptions)
  | { command: "help" }
  | { command: "version" }
  // A mode of the action that needs the run's identity and the workflow
  // token. It is named so the refusal can name it, and never run.
  | { command: "refused"; mode: string }
  | { command: "usage"; message: string };

export const DEFAULT_APP = "https://app.sluiceway.dev";

const RUNNER_MODES = new Set(["scan", "resolve", "apply", "settle", "auto"]);
const APP_COMMANDS = new Set(["login", "logout", "status", "stack", "tick", "rescan", "settings"]);

export function parseArgs(argv: string[]): Command {
  if (argv.includes("--help") || argv.includes("-h")) return { command: "help" };
  if (argv.includes("--version") || argv.includes("-V")) return { command: "version" };
  const [name, ...rest] = argv;
  if (name === undefined) return { command: "usage", message: "Name a command." };
  if (RUNNER_MODES.has(name)) return { command: "refused", mode: name };
  if (APP_COMMANDS.has(name)) return parseAppCommand(name, rest);
  if (name !== "init" && name !== "check") {
    return { command: "usage", message: `Unknown command "${name}".` };
  }

  let force = false;
  const paths: string[] = [];
  let options = true;
  for (const arg of rest) {
    if (options && arg === "--") options = false;
    else if (options && name === "init" && arg === "--force") force = true;
    else if (options && arg.startsWith("-")) {
      return { command: "usage", message: `Unknown option "${arg}" for ${name}.` };
    } else paths.push(arg);
  }
  if (paths.length > 1) {
    return {
      command: "usage",
      message: `${name} takes one path, and got ${quoted(paths)}.`,
    };
  }
  const [path] = paths;
  return name === "init" ? { command: "init", force, path } : { command: "check", path };
}

function quoted(values: string[]): string {
  return values.map((value) => `"${value}"`).join(" and ");
}

function usage(message: string): Command {
  return { command: "usage", message };
}

function parseAppCommand(name: string, rest: string[]): Command {
  let app = DEFAULT_APP;
  let json = false;
  let yes = false;
  const words: string[] = [];
  let options = true;
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index] ?? "";
    if (options && arg === "--") options = false;
    else if (options && arg === "--json") json = true;
    else if (options && name === "tick" && arg === "--yes") yes = true;
    else if (options && (arg === "--app" || arg.startsWith("--app="))) {
      const value = arg === "--app" ? rest[++index] : arg.slice("--app=".length);
      if (value === undefined || value === "") return usage("--app needs an address.");
      const address = appAddress(value);
      if (address === undefined) {
        return usage(
          `--app must be an https address, or http on this machine, and got "${value}".`,
        );
      }
      app = address;
    } else if (options && arg.startsWith("-")) {
      return usage(`Unknown option "${arg}" for ${name}.`);
    } else words.push(arg);
  }
  const shared = { app, json };

  switch (name) {
    case "login":
    case "logout":
      if (words.length > 0) return usage(`${name} takes no argument, and got ${quoted(words)}.`);
      return { command: name, ...shared };
    case "status":
      if (words.length > 1) {
        return usage(`status takes one repo at most, and got ${quoted(words)}.`);
      }
      return { command: "status", repo: words[0], ...shared };
    case "stack":
    case "tick": {
      const [repo, stack, ...extra] = words;
      if (repo === undefined || stack === undefined) {
        return usage(`${name} needs a repo and a stack id.`);
      }
      if (extra.length > 0) {
        return usage(`${name} takes a repo and a stack id, and got also ${quoted(extra)}.`);
      }
      return name === "tick"
        ? { command: "tick", repo, stack, yes, ...shared }
        : { command: "stack", repo, stack, ...shared };
    }
    case "rescan": {
      const [repo, ...extra] = words;
      if (repo === undefined) return usage("rescan needs a repo.");
      if (extra.length > 0) return usage(`rescan takes one repo, and got also ${quoted(extra)}.`);
      return { command: "rescan", repo, ...shared };
    }
    default: {
      const [repo, verb, ...pairs] = words;
      if (repo === undefined) return usage("settings needs a repo.");
      if (verb === undefined) return { command: "settings", repo, changes: undefined, ...shared };
      if (verb !== "set") return usage(`settings takes set after the repo, and got "${verb}".`);
      if (pairs.length === 0) return usage("settings set needs at least one key=value.");
      const changes: KeyChange[] = [];
      for (const pair of pairs) {
        const change = keyChange(pair);
        if (change === undefined) {
          return usage(`settings set takes key=value, and got "${pair}".`);
        }
        changes.push(change);
      }
      return { command: "settings", repo, changes, ...shared };
    }
  }
}

// The app's address: https anywhere, http only to this machine, so a token
// never crosses a network in the clear. No path, no trailing slash.
function appAddress(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return undefined;
  return url.origin;
}

// `key=value`, split at the first `=` after the stack id of a `stacks[...]`
// key, whose id may hold one. The value is JSON when it reads as JSON (true,
// 3, null, a list) and the text as typed otherwise.
function keyChange(pair: string): KeyChange | undefined {
  const from = pair.startsWith("stacks[") ? Math.max(pair.indexOf("]"), 0) : 0;
  const at = pair.indexOf("=", from);
  if (at <= 0) return undefined;
  const key = pair.slice(0, at);
  const text = pair.slice(at + 1);
  try {
    return { key, value: JSON.parse(text) };
  } catch {
    return { key, value: text };
  }
}
