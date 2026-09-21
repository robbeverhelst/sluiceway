import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import { change, failing, harness, pending, tableAdapter } from "./harness.ts";

// The job log says how many requests a scan made to the GitHub API, so the
// budget of record 0017 can be read from a real run (acceptance, part 3).

function requestLine(lines: string[]): string | undefined {
  return lines.find((line) => line.startsWith("The scan made "));
}

describe("the request count in the job log", () => {
  test("a scan logs the number of requests it made, last", async () => {
    const adapter = tableAdapter({ "app:prod": pending("app:prod", change("bucket")) });
    const { context, github, log } = harness(adapter);
    await scan({ ...context, requests: () => github.requests.length });
    expect(github.requests).toHaveLength(7);
    expect(log.lines.at(-1)).toBe(
      "The scan made 7 requests to the GitHub API. GitHub allows the workflow token at least 1,000 an hour in a repo.",
    );
  });

  test("one request is one request", async () => {
    const { context, log } = harness(tableAdapter({}));
    await scan({ ...context, requests: () => 1 });
    expect(requestLine(log.lines)).toStartWith("The scan made 1 request to the GitHub API.");
  });

  test("a scan that goes red still logs its count", async () => {
    const adapter = tableAdapter({ "a:prod": failing(), "b:prod": failing() });
    const { context, github, log } = harness(adapter);
    await expect(scan({ ...context, requests: () => github.requests.length })).rejects.toThrow(
      "Every preview failed",
    );
    expect(requestLine(log.lines)).toStartWith(
      `The scan made ${github.requests.length} requests to the GitHub API.`,
    );
  });

  test("without a count, as in a test that does not look, no line", async () => {
    const { context, log } = harness(tableAdapter({}));
    await scan(context);
    expect(requestLine(log.lines)).toBeUndefined();
  });
});
