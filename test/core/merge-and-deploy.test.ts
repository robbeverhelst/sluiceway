import { describe, expect, test } from "bun:test";
import {
  MAX_UPDATES,
  mergeMethod,
  type OpenPullRequest,
  type QualifyOptions,
  qualify,
  waitingUpdates,
} from "../../src/core/merge-and-deploy.ts";

const OPTIONS: QualifyOptions = {
  authors: ["renovate[bot]"],
  defaultBranch: "main",
  stacks: [
    { id: "apps/odoo:prod", path: "apps/odoo", inputs: [] },
    { id: "network:dev", path: "network", inputs: [] },
    { id: "network:prod", path: "network", inputs: [] },
    { id: "site:prod", path: "site", inputs: ["shared/**"] },
  ],
  unrelated: ["**/*.md"],
};

function pr(overrides: Partial<OpenPullRequest> = {}): OpenPullRequest {
  return {
    number: 418,
    title: "Update Helm release odoo to v17.0.4",
    author: "renovate[bot]",
    draft: false,
    base: "main",
    head: "a".repeat(40),
    mergeable: "mergeable",
    checks: "success",
    files: ["apps/odoo/Pulumi.prod.yaml"],
    filesComplete: true,
    ...overrides,
  };
}

describe("a pull request qualifies", () => {
  test("when its author is listed, its checks are green and one stack claims every file", () => {
    expect(qualify(pr(), OPTIONS)).toEqual({ qualifies: true, stackId: "apps/odoo:prod" });
  });

  test("with files that scan.unrelated leaves out, because they claim nothing and force nothing", () => {
    expect(qualify(pr({ files: ["apps/odoo/index.ts", "docs/odoo.md"] }), OPTIONS)).toEqual({
      qualifies: true,
      stackId: "apps/odoo:prod",
    });
  });

  test("with a file a stack claims through inputs", () => {
    expect(qualify(pr({ files: ["shared/motd.txt"] }), OPTIONS)).toEqual({
      qualifies: true,
      stackId: "site:prod",
    });
  });

  test("with an author written in another case", () => {
    expect(qualify(pr({ author: "Renovate[bot]" }), OPTIONS).qualifies).toBe(true);
  });
});

describe("a pull request does not qualify", () => {
  const not = (overrides: Partial<OpenPullRequest>, options: Partial<QualifyOptions> = {}) =>
    qualify(pr(overrides), { ...OPTIONS, ...options });

  test("when merge and deploy is off", () => {
    expect(not({}, { authors: [] })).toEqual({ qualifies: false, why: "author" });
  });

  test("when its author is not on the list", () => {
    expect(not({ author: "alice" })).toEqual({ qualifies: false, why: "author" });
    expect(not({ author: undefined })).toEqual({ qualifies: false, why: "author" });
  });

  test("when a person has the login of the app without [bot]", () => {
    expect(not({ author: "renovate" })).toEqual({ qualifies: false, why: "author" });
  });

  test("as a draft", () => {
    expect(not({ draft: true })).toEqual({ qualifies: false, why: "draft" });
  });

  test("into a branch that is not the default branch", () => {
    expect(not({ base: "release" })).toEqual({ qualifies: false, why: "base" });
  });

  test("when its checks are not green", () => {
    expect(not({ checks: "failure" })).toEqual({ qualifies: false, why: "checks" });
    expect(not({ checks: "pending" })).toEqual({ qualifies: false, why: "checks" });
    expect(not({ checks: "none" })).toEqual({ qualifies: false, why: "checks" });
  });

  test("when it conflicts with its base", () => {
    expect(not({ mergeable: "conflicting" })).toEqual({ qualifies: false, why: "conflicting" });
  });

  test("while GitHub has not worked out whether it merges cleanly", () => {
    expect(not({ mergeable: "unknown" }).qualifies).toBe(true);
  });

  test("when some of its files are not known", () => {
    expect(not({ filesComplete: false })).toEqual({ qualifies: false, why: "files-unknown" });
  });

  test("when a file is claimed by no stack", () => {
    expect(not({ files: ["apps/odoo/index.ts", "package.json"] })).toEqual({
      qualifies: false,
      why: "unclaimed",
    });
  });

  test("when two stacks claim its files, never", () => {
    expect(not({ files: ["apps/odoo/index.ts", "site/index.ts"] })).toEqual({
      qualifies: false,
      why: "two-stacks",
    });
  });

  test("when one file is claimed by two stacks, never", () => {
    expect(not({ files: ["network/Pulumi.yaml"] })).toEqual({
      qualifies: false,
      why: "two-stacks",
    });
  });

  test("when no stack claims anything, as with documentation alone", () => {
    expect(not({ files: ["README.md"] })).toEqual({ qualifies: false, why: "no-stack" });
    expect(not({ files: [] })).toEqual({ qualifies: false, why: "no-stack" });
  });
});

describe("the updates waiting to merge", () => {
  test("are the qualifying pull requests, oldest first, each with its stack", () => {
    const { listed, more } = waitingUpdates(
      [pr({ number: 420 }), pr({ number: 419, author: "alice" }), pr({ number: 418 })],
      OPTIONS,
    );
    expect(listed.map(({ pullRequest, stackId }) => [pullRequest.number, stackId])).toEqual([
      [418, "apps/odoo:prod"],
      [420, "apps/odoo:prod"],
    ]);
    expect(more).toBe(0);
  });

  test("are at most thirty, the oldest, and the rest are counted (slice 4.13)", () => {
    const many = Array.from({ length: 34 }, (_, index) => pr({ number: 500 - index }));
    const { listed, more } = waitingUpdates(many, OPTIONS);
    expect(MAX_UPDATES).toBe(30);
    expect(listed.map(({ pullRequest }) => pullRequest.number)).toEqual(
      Array.from({ length: 30 }, (_, index) => 467 + index),
    );
    expect(more).toBe(4);
  });
});

describe("the merge method", () => {
  const ALL = { squash: true, rebase: true, merge: true };

  test("is squash when Renovate says nothing and squash is allowed", () => {
    expect(mergeMethod(ALL, undefined)).toBe("squash");
    expect(mergeMethod(ALL, "auto")).toBe("squash");
  });

  test("is the one Renovate is set to use, when the repo allows it", () => {
    expect(mergeMethod(ALL, "rebase")).toBe("rebase");
    expect(mergeMethod(ALL, "merge-commit")).toBe("merge");
    expect(mergeMethod(ALL, "squash")).toBe("squash");
  });

  test("falls back to an allowed one when Renovate's is not allowed", () => {
    expect(mergeMethod({ squash: false, rebase: true, merge: true }, "squash")).toBe("merge");
    expect(mergeMethod({ squash: true, rebase: false, merge: true }, "rebase")).toBe("squash");
    expect(mergeMethod({ squash: false, rebase: false, merge: true }, undefined)).toBe("merge");
  });

  test("falls back in Renovate's own order on GitHub: squash, then a merge commit, then rebase", () => {
    expect(mergeMethod({ squash: false, rebase: true, merge: true }, undefined)).toBe("merge");
    expect(mergeMethod({ squash: false, rebase: true, merge: false }, undefined)).toBe("rebase");
  });

  test("reads fast-forward as Renovate does on GitHub: not supported, so the repo's method", () => {
    expect(mergeMethod(ALL, "fast-forward")).toBe("squash");
    expect(mergeMethod({ squash: false, rebase: true, merge: true }, "fast-forward")).toBe("merge");
  });

  test("is squash when GitHub did not say what is allowed, and GitHub decides", () => {
    expect(mergeMethod({}, undefined)).toBe("squash");
    expect(mergeMethod({}, "rebase")).toBe("rebase");
  });

  test("is nothing when the repo allows no method at all", () => {
    expect(mergeMethod({ squash: false, rebase: false, merge: false }, undefined)).toBeUndefined();
  });
});
