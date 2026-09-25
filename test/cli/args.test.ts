import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../src/cli/args.ts";

// Slice 5.30 (record 0094): `npx sluiceway init` reads its arguments, never
// INPUT_*.

describe("the two commands that run outside a runner", () => {
  test("init with nothing else works where the person stands", () => {
    expect(parseArgs(["init"])).toEqual({ command: "init", force: false, path: undefined });
  });

  test("init takes --force and a path, in either order", () => {
    expect(parseArgs(["init", "--force", "infra"])).toEqual({
      command: "init",
      force: true,
      path: "infra",
    });
    expect(parseArgs(["init", "infra", "--force"])).toEqual({
      command: "init",
      force: true,
      path: "infra",
    });
  });

  test("check takes a path", () => {
    expect(parseArgs(["check"])).toEqual({ command: "check", path: undefined });
    expect(parseArgs(["check", "../repo"])).toEqual({ command: "check", path: "../repo" });
  });

  test("a path after -- may start with a dash", () => {
    expect(parseArgs(["check", "--", "-odd"])).toEqual({ command: "check", path: "-odd" });
  });
});

describe("help and version", () => {
  test("--help and -h, alone or after a command", () => {
    expect(parseArgs(["--help"])).toEqual({ command: "help" });
    expect(parseArgs(["-h"])).toEqual({ command: "help" });
    expect(parseArgs(["init", "--help"])).toEqual({ command: "help" });
  });

  test("--version and -V", () => {
    expect(parseArgs(["--version"])).toEqual({ command: "version" });
    expect(parseArgs(["-V"])).toEqual({ command: "version" });
  });

  test("nothing at all asks for help and is a usage error", () => {
    expect(parseArgs([])).toEqual({ command: "usage", message: "Name a command." });
  });
});

describe("the modes that need a runner", () => {
  test.each(["scan", "resolve", "apply", "settle", "auto"])("%s is refused, not run", (mode) => {
    expect(parseArgs([mode])).toEqual({ command: "refused", mode });
    expect(parseArgs([mode, "--force", "x", "y"])).toEqual({ command: "refused", mode });
  });
});

describe("usage errors", () => {
  test("an unknown command", () => {
    expect(parseArgs(["deploy"])).toEqual({
      command: "usage",
      message: 'Unknown command "deploy".',
    });
  });

  test("an unknown option", () => {
    expect(parseArgs(["init", "--yes"])).toEqual({
      command: "usage",
      message: 'Unknown option "--yes" for init.',
    });
  });

  test("--force belongs to init alone", () => {
    expect(parseArgs(["check", "--force"])).toEqual({
      command: "usage",
      message: 'Unknown option "--force" for check.',
    });
  });

  test("one path at most", () => {
    expect(parseArgs(["init", "a", "b"])).toEqual({
      command: "usage",
      message: 'init takes one path, and got "a" and "b".',
    });
  });

  test("an environment variable is never a way in", () => {
    const saved = process.env.INPUT_MODE;
    process.env.INPUT_MODE = "scan";
    try {
      expect(parseArgs(["check"])).toEqual({ command: "check", path: undefined });
    } finally {
      if (saved === undefined) delete process.env.INPUT_MODE;
      else process.env.INPUT_MODE = saved;
    }
  });
});

// Slice 5.53 (record 0116): the commands that talk to the app, each with
// --json for an agent and --app for another address.
describe("the commands that talk to the app", () => {
  const APP = "https://app.sluiceway.dev";

  test("login and logout", () => {
    expect(parseArgs(["login"])).toEqual({ command: "login", app: APP, json: false });
    expect(parseArgs(["logout", "--json"])).toEqual({ command: "logout", app: APP, json: true });
  });

  test("status, of the org or of one repo", () => {
    expect(parseArgs(["status"])).toEqual({
      command: "status",
      repo: undefined,
      app: APP,
      json: false,
    });
    expect(parseArgs(["status", "infra", "--json"])).toEqual({
      command: "status",
      repo: "infra",
      app: APP,
      json: true,
    });
  });

  test("stack and tick name a repo and a stack id", () => {
    expect(parseArgs(["stack", "infra", "apps/api:prod"])).toEqual({
      command: "stack",
      repo: "infra",
      stack: "apps/api:prod",
      app: APP,
      json: false,
    });
    expect(parseArgs(["tick", "acme/infra", "network:prod", "--yes"])).toEqual({
      command: "tick",
      repo: "acme/infra",
      stack: "network:prod",
      yes: true,
      app: APP,
      json: false,
    });
    expect(parseArgs(["tick", "infra", "network:prod"])).toMatchObject({ yes: false });
  });

  test("rescan names a repo", () => {
    expect(parseArgs(["rescan", "infra"])).toEqual({
      command: "rescan",
      repo: "infra",
      app: APP,
      json: false,
    });
  });

  test("settings reads the keys, and set takes key=value pairs, a value as JSON or as text", () => {
    expect(parseArgs(["settings", "infra"])).toEqual({
      command: "settings",
      repo: "infra",
      changes: undefined,
      app: APP,
      json: false,
    });
    expect(
      parseArgs([
        "settings",
        "infra",
        "set",
        "dashboard.redact=true",
        "tickers=admin",
        "attribution.names=3",
        'dashboard.sections=["pending","deploying"]',
        "stacks[apps/a=b:prod].deploy=on-merge",
        "ignore=null",
        "dashboard.title=Deploys = fun",
      ]),
    ).toMatchObject({
      command: "settings",
      changes: [
        { key: "dashboard.redact", value: true },
        { key: "tickers", value: "admin" },
        { key: "attribution.names", value: 3 },
        { key: "dashboard.sections", value: ["pending", "deploying"] },
        { key: "stacks[apps/a=b:prod].deploy", value: "on-merge" },
        { key: "ignore", value: null },
        { key: "dashboard.title", value: "Deploys = fun" },
      ],
    });
  });

  test("--app names another address, with = or as the next argument", () => {
    expect(parseArgs(["status", "--app", "http://127.0.0.1:4000"])).toMatchObject({
      app: "http://127.0.0.1:4000",
    });
    expect(parseArgs(["status", "--app=https://app.example.com/"])).toMatchObject({
      app: "https://app.example.com",
    });
  });

  test("the token never goes over plain http, except to this machine", () => {
    expect(parseArgs(["status", "--app", "http://app.example.com"])).toEqual({
      command: "usage",
      message:
        '--app must be an https address, or http on this machine, and got "http://app.example.com".',
    });
    expect(parseArgs(["status", "--app", "http://localhost:3000"])).toMatchObject({
      command: "status",
    });
    expect(parseArgs(["status", "--app"])).toEqual({
      command: "usage",
      message: "--app needs an address.",
    });
  });

  test("usage errors of the app commands", () => {
    expect(parseArgs(["stack", "infra"])).toEqual({
      command: "usage",
      message: "stack needs a repo and a stack id.",
    });
    expect(parseArgs(["tick"])).toEqual({
      command: "usage",
      message: "tick needs a repo and a stack id.",
    });
    expect(parseArgs(["rescan"])).toEqual({ command: "usage", message: "rescan needs a repo." });
    expect(parseArgs(["status", "a", "b"])).toEqual({
      command: "usage",
      message: 'status takes one repo at most, and got "a" and "b".',
    });
    expect(parseArgs(["login", "extra"])).toEqual({
      command: "usage",
      message: 'login takes no argument, and got "extra".',
    });
    expect(parseArgs(["settings", "infra", "set"])).toEqual({
      command: "usage",
      message: "settings set needs at least one key=value.",
    });
    expect(parseArgs(["settings", "infra", "set", "tickers"])).toEqual({
      command: "usage",
      message: 'settings set takes key=value, and got "tickers".',
    });
    expect(parseArgs(["settings", "infra", "get"])).toEqual({
      command: "usage",
      message: 'settings takes set after the repo, and got "get".',
    });
    expect(parseArgs(["stack", "infra", "x", "--yes"])).toEqual({
      command: "usage",
      message: 'Unknown option "--yes" for stack.',
    });
    expect(parseArgs(["init", "--json"])).toEqual({
      command: "usage",
      message: 'Unknown option "--json" for init.',
    });
  });
});
