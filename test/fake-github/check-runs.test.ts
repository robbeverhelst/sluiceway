// The check runs of the fake copy what the preview page research measured on
// real GitHub (docs/research/preview-page.md on its research branch).

import { describe, expect, test } from "bun:test";
import { FakeGitHub, FakeGitHubError } from "./fake-github.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OUTPUT = { title: "t", summary: "s", text: "x" };

describe("check runs on the fake", () => {
  test("a created check run is finished, neutral and addressed by its id", async () => {
    const github = new FakeGitHub();
    const run = await github.createCheckRun({ sha: SHA, name: "sluiceway / a", output: OUTPUT });
    expect(run.htmlUrl).toBe(`https://github.com/acme/infra/runs/${run.id}`);
    expect(github.checkRuns(SHA)).toEqual([
      {
        id: run.id,
        name: "sluiceway / a",
        htmlUrl: run.htmlUrl,
        status: "completed",
        conclusion: "neutral",
        output: OUTPUT,
      },
    ]);
  });

  test("the list with filter=latest holds only the newest run of each name", async () => {
    const github = new FakeGitHub();
    await github.createCheckRun({ sha: SHA, name: "same", output: OUTPUT });
    const newer = await github.createCheckRun({ sha: SHA, name: "same", output: OUTPUT });
    const other = await github.createCheckRun({
      sha: "f".repeat(40),
      name: "same",
      output: OUTPUT,
    });
    expect(await github.listCheckRuns(SHA)).toEqual([
      { id: newer.id, name: "same", htmlUrl: newer.htmlUrl },
    ]);
    expect(other.id).not.toBe(newer.id);
  });

  test("the list costs one request per 100 check runs", async () => {
    const github = new FakeGitHub();
    for (let i = 0; i < 250; i++) github.seedCheckRun(SHA, `ci / job-${i}`);
    github.requests.length = 0;
    expect(await github.listCheckRuns(SHA)).toHaveLength(250);
    expect(github.requests).toEqual(["listCheckRuns", "listCheckRuns", "listCheckRuns"]);
  });

  test("an update replaces the whole output and keeps the id", async () => {
    const github = new FakeGitHub();
    const run = await github.createCheckRun({ sha: SHA, name: "a", output: OUTPUT });
    const updated = await github.updateCheckRun(run.id, { title: "u", summary: "v", text: "w" });
    expect(updated).toEqual(run);
    expect(github.checkRuns(SHA)[0]?.output).toEqual({ title: "u", summary: "v", text: "w" });
  });

  test("a summary or a text over 65,535 characters is refused", async () => {
    const github = new FakeGitHub();
    const long = "a".repeat(65_536);
    await expect(
      github.createCheckRun({ sha: SHA, name: "a", output: { ...OUTPUT, summary: long } }),
    ).rejects.toThrow("Only 65535 characters are allowed; 65536 were supplied.");
    await expect(
      github.createCheckRun({ sha: SHA, name: "a", output: { ...OUTPUT, text: long } }),
    ).rejects.toThrow("Only 65535 characters are allowed; 65536 were supplied.");
  });

  test("a summary over 65,535 bytes is refused, and a text over it is cut without a word", async () => {
    const github = new FakeGitHub();
    const wide = "é".repeat(32_768);
    await expect(
      github.createCheckRun({ sha: SHA, name: "a", output: { ...OUTPUT, summary: wide } }),
    ).rejects.toThrow("summary exceeds a maximum bytesize of 65535");
    await github.createCheckRun({ sha: SHA, name: "a", output: { ...OUTPUT, text: wide } });
    expect(github.checkRuns(SHA)[0]?.output.text).toBe("é".repeat(32_767));
  });

  test("without checks: write every write is refused as GitHub refuses it", async () => {
    const github = new FakeGitHub();
    const run = await github.createCheckRun({ sha: SHA, name: "a", output: OUTPUT });
    github.withoutChecksWrite();
    const refused = github.createCheckRun({ sha: SHA, name: "b", output: OUTPUT });
    await expect(refused).rejects.toThrow("Resource not accessible by integration");
    await expect(refused).rejects.toBeInstanceOf(FakeGitHubError);
    await expect(github.updateCheckRun(run.id, OUTPUT)).rejects.toThrow(
      "Resource not accessible by integration",
    );
    // A refused request is a request all the same.
    expect(github.requests.filter((one) => one !== "createCheckRun")).toEqual(["updateCheckRun"]);
  });

  test("an update of a check run GitHub does not have is refused", async () => {
    const github = new FakeGitHub();
    await expect(github.updateCheckRun(1, OUTPUT)).rejects.toThrow("Not Found");
  });
});
