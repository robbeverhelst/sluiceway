import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "../../src/github/env-file.ts";
import { rememberingLog } from "../modes/harness.ts";

// Slice 5.35 (record 0100): the glue of a mode that runs the tool reads the
// file the `env-file` input names, once, masks every value before anything
// else, says in the job log which names it loaded and never a value, and
// hands the tool an environment in which the file wins.

const FILE = [
  "# The stacks' credentials",
  "PULUMI_ACCESS_TOKEN=pul-0123456789",
  'TLS_KEY="-----BEGIN KEY-----\nAAAAAAAAAAAA\n-----END KEY-----"',
  "REGION=eu",
  "DEBUG=true",
  "EMPTY=",
].join("\n");

function fixture(files: Record<string, string> = { "ci/deploy.env": FILE }): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-env-file-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

// What happened, in order: a mask, or a line of the log.
function harness(root: string, input: string | undefined, env: Record<string, string> = {}) {
  const events: string[] = [];
  const log = rememberingLog();
  const original = log.group;
  log.group = (title, lines, verbatim) => {
    events.push(`log: ${title}`);
    original(title, lines, verbatim);
  };
  const tool = loadEnvFile({
    input,
    root,
    env: { PATH: "/usr/bin", ...env },
    mask: (value) => void events.push(`mask: ${value}`),
    log,
  });
  return { tool, events, log };
}

describe("without the input", () => {
  test("the environment is handed on as it is, and nothing is read, masked or said", () => {
    const { tool, events } = harness(fixture({}), undefined, { A: "1" });
    expect(tool).toEqual({ PATH: "/usr/bin", A: "1" });
    expect(events).toEqual([]);
  });
});

describe("with the input", () => {
  test("the file's values join the tool's environment, and the file wins", () => {
    const { tool } = harness(fixture(), "ci/deploy.env", { REGION: "us-east", HOME: "/home/r" });
    expect(tool).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/r",
      PULUMI_ACCESS_TOKEN: "pul-0123456789",
      TLS_KEY: "-----BEGIN KEY-----\nAAAAAAAAAAAA\n-----END KEY-----",
      REGION: "eu",
      DEBUG: "true",
      EMPTY: "",
    });
  });

  test("every value is masked before anything is said, each line of a long one too", () => {
    const { events } = harness(fixture(), "ci/deploy.env");
    expect(events).toEqual([
      "mask: pul-0123456789",
      "mask: -----BEGIN KEY-----\nAAAAAAAAAAAA\n-----END KEY-----",
      "mask: -----BEGIN KEY-----",
      "mask: AAAAAAAAAAAA",
      "mask: -----END KEY-----",
      "log: Loaded the env file ci/deploy.env",
    ]);
  });

  test("the job log names what was loaded, what was not masked and why, and what the file replaced, and never a value", () => {
    const { log } = harness(fixture(), "ci/deploy.env", { REGION: "us-east" });
    expect(log.groups).toEqual([
      {
        title: "Loaded the env file ci/deploy.env",
        lines: [
          "5 values for the tool: PULUMI_ACCESS_TOKEN, TLS_KEY, REGION, DEBUG, EMPTY.",
          "Masked: PULUMI_ACCESS_TOKEN, TLS_KEY.",
          "Not masked: REGION (shorter than 4 characters), DEBUG (true or false), EMPTY (empty).",
          "The file wins over the job environment for: REGION.",
        ],
      },
    ]);
    expect(JSON.stringify(log)).not.toContain("pul-0123456789");
    expect(JSON.stringify(log)).not.toContain("us-east");
  });

  test("a file with nothing in it says so", () => {
    const { log, tool } = harness(fixture({ ".env": "# nothing\n" }), ".env");
    expect(tool).toEqual({ PATH: "/usr/bin" });
    expect(log.groups).toEqual([
      { title: "Loaded the env file .env", lines: ["No value: the file has no NAME=value line."] },
    ]);
  });

  test("an absolute path is read where it is", () => {
    const root = fixture({});
    const elsewhere = fixture({ "resolved.env": "A=12345678\n" });
    const { tool } = harness(root, join(elsewhere, "resolved.env"));
    expect(tool).toEqual({ PATH: "/usr/bin", A: "12345678" });
  });
});

describe("what stops the mode before the tool", () => {
  test("a file that is not there", () => {
    const root = fixture({});
    expect(() => harness(root, "ci/deploy.env")).toThrow(
      'The "env-file" input names ci/deploy.env, and there is no such file in the checkout.',
    );
    expect(() => harness(root, "/nowhere/x.env")).toThrow(
      'The "env-file" input names /nowhere/x.env, and there is no such file.',
    );
  });

  test("a path that is a directory", () => {
    expect(() => harness(fixture(), "ci")).toThrow(
      'The "env-file" input names ci, and it could not be read as a file (EISDIR).',
    );
  });

  test("a line the strict format refuses, by number, and nothing is masked or loaded", () => {
    const root = fixture({ ".env": "A=12345678\nB=op://ci/x/y\n" });
    expect(() => harness(root, ".env")).toThrow(
      "The env file .env cannot be loaded. Line 2 holds a secret reference (op://). Sluiceway resolves none: let your secret manager resolve the file first, or load its references the way the credentials page shows.",
    );
  });
});
