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
