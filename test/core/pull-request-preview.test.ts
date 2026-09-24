import { describe, expect, test } from "bun:test";
import type { Claimant } from "../../src/core/claim.ts";
import {
  type PullRequestFacts,
  refusePullRequestPreview,
  stacksOfPullRequest,
} from "../../src/core/pull-request-preview.ts";

// Record 0101: a pull request preview runs the pull request's code with the
// credentials of its job, so two refusals are fixed before anything else. A
// pull request from a fork is refused outright, whatever GitHub withheld, and
// pull_request_target is never a pull request preview.

const PULL_REQUEST: PullRequestFacts = {
  number: 12,
  head: "89abcdef89abcdef89abcdef89abcdef89abcdef",
  base: "0123456789abcdef0123456789abcdef01234567",
  baseRef: "main",
  fromFork: false,
};

describe("what the preview refuses", () => {
  test("a pull request of the repo, on a pull_request event, is previewed", () => {
    expect(
      refusePullRequestPreview({ name: "pull_request", pullRequest: PULL_REQUEST }),
    ).toBeUndefined();
  });

  test("a pull request from a fork is refused, without relying on GitHub withholding secrets", () => {
    expect(
      refusePullRequestPreview({
        name: "pull_request",
        pullRequest: { ...PULL_REQUEST, fromFork: true },
      }),
    ).toEqual({ kind: "fork" });
  });

  test("pull_request_target is never used, even with a pull request of the repo", () => {
    expect(
      refusePullRequestPreview({ name: "pull_request_target", pullRequest: PULL_REQUEST }),
    ).toEqual({ kind: "pull-request-target" });
  });

  test("an event that is not a pull request has nothing to preview", () => {
    expect(refusePullRequestPreview({ name: "push" })).toEqual({
      kind: "not-a-pull-request",
      event: "push",
    });
    expect(refusePullRequestPreview({ name: "merge_group" })).toEqual({
      kind: "not-a-pull-request",
      event: "merge_group",
    });
  });

  test("a pull_request event whose payload names no pull request is refused the same way", () => {
    expect(refusePullRequestPreview({ name: "pull_request" })).toEqual({
      kind: "not-a-pull-request",
      event: "pull_request",
    });
  });
});

// Which stacks: the ones the pull request claims, by the claim rule of the
// narrowed scan (record 0010). A file no stack claims previews nothing here:
// the scan after the merge previews every stack for it.
const STACKS: Claimant[] = [
  { id: "apps/web:prod", path: "apps/web", inputs: ["packages/ui/**"] },
  { id: "network:dev", path: "network", inputs: [] },
  { id: "network:prod", path: "network", inputs: [] },
];

const files = (...paths: string[]) => ({
  status: "diverged",
  files: paths.map((path) => ({ path })),
});

describe("which stacks a pull request claims", () => {
  test("a file inside a stack's directory, or one its inputs name, claims the stack, in stack id order", () => {
    expect(
      stacksOfPullRequest(STACKS, files("packages/ui/button.ts", "network/Pulumi.dev.yaml"), []),
    ).toEqual({
      kind: "claimed",
      stackIds: ["apps/web:prod", "network:dev", "network:prod"],
      unclaimed: [],
    });
  });

  test("a file no stack claims is listed, and previews nothing", () => {
    expect(
      stacksOfPullRequest(STACKS, files("package-lock.json", "apps/web/index.ts"), []),
    ).toEqual({
      kind: "claimed",
      stackIds: ["apps/web:prod"],
      unclaimed: ["package-lock.json"],
    });
  });

  test("a file scan.unrelated covers, or a default unrelated file, claims nothing and is not listed", () => {
    expect(
      stacksOfPullRequest(STACKS, files("docs/setup.md", "tools/lint.sh"), ["tools/**"]),
    ).toEqual({
      kind: "claimed",
      stackIds: [],
      unclaimed: [],
    });
  });

  test("a renamed file counts under both its paths", () => {
    expect(
      stacksOfPullRequest(
        STACKS,
        { status: "ahead", files: [{ path: "shared/a.json", previousPath: "network/a.json" }] },
        [],
      ),
    ).toEqual({
      kind: "claimed",
      stackIds: ["network:dev", "network:prod"],
      unclaimed: ["shared/a.json"],
    });
  });

  test("a pull request of 300 files or more cannot be listed whole, so nothing is previewed", () => {
    const many = Array.from({ length: 300 }, (_, index) => `network/file-${index}.yaml`);
    expect(stacksOfPullRequest(STACKS, files(...many), [])).toEqual({ kind: "too-many-files" });
  });
});
