import { describe, expect, test } from "bun:test";
import { FakeGitHub } from "./fake-github.ts";

// The fake's merge call answers the way the REST documentation says GitHub
// does (slice 4.2).

const HEAD = "0123456789abcdef0123456789abcdef01234567";

describe("the fake's pull requests", () => {
  test("a merge takes the pull request out of the open list and gives a commit", async () => {
    const github = new FakeGitHub();
    github.seedOpenPullRequest({ number: 418, head: HEAD });
    const answer = await github.mergePullRequest(418, { head: HEAD, method: "squash" });
    expect(answer).toMatchObject({ merged: true });
    expect((await github.listOpenPullRequests()).pullRequests).toEqual([]);
    expect(github.merges).toMatchObject([{ number: 418, head: HEAD, method: "squash" }]);
  });

  test("a head that moved is 409, a merged one 405, and a seeded refusal is given as it is", async () => {
    const github = new FakeGitHub();
    github.seedOpenPullRequest({ number: 1, head: HEAD });
    github.seedOpenPullRequest({ number: 2, head: HEAD });
    github.refuseMerge(2, 405, 'Required status check "ci" is expected.');
    expect(
      await github.mergePullRequest(1, { head: "f".repeat(40), method: "squash" }),
    ).toMatchObject({
      merged: false,
      status: 409,
    });
    expect(await github.mergePullRequest(3, { head: HEAD, method: "squash" })).toMatchObject({
      merged: false,
      status: 405,
    });
    expect(await github.mergePullRequest(2, { head: HEAD, method: "squash" })).toEqual({
      merged: false,
      status: 405,
      message: 'Required status check "ci" is expected.',
    });
  });

  test("a method the repo does not allow is 405", async () => {
    const github = new FakeGitHub();
    github.seedOpenPullRequest({ number: 1, head: HEAD });
    github.setAllowedMergeMethods({ squash: false, rebase: true, merge: true });
    expect(await github.mergePullRequest(1, { head: HEAD, method: "squash" })).toMatchObject({
      merged: false,
      status: 405,
    });
  });

  test("without contents: write the settings are left out and a merge fails", async () => {
    const github = new FakeGitHub();
    github.seedOpenPullRequest({ number: 1, head: HEAD });
    github.withoutContentsWrite();
    expect(await github.allowedMergeMethods()).toEqual({});
    await expect(github.mergePullRequest(1, { head: HEAD, method: "squash" })).rejects.toThrow(
      "Resource not accessible by integration",
    );
  });
});
