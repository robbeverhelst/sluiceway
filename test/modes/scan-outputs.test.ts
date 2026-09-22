import { describe, expect, test } from "bun:test";
import { ConfigError } from "../../src/core/config.ts";
import { DashboardWriteError } from "../../src/github/write-loop.ts";
import { ScanFailedError, scan } from "../../src/modes/scan.ts";
import { scanResultSchema } from "../../src/render/result-file.ts";
import { BOT, FakeGitHub } from "../fake-github/fake-github.ts";
import {
  change,
  failing,
  harness,
  inSync,
  pending,
  REPO_URL,
  RUN_URL,
  SHA,
  steppingClock,
  tableAdapter,
} from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";

// The outputs and the result file of a scan (record 0041, build plan section
// 3): what a notify step or a metrics push reads. The counts are the counts
// line of the dashboard this scan wrote.

const TABLE = {
  "network:dev": pending("network:dev", change("logs"), change("old", "delete")),
  "network:prod": inSync("network:prod"),
  "site:prod": failing(),
};

describe("the outputs of a scan", () => {
  test("the counts, the dashboard and the result file", async () => {
    const outputs = rememberingOutputs();
    const { context } = harness(tableAdapter(TABLE), { outputs });

    await scan(context);

    expect(outputs.values).toEqual({
      "dashboard-url": `${REPO_URL}/issues/1`,
      pending: "1",
      "preview-failed": "1",
      "in-sync": "1",
      "dashboard-changed": "true",
      // Only a scan after a merge hands anything to apply (record 0054).
      matrix: "[]",
      "result-file": `${outputs.directory}/sluiceway-scan-result.json`,
    });
    const file = scanResultSchema.parse(outputs.resultFile("scan"));
    expect(file).toMatchObject({
      mode: "scan",
      run: RUN_URL,
      commit: SHA,
      dashboard: {
        url: `${REPO_URL}/issues/1`,
        changed: true,
        pending: 1,
        deploying: 0,
        previewFailed: 1,
        inSync: 1,
        failedDeploys: 0,
      },
    });
    expect(file.stacks.map(({ stack, state }) => [stack, state])).toEqual([
      ["network:dev", "pending"],
      ["network:prod", "in-sync"],
      ["site:prod", "preview-failed"],
    ]);
    expect(file.stacks[2]).toMatchObject({
      reason: "the tool exited with an error (exit code 255)",
    });
  });

  test("a scan that writes the same body again says the dashboard did not change", async () => {
    const first = harness(tableAdapter(TABLE));
    await scan(first.context);
    const outputs = rememberingOutputs();

    await scan({ ...first.context, now: steppingClock(), outputs });

    expect(outputs.values["dashboard-changed"]).toBe("false");
    expect(outputs.values.pending).toBe("1");
    expect(outputs.resultFile("scan")).toMatchObject({ dashboard: { changed: false } });
  });

  test("the result file holds none of the tool's own words", async () => {
    const outputs = rememberingOutputs();
    const words = "error: could not reach postgres://admin:hunter2@db\n";
    const { context } = harness(
      tableAdapter({ "a:prod": failing(words), "b:prod": inSync("b:prod") }),
      { outputs },
    );

    await scan(context);

    const text = JSON.stringify(outputs.resultFile("scan"));
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("postgres");
  });

  test("with no place for the result file the scan goes on, green, and says so", async () => {
    const outputs = rememberingOutputs({ noTemp: true });
    const { context, log } = harness(tableAdapter(TABLE), { outputs });

    await scan(context);

    expect(outputs.values["result-file"]).toBeUndefined();
    expect(outputs.values.pending).toBe("1");
    expect(log.warnings).toContainEqual({
      title: "Result file not written",
      message:
        "The result file of this step could not be written. The job log says why. Nothing else changes.",
    });
  });
});

describe("the outputs of a failed scan", () => {
  test("every preview failed: the dashboard was written, so every output is set", async () => {
    const outputs = rememberingOutputs();
    const { context } = harness(tableAdapter({ "a:prod": failing(), "b:prod": failing() }), {
      outputs,
    });

    await expect(scan(context)).rejects.toBeInstanceOf(ScanFailedError);

    expect(outputs.values).toMatchObject({
      "dashboard-url": `${REPO_URL}/issues/1`,
      pending: "0",
      "preview-failed": "2",
      "in-sync": "0",
      "dashboard-changed": "true",
    });
    expect(outputs.resultFile("scan")).toMatchObject({ dashboard: { previewFailed: 2 } });
  });

  test("a broken sluiceway.yaml: the defaults of the build plan, no dashboard, no result file", async () => {
    const outputs = rememberingOutputs();
    const { context } = harness(tableAdapter(TABLE), { outputs, config: "tickers: [a/b]\n" });

    await expect(scan(context)).rejects.toBeInstanceOf(ConfigError);

    expect(outputs.values).toEqual({
      pending: "0",
      "preview-failed": "0",
      "in-sync": "0",
      "dashboard-changed": "false",
      matrix: "[]",
    });
    expect(outputs.resultFile("scan")).toBeUndefined();
  });

  test("a write that never sticks: the counts stay at their defaults, and the result file has the previews and no dashboard", async () => {
    const github = new FakeGitHub({ updateLimitBytes: 10 });
    github.seedIssue({
      author: BOT,
      labels: ["sluiceway"],
      body: '<!-- sluiceway:dashboard v="1" -->\n',
    });
    const outputs = rememberingOutputs();
    const { context } = harness(tableAdapter(TABLE), { github, outputs });

    await expect(scan(context)).rejects.toBeInstanceOf(DashboardWriteError);

    expect(outputs.values).toMatchObject({
      pending: "0",
      "preview-failed": "0",
      "in-sync": "0",
      "dashboard-changed": "false",
    });
    expect(outputs.values["dashboard-url"]).toBeUndefined();
    const file = scanResultSchema.parse(outputs.resultFile("scan"));
    expect(file.dashboard).toBeNull();
    expect(file.stacks).toHaveLength(3);
  });
});
