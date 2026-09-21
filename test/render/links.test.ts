import { describe, expect, test } from "bun:test";
import { runLinks } from "../../src/render/links.ts";

const RUN = { repoUrl: "https://github.com/example-org/infra", runId: "4242", runAttempt: "2" };

describe("where the links of a job land (record 0044)", () => {
  test("a link to the summary names the attempt, so a re-run of the run does not move it", () => {
    expect(runLinks(RUN).summary).toBe(
      "https://github.com/example-org/infra/actions/runs/4242/attempts/2",
    );
  });

  test("a link to the job log is the page of the job itself", () => {
    expect(runLinks({ ...RUN, jobId: "106502264185" }).log).toBe(
      "https://github.com/example-org/infra/actions/runs/4242/job/106502264185",
    );
  });

  test("without the job's id the job log link falls back to the summary of the attempt", () => {
    expect(runLinks(RUN).log).toBe(
      "https://github.com/example-org/infra/actions/runs/4242/attempts/2",
    );
  });
});
