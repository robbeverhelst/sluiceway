// Record 0044: the links a scan writes land as close to one stack's detail as
// GitHub allows. A pending row links to the summary of the attempt that
// previewed it, and a preview failure to the log of the job that holds the
// tool's own words.

import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import {
  change,
  dashboardBody,
  failing,
  harness,
  inSync,
  JOB_URL,
  pending,
  REPO_URL,
  RUN_ID,
  SUMMARY_URL,
  tableAdapter,
} from "./harness.ts";

const ADAPTER = () =>
  tableAdapter({
    "network:dev": pending("network:dev", change("logs")),
    "network:prod": failing(),
    "site:prod": inSync("site:prod"),
  });

describe("the links of a scan (record 0044)", () => {
  test("a pending row's preview link names the attempt, so a re-run of the run does not move it", async () => {
    const { context, github } = harness(ADAPTER());
    await scan(context);
    expect(SUMMARY_URL).toBe(`${REPO_URL}/actions/runs/${RUN_ID}/attempts/1`);
    expect(dashboardBody(github)).toContain(
      `- [ ] **network:dev** · 1 update · [preview](${SUMMARY_URL})`,
    );
  });

  test("a preview failure's run link lands on the job log", async () => {
    const { context, github } = harness(ADAPTER());
    await scan(context);
    expect(JOB_URL).toBe(`${REPO_URL}/actions/runs/${RUN_ID}/job/106502264185`);
    expect(dashboardBody(github)).toContain(
      `- **network:prod** · preview failed: the tool exited with an error (exit code 255) · [run](${JOB_URL})`,
    );
  });

  test("a second attempt of the same run links to its own summary", async () => {
    const { context, github } = harness(ADAPTER(), { runAttempt: "2" });
    await scan(context);
    expect(dashboardBody(github)).toContain(
      `[preview](${REPO_URL}/actions/runs/${RUN_ID}/attempts/2)`,
    );
  });

  test("without the job's id a preview failure links to the summary instead", async () => {
    const { context, github } = harness(ADAPTER(), { jobId: undefined });
    await scan(context);
    expect(dashboardBody(github)).toContain(
      `· preview failed: the tool exited with an error (exit code 255) · [run](${SUMMARY_URL})`,
    );
  });

  test("the summary has an index, and its preview failure links to the job log", async () => {
    const { context, log } = harness(ADAPTER());
    await scan(context);
    const summary = log.summaries.at(-1) ?? "";
    expect(summary).toContain(
      [
        "- Pending: [network:dev](#user-content-sluiceway-network-3a-dev)",
        "- Preview failed: [network:prod](#user-content-sluiceway-network-3a-prod)",
      ].join("\n"),
    );
    expect(summary).toContain(`the tool's own words are in the [job log](${JOB_URL})`);
  });

  test("without the job's id the summary names the job log and does not link it", async () => {
    const { context, log } = harness(ADAPTER(), { jobId: undefined });
    await scan(context);
    expect(log.summaries.at(-1)).not.toContain("[job log]");
  });
});
