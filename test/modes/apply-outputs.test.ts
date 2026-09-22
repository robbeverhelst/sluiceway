import { describe, expect, test } from "bun:test";
import { ToolVersionError } from "../../src/adapters/adapter.ts";
import { applyResultSchema } from "../../src/render/result-file.ts";
import { type ApplyHarness, handedOn, runApply } from "./apply-harness.ts";
import { change, pending, REPO_URL } from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";

// The outputs and the result file of `apply` (record 0041, build plan section
// 3): `outcome`, `stack`, `dashboard-url` and `result-file`, set on every way
// out, a red one too.

const table = () => ({ "a:prod": pending("a:prod", change("bucket")) });

async function withOutputs(
  options: Parameters<typeof handedOn>[2] = {},
): Promise<ApplyHarness & { outputs: ReturnType<typeof rememberingOutputs> }> {
  const h = await handedOn(table(), ["a:prod"], options);
  const outputs = rememberingOutputs();
  h.context.outputs = outputs;
  return { ...h, outputs };
}

function file(outputs: ReturnType<typeof rememberingOutputs>) {
  return applyResultSchema.parse(outputs.resultFile("apply"));
}

describe("the outputs of apply", () => {
  test("a stack that deployed", async () => {
    const h = await withOutputs();

    await runApply(h);

    expect(h.outputs.values).toEqual({
      "dashboard-url": `${REPO_URL}/issues/${h.number}`,
      outcome: "deployed",
      stack: "a:prod",
      "result-file": `${h.outputs.directory}/sluiceway-apply-result.json`,
    });
    expect(file(h.outputs)).toEqual({
      version: 1,
      mode: "apply",
      run: `${REPO_URL}/actions/runs/${h.context.runId}`,
      commit: h.context.sha,
      deployment: h.deployment,
      dashboard: { url: `${REPO_URL}/issues/${h.number}` },
      outcome: "deployed",
      stack: "a:prod",
      ticker: "alice",
      reason: null,
      // The clock moves half a second a read: the start, both sides of the
      // deploy and the end (record 0061).
      seconds: 1.5,
      deploySeconds: 0.5,
      preview: {
        state: "pending",
        counts: { create: 0, update: 1, replace: 0, delete: 0, trackingOnly: 0 },
        changes: [
          {
            type: "aws:s3/bucket:Bucket",
            name: "bucket",
            op: "update",
            changedKeys: ["tags"],
            replaceKeys: [],
          },
        ],
      },
      after: null,
    });
  });

  test("the change moved since the tick: refused, with the fresh preview", async () => {
    const h = await withOutputs();
    h.table["a:prod"] = pending("a:prod", change("bucket"), change("queue", "create"));

    await expect(runApply(h)).rejects.toThrow("the change moved since the tick");

    expect(h.outputs.values).toMatchObject({ outcome: "refused", stack: "a:prod" });
    expect(file(h.outputs)).toMatchObject({
      outcome: "refused",
      reason: "the change moved since the tick",
      // The tool was never asked to deploy.
      deploySeconds: null,
      preview: { state: "pending", counts: { create: 1, update: 1 } },
      after: null,
    });
  });

  test("a deploy that failed half way: failed, with what is pending now", async () => {
    const h = await withOutputs({
      deploys: {
        "a:prod": {
          ok: false,
          reason: { kind: "tool-error", exitCode: 1 },
          toolLog: "error: exit status 1: running TOKEN=hunter2\n",
        },
      },
    });

    await expect(runApply(h)).rejects.toThrow("the tool exited with an error (exit code 1)");

    expect(h.outputs.values).toMatchObject({ outcome: "failed", stack: "a:prod" });
    const written = file(h.outputs);
    expect(written).toMatchObject({
      outcome: "failed",
      reason: "the tool exited with an error (exit code 1)",
      after: { state: "pending" },
    });
    expect(JSON.stringify(written)).not.toContain("hunter2");
  });

  test("a tool that is missing: failed, with the reason and no preview", async () => {
    const h = await withOutputs();
    h.adapter.checkVersion = async () => {
      throw new ToolVersionError(
        "Found pulumi v3.198.0. Sluiceway needs pulumi v3.229.0 or newer.",
      );
    };

    await expect(runApply(h)).rejects.toThrow("Found pulumi v3.198.0.");

    expect(h.outputs.values).toMatchObject({ outcome: "failed", stack: "a:prod" });
    expect(file(h.outputs)).toMatchObject({
      reason: "the tool is missing or older than Sluiceway needs",
      preview: null,
    });
  });

  test("a deploy that went out and whose result could not be written is still deployed", async () => {
    const h = await withOutputs();
    const write = h.github.createDeploymentStatus.bind(h.github);
    h.github.createDeploymentStatus = async (id, status) => {
      if (status.state === "success") throw new Error("Server Error");
      return write(id, status);
    };

    await expect(runApply(h)).rejects.toThrow("could not be given its result");

    expect(h.outputs.values.outcome).toBe("deployed");
  });
});

describe("the outputs of apply on a record it does not deploy", () => {
  test("a re-run of a record that ended: refused, no stack, and still one request", async () => {
    const h = await withOutputs();
    h.github.addDeploymentStatus(h.deployment, { state: "success", autoInactive: false });
    h.github.requests.length = 0;

    await expect(runApply(h)).rejects.toThrow("This deploy already ended.");

    expect(h.github.requests).toEqual(["latestDeploymentStatus"]);
    expect(h.outputs.values).toEqual({
      "dashboard-url": `${REPO_URL}/issues/${h.number}`,
      outcome: "refused",
      "result-file": `${h.outputs.directory}/sluiceway-apply-result.json`,
    });
    expect(file(h.outputs)).toMatchObject({ outcome: "refused", stack: null, ticker: null });
  });

  test("a record that is not Sluiceway's: refused, no stack", async () => {
    const h = await withOutputs();
    h.context.deploymentId = h.github.seedDeployment({ task: "deploy" }).id;

    await expect(runApply(h)).rejects.toThrow("is not one of Sluiceway's");

    expect(h.outputs.values.outcome).toBe("refused");
    expect(h.outputs.values.stack).toBeUndefined();
  });

  test("a record of another run: refused, for its stack", async () => {
    const h = await withOutputs();
    h.context.deploymentId = h.github.seedDeployment({
      task: "sluiceway:a:prod",
      payload: { v: 1, hash: "0000000000000000", ticker: "alice", run: "999" },
    }).id;

    await expect(runApply(h)).rejects.toThrow("belongs to run 999");

    expect(h.outputs.values).toMatchObject({ outcome: "refused", stack: "a:prod" });
  });

  test("a record that cannot be read: failed", async () => {
    const h = await withOutputs();
    h.github.latestDeploymentStatus = async () => {
      throw new Error("Not Found");
    };

    await expect(runApply(h)).rejects.toThrow("could not be read");

    expect(h.outputs.values.outcome).toBe("failed");
    expect(file(h.outputs)).toMatchObject({ outcome: "failed", stack: null, reason: null });
  });

  test("a run that an issue edit of another issue started names no dashboard", async () => {
    const h = await withOutputs();
    h.context.event = { issue: { number: 7, user: { login: "someone", type: "User" }, body: "" } };

    await runApply(h);

    expect(h.outputs.values["dashboard-url"]).toBeUndefined();
    expect(file(h.outputs).dashboard).toBeNull();
  });
});
