// The arguments of the command line (record 0094). They are the only input:
// no INPUT_* variable, no GITHUB_* variable, nothing the environment holds.

export type Command =
  | { command: "init"; force: boolean; path: string | undefined }
  | { command: "check"; path: string | undefined }
  | { command: "help" }
  | { command: "version" }
  // A mode of the action that needs the run's identity and the workflow
  // token. It is named so the refusal can name it, and never run.
  | { command: "refused"; mode: string }
  | { command: "usage"; message: string };

const RUNNER_MODES = new Set(["scan", "resolve", "apply", "settle", "auto"]);

export function parseArgs(argv: string[]): Command {
  if (argv.includes("--help") || argv.includes("-h")) return { command: "help" };
  if (argv.includes("--version") || argv.includes("-V")) return { command: "version" };
  const [name, ...rest] = argv;
  if (name === undefined) return { command: "usage", message: "Name a command." };
  if (RUNNER_MODES.has(name)) return { command: "refused", mode: name };
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
      message: `${name} takes one path, and got ${paths.map((path) => `"${path}"`).join(" and ")}.`,
    };
  }
  const [path] = paths;
  return name === "init" ? { command: "init", force, path } : { command: "check", path };
}
