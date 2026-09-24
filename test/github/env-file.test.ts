import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile, stackEnvFiles } from "../../src/github/env-file.ts";
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

// Slice 5.38 (record 0103): a stack may name a file of its own, which the
// tool gets for that stack alone, on top of the environment of the step.
describe("the env file of a stack", () => {
  const AWS = ["AWS_ACCESS_KEY_ID=AKIA0123456789", "AWS_REGION=eu-west-1"].join("\n");
  const PVE = ["PROXMOX_VE_API_TOKEN=root@pam!ci=0123456789", "AWS_REGION=nowhere"].join("\n");

  function stacksHarness(root: string, env: Record<string, string> = {}) {
    const events: string[] = [];
    const log = rememberingLog();
    const original = log.group;
    log.group = (title, lines, verbatim) => {
      events.push(`log: ${title}`);
      original(title, lines, verbatim);
    };
    const load = stackEnvFiles({
      root,
      env: { PATH: "/usr/bin", ...env },
      mask: (value) => void events.push(`mask: ${value}`),
      log,
    });
    return { load, events, log };
  }

  test("a stack without a file gets the environment of the step, and nothing is read, masked or said", () => {
    const { load, events } = stacksHarness(fixture({}), { A: "1" });
    const envs = load([{ id: "a:prod" }, { id: "b:prod", envFile: undefined }]);
    expect(envs.get("a:prod")).toEqual({ ok: true, env: { PATH: "/usr/bin", A: "1" } });
    expect(envs.get("b:prod")).toEqual({ ok: true, env: { PATH: "/usr/bin", A: "1" } });
    expect(events).toEqual([]);
  });

  test("a stack's file goes on top of the step's environment, for that stack alone", () => {
    const root = fixture({ "ci/aws.env": AWS, "ci/pve.env": PVE });
    const { load } = stacksHarness(root, { AWS_REGION: "us-east-1", HOME: "/home/r" });
    const envs = load([
      { id: "infra/aws", envFile: "ci/aws.env" },
      { id: "infra/pve", envFile: "ci/pve.env" },
      { id: "infra/k8s" },
    ]);
    expect(envs.get("infra/aws")).toEqual({
      ok: true,
      env: {
        PATH: "/usr/bin",
        HOME: "/home/r",
        AWS_ACCESS_KEY_ID: "AKIA0123456789",
        AWS_REGION: "eu-west-1",
      },
    });
    expect(envs.get("infra/pve")).toEqual({
      ok: true,
      env: {
        PATH: "/usr/bin",
        HOME: "/home/r",
        AWS_REGION: "nowhere",
        PROXMOX_VE_API_TOKEN: "root@pam!ci=0123456789",
      },
    });
    expect(envs.get("infra/k8s")).toEqual({
      ok: true,
      env: { PATH: "/usr/bin", HOME: "/home/r", AWS_REGION: "us-east-1" },
    });
  });

  test("every value is masked before the log names the file and its stacks, and never a value", () => {
    const root = fixture({ "ci/aws.env": AWS });
    const { load, events, log } = stacksHarness(root, { AWS_REGION: "us-east-1" });
    load([
      { id: "infra/aws", envFile: "ci/aws.env" },
      { id: "infra/aws-dr", envFile: "ci/aws.env" },
    ]);
    expect(events).toEqual([
      "mask: AKIA0123456789",
      "mask: eu-west-1",
      "log: Loaded the env file ci/aws.env for infra/aws, infra/aws-dr",
    ]);
    expect(log.groups).toEqual([
      {
        title: "Loaded the env file ci/aws.env for infra/aws, infra/aws-dr",
        lines: [
          "2 values for the tool: AWS_ACCESS_KEY_ID, AWS_REGION.",
          "Masked: AWS_ACCESS_KEY_ID, AWS_REGION.",
          "The file wins over the job environment for: AWS_REGION.",
        ],
      },
    ]);
    expect(JSON.stringify(log)).not.toContain("AKIA0123456789");
  });

  test("a file is read, masked and said once per job, however often it is asked for", () => {
    const root = fixture({ "ci/aws.env": AWS });
    const { load, events } = stacksHarness(root);
    const first = load([{ id: "infra/aws", envFile: "ci/aws.env" }]);
    const again = load([
      { id: "infra/aws", envFile: "ci/aws.env" },
      { id: "infra/aws-dr", envFile: "ci/aws.env" },
    ]);
    expect(again.get("infra/aws-dr")).toEqual(first.get("infra/aws"));
    expect(events.filter((event) => event.startsWith("log:"))).toEqual([
      "log: Loaded the env file ci/aws.env for infra/aws",
    ]);
    expect(events.filter((event) => event.startsWith("mask:"))).toHaveLength(2);
  });

  test("a file that is not there fails that stack and no other, and nothing is thrown", () => {
    const root = fixture({ "ci/aws.env": AWS });
    const { load, events } = stacksHarness(root);
    const envs = load([
      { id: "infra/aws", envFile: "ci/aws.env" },
      { id: "infra/pve", envFile: "ci/pve.env" },
      { id: "infra/far", envFile: "/nowhere/far.env" },
    ]);
    expect(envs.get("infra/aws")?.ok).toBe(true);
    expect(envs.get("infra/pve")).toEqual({
      ok: false,
      detail: [
        "The envFile of the stack names ci/pve.env, and there is no such file in the checkout.",
      ],
    });
    expect(envs.get("infra/far")).toEqual({
      ok: false,
      detail: ["The envFile of the stack names /nowhere/far.env, and there is no such file."],
    });
    expect(events.filter((event) => event.startsWith("log:"))).toEqual([
      "log: Loaded the env file ci/aws.env for infra/aws",
    ]);
  });

  test("a path that is a directory, and a line the format refuses by number, each fail their stack", () => {
    const root = fixture({ "ci/aws.env": AWS, ".env": "A=12345678\nB=op://ci/x/y\n" });
    const { load, events } = stacksHarness(root);
    const envs = load([
      { id: "a", envFile: "ci" },
      { id: "b", envFile: ".env" },
    ]);
    expect(envs.get("a")).toEqual({
      ok: false,
      detail: ["The envFile of the stack names ci, and it could not be read as a file (EISDIR)."],
    });
    expect(envs.get("b")).toEqual({
      ok: false,
      detail: [
        "The env file .env cannot be loaded. Line 2 holds a secret reference (op://). Sluiceway resolves none: let your secret manager resolve the file first, or load its references the way the credentials page shows.",
      ],
    });
    expect(events).toEqual([]);
  });

  test("an absolute path is read where it is", () => {
    const root = fixture({});
    const elsewhere = fixture({ "resolved.env": "A=12345678\n" });
    const { load } = stacksHarness(root);
    const envs = load([{ id: "a", envFile: join(elsewhere, "resolved.env") }]);
    expect(envs.get("a")).toEqual({ ok: true, env: { PATH: "/usr/bin", A: "12345678" } });
  });
});
