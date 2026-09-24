import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  DeployHistoryResult,
  HistoryOptions,
  Preparation,
  PreviewOptions,
  PreviewResult,
} from "../../src/adapters/adapter.ts";
import type { Stack } from "../../src/core/stack.ts";
import { stackId } from "../../src/core/stack.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  change,
  dashboardBody,
  drifted,
  harness,
  inSync,
  pending,
  repoRoot,
  tableAdapter,
} from "./harness.ts";

// Slice 5.38 (record 0103): a stack whose entry names an env file gets the
// job's environment, the step's file on top and its own file on top of that,
// for its preview, its drift check, its tool diff, its preparation and the
// read of its history. Another stack gets the environment of the step as it
// is. A file that cannot be loaded fails the preview of its stack and no
// other, and never the scan.

const AWS = "AWS_ACCESS_KEY_ID=AKIA0123456789\nREGION=eu-west-1\n";
const PVE = "PROXMOX_VE_API_TOKEN=root@pam!ci=0123456789\nREGION=nowhere\n";

function repo(config: string, files: Record<string, string>): string {
  const root = repoRoot(config);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const CONFIG = [
  "stacks:",
  "  - path: infra/aws",
  "    envFile: ci/aws.env",
  "  - path: infra/pve",
  "    envFile: ci/pve.env",
  "",
].join("\n");

const STEP_ENV = { PATH: "/usr/bin", REGION: "us-east-1", KUBECONFIG: "/home/r/.kube/config" };

function rowStates(body: string): Record<string, string> {
  return Object.fromEntries(parseDashboard(body).rows.map((row) => [row.stackId, row.state]));
}

// The environment each preview of the table adapter was started with.
function seeing(table: Record<string, PreviewResult>) {
  const seen: Record<string, Record<string, string | undefined>> = {};
  const adapter = tableAdapter(
    Object.fromEntries(
      Object.entries(table).map(([id, result]) => [
        id,
        async (options: PreviewOptions) => {
          seen[id] = options.env;
          return result;
        },
      ]),
    ),
  );
  return { adapter, seen };
}

describe("the env file of a stack in a scan", () => {
  test("each stack's preview gets its own file on top of the step's environment, and a stack without one gets the step's", async () => {
    const { adapter, seen } = seeing({
      "infra/aws": inSync("infra/aws"),
      "infra/pve": inSync("infra/pve"),
      "infra/k8s": inSync("infra/k8s"),
    });
    const masked: string[] = [];
    const { context, github, log } = harness(adapter, {
      root: repo(CONFIG, { "ci/aws.env": AWS, "ci/pve.env": PVE }),
      env: STEP_ENV,
      mask: (value) => void masked.push(value),
    });

    await scan(context);

    expect(seen["infra/aws"]).toEqual({
      ...STEP_ENV,
      AWS_ACCESS_KEY_ID: "AKIA0123456789",
      REGION: "eu-west-1",
    });
    expect(seen["infra/pve"]).toEqual({
      ...STEP_ENV,
      PROXMOX_VE_API_TOKEN: "root@pam!ci=0123456789",
      REGION: "nowhere",
    });
    expect(seen["infra/k8s"]).toEqual(STEP_ENV);
    expect(rowStates(dashboardBody(github))).toEqual({
      "infra/aws": "in-sync",
      "infra/k8s": "in-sync",
      "infra/pve": "in-sync",
    });
    // Masked before the file is named, and named per stack (record 0100).
    expect(masked.sort()).toEqual(
      ["AKIA0123456789", "eu-west-1", "nowhere", "root@pam!ci=0123456789"].sort(),
    );
    expect(log.groups.map((group) => group.title)).toEqual(
      expect.arrayContaining([
        "Loaded the env file ci/aws.env for infra/aws",
        "Loaded the env file ci/pve.env for infra/pve",
      ]),
    );
    expect(JSON.stringify(log)).not.toContain("AKIA0123456789");
    expect(JSON.stringify(github.issue(1))).not.toContain("AKIA0123456789");
  });

  test("a file that is not there fails the preview of its stack alone, with the path in the log, and the scan goes on", async () => {
    const { adapter, seen } = seeing({
      "infra/aws": pending("infra/aws", change("bucket")),
      "infra/pve": inSync("infra/pve"),
    });
    const { context, github, log } = harness(adapter, {
      root: repo(CONFIG, { "ci/aws.env": AWS }),
      env: STEP_ENV,
      mask: () => {},
    });

    await scan(context);

    expect(adapter.previewed).toEqual(["infra/aws"]);
    expect(seen["infra/pve"]).toBeUndefined();
    expect(rowStates(dashboardBody(github))).toEqual({
      "infra/aws": "pending",
      "infra/pve": "preview-failed",
    });
    expect(dashboardBody(github)).toContain(
      "**infra/pve** · preview failed: the env file of the stack could not be loaded",
    );
    const group = log.groups.find((one) => one.title === "infra/pve");
    expect(group?.lines).toEqual([
      "preview failed: the env file of the stack could not be loaded",
      "The envFile of the stack names ci/pve.env, and there is no such file in the checkout.",
    ]);
  });

  test("a line the format refuses fails the stack by line number and never quotes the line", async () => {
    const { adapter } = seeing({
      "infra/aws": inSync("infra/aws"),
      "infra/pve": inSync("infra/pve"),
    });
    const { context, github, log } = harness(adapter, {
      root: repo(CONFIG, { "ci/aws.env": AWS, "ci/pve.env": "TOKEN=op://ci/pve/token\n" }),
      env: STEP_ENV,
      mask: () => {},
    });

    await scan(context);

    expect(rowStates(dashboardBody(github))).toEqual({
      "infra/aws": "in-sync",
      "infra/pve": "preview-failed",
    });
    const group = log.groups.find((one) => one.title === "infra/pve");
    expect(group?.lines[1]).toStartWith(
      "The env file ci/pve.env cannot be loaded. Line 1 holds a secret reference (op://).",
    );
    expect(JSON.stringify(log)).not.toContain("op://ci/pve/token");
  });

  test("the drift check and the tool's own diff of a stack get its environment too", async () => {
    const seen: Record<string, Record<string, string | undefined>> = {};
    const adapter = tableAdapter(
      { "infra/aws": pending("infra/aws", change("bucket")), "infra/pve": inSync("infra/pve") },
      {},
      {
        "infra/aws": async (options) => {
          seen.toolDiff = options.env;
          return { ok: true, text: "  ~ bucket\n", toolLog: "" };
        },
      },
      {
        "infra/aws": async (options) => {
          seen.drift = options.env;
          return drifted("infra/aws", change("queue"));
        },
      },
    );
    const { context } = harness(adapter, {
      root: repo(`${CONFIG}drift:\n  enabled: true\nscan:\n  logDiff: true\n`, {
        "ci/aws.env": AWS,
        "ci/pve.env": PVE,
      }),
      env: STEP_ENV,
      mask: () => {},
      event: "schedule",
    });

    await scan(context);

    const own = { ...STEP_ENV, AWS_ACCESS_KEY_ID: "AKIA0123456789", REGION: "eu-west-1" };
    expect(seen.drift).toEqual(own);
    expect(seen.toolDiff).toEqual(own);
  });

  test("a preparation runs with the environment of the stacks it prepares, once per file", async () => {
    const events: { title: string; env: Record<string, string | undefined> }[] = [];
    const adapter = tableAdapter({
      "infra/aws": inSync("infra/aws"),
      "infra/aws-dr": inSync("infra/aws-dr"),
      "infra/pve": inSync("infra/pve"),
      "infra/k8s": inSync("infra/k8s"),
    });
    adapter.prepare = (stacks: Stack[]): Preparation[] =>
      stacks.map((stack) => ({
        title: stackId(stack),
        stacks: [stack],
        run: async (context) => {
          events.push({ title: stackId(stack), env: context.env });
          return { ok: true, toolLog: "" };
        },
      }));
    const config = `${CONFIG}  - path: infra/aws-dr\n    envFile: ci/aws.env\n`;
    const { context, log } = harness(adapter, {
      root: repo(config, { "ci/aws.env": AWS, "ci/pve.env": PVE }),
      env: STEP_ENV,
      mask: () => {},
    });

    await scan(context);

    const aws = { ...STEP_ENV, AWS_ACCESS_KEY_ID: "AKIA0123456789", REGION: "eu-west-1" };
    expect(events).toEqual([
      { title: "infra/aws", env: aws },
      { title: "infra/aws-dr", env: aws },
      { title: "infra/k8s", env: STEP_ENV },
      {
        title: "infra/pve",
        env: { ...STEP_ENV, PROXMOX_VE_API_TOKEN: "root@pam!ci=0123456789", REGION: "nowhere" },
      },
    ]);
    expect(
      log.groups.map((group) => group.title).filter((title) => title.startsWith("Loaded")),
    ).toEqual([
      "Loaded the env file ci/aws.env for infra/aws, infra/aws-dr",
      "Loaded the env file ci/pve.env for infra/pve",
    ]);
  });

  test("a stack whose file could not be loaded is not prepared and not previewed", async () => {
    const prepared: string[] = [];
    const adapter = tableAdapter({
      "infra/aws": inSync("infra/aws"),
      "infra/pve": inSync("infra/pve"),
    });
    adapter.prepare = (stacks: Stack[]): Preparation[] =>
      stacks.map((stack) => ({
        title: stackId(stack),
        stacks: [stack],
        run: async () => {
          prepared.push(stackId(stack));
          return { ok: true, toolLog: "" };
        },
      }));
    const { context, github } = harness(adapter, {
      root: repo(CONFIG, { "ci/aws.env": AWS }),
      env: STEP_ENV,
      mask: () => {},
    });

    await scan(context);

    expect(prepared).toEqual(["infra/aws"]);
    expect(adapter.previewed).toEqual(["infra/aws"]);
    expect(rowStates(dashboardBody(github))).toEqual({
      "infra/aws": "in-sync",
      "infra/pve": "preview-failed",
    });
  });

  test("the read of a stack's history gets its environment, and a stack whose file failed is not read", async () => {
    const seen: Record<string, Record<string, string | undefined>> = {};
    const adapter = tableAdapter({
      "infra/aws": inSync("infra/aws"),
      "infra/pve": inSync("infra/pve"),
    });
    adapter.deployHistory = async (
      stack: Stack,
      options: HistoryOptions,
    ): Promise<DeployHistoryResult> => {
      seen[stackId(stack)] = options.env;
      return { ok: true, deploys: [], toolLog: "" };
    };
    const { context, log } = harness(adapter, {
      root: repo(CONFIG, { "ci/aws.env": AWS }),
      env: STEP_ENV,
      mask: () => {},
    });

    await scan(context);

    expect(seen).toEqual({
      "infra/aws": { ...STEP_ENV, AWS_ACCESS_KEY_ID: "AKIA0123456789", REGION: "eu-west-1" },
    });
    expect(log.lines).toContain(
      "1 stack was not read for deploys made outside the dashboard: its env file could not be loaded (record 0103). infra/pve.",
    );
  });
});
