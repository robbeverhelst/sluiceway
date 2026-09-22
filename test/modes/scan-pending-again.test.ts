import { describe, expect, test } from "bun:test";
import { diffHash } from "../../src/core/diff-hash.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  change,
  dashboardBody,
  harness,
  JOB_ID,
  pending,
  REPO_URL,
  RUN_ID,
  tableAdapter,
} from "./harness.ts";

// Slice 2.22, onboarding log hurdle 21: a program that makes a value that
// differs on every run is pending again right after every deploy. The row
// says so when the newest deployment record of the stack is a deploy of this
// same diff hash.

const LINE =
  ":information_source: pending again right after a deploy of this same change, a value in the program may differ on every run.";

const logs = pending("a:prod", change("logs"));
const HASH = logs.ok ? diffHash(logs.diff) : "";

function rowText(body: string, id: string): string {
  return parseDashboard(body).rows.find((row) => row.stackId === id)?.text ?? "";
}

function deployed(hash: string, state = "success", description = "") {
  return {
    task: "sluiceway:a:prod",
    payload: { v: 1, hash, ticker: "alice", run: "4242" },
    createdAt: "2026-09-21T05:10:00Z",
    status: { state, description, createdAt: "2026-09-21T05:11:00Z" },
  };
}

describe("a stack that is pending again right after a deploy", () => {
  test("gets the line when its newest record deployed this same diff hash", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": logs }));
    github.seedDeployment(deployed(HASH));

    await scan(context);
    expect(rowText(dashboardBody(github), "a:prod")).toContain(`  ${LINE}\n`);
  });

  test("gets it after a deploy that another writer's success made inactive", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": logs }));
    github.seedDeployment(deployed(HASH, "inactive"));

    await scan(context);
    expect(rowText(dashboardBody(github), "a:prod")).toContain(LINE);
  });

  test("points at the tool's own diff in the job log when scan.logDiff is on", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": logs }), {
      config: "scan:\n  logDiff: true\n",
    });
    github.seedDeployment(deployed(HASH));

    await scan(context);
    expect(rowText(dashboardBody(github), "a:prod")).toContain(
      `  ${LINE} Compare the tool's own diff in the [job log](${REPO_URL}/actions/runs/${RUN_ID}/job/${JOB_ID}).\n`,
    );
  });

  test("has no pointer when scan.logDiff is off", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": logs }));
    github.seedDeployment(deployed(HASH));

    await scan(context);
    expect(rowText(dashboardBody(github), "a:prod")).not.toContain("tool's own diff");
  });
});

describe("no line", () => {
  test("when the deploy was of a different diff hash", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": logs }));
    github.seedDeployment(deployed("0123456789abcdef"));

    await scan(context);
    expect(rowText(dashboardBody(github), "a:prod")).not.toContain("pending again");
  });

  test("when the newest record is not a deploy that went out", async () => {
    for (const [state, description] of [
      ["failure", "the tool exited with an error"],
      ["success", "nothing to deploy, already in sync"],
    ] as const) {
      const { context, github } = harness(tableAdapter({ "a:prod": logs }));
      github.seedDeployment(deployed(HASH, state, description));

      await scan(context);
      expect(rowText(dashboardBody(github), "a:prod")).not.toContain("pending again");
    }
  });

  test("when a newer deploy of another hash came after the one of this hash", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": logs }));
    github.seedDeployment(deployed(HASH));
    github.seedDeployment({
      ...deployed("0123456789abcdef"),
      createdAt: "2026-09-21T05:20:00Z",
      status: { state: "success", description: "", createdAt: "2026-09-21T05:21:00Z" },
    });

    await scan(context);
    expect(rowText(dashboardBody(github), "a:prod")).not.toContain("pending again");
  });

  test("on a stack with no deployment record", async () => {
    const { context, github } = harness(tableAdapter({ "a:prod": logs }));

    await scan(context);
    expect(rowText(dashboardBody(github), "a:prod")).not.toContain("pending again");
  });
});
