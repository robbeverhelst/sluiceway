import { describe, expect, test } from "bun:test";
import {
  attributor,
  type CommitWalk,
  directPushesToRead,
  type WalkedCommit,
  type WalkedPullRequest,
} from "../../src/core/attribution.ts";
import type { Claimant } from "../../src/core/claim.ts";

const REPO_URL = "https://github.com/acme/infra";

// A commit id of forty characters that a test can read: `sha("c3")`.
function sha(name: string): string {
  return name.padEnd(40, "0");
}

function claimant(id: string, inputs: string[] = []): Claimant {
  const [path = ""] = id.split(":");
  return { id, path, inputs };
}

function pullRequest(
  number: number,
  author: string | undefined,
  files: string[],
  rest: Partial<WalkedPullRequest> = {},
): WalkedPullRequest {
  return {
    number,
    title: `Pull request ${number}`,
    author,
    base: "main",
    merged: true,
    changedFiles: files.length,
    files,
    ...rest,
  };
}

// A commit by its short name, its parents by theirs.
function commit(
  name: string,
  parents: string[],
  rest: Partial<Omit<WalkedCommit, "sha" | "parents">> = {},
): WalkedCommit {
  return {
    sha: sha(name),
    parents: parents.map(sha),
    author: "bob",
    message: `commit ${name}`,
    pullRequests: [],
    ...rest,
  };
}

function walkOf(...commits: WalkedCommit[]): CommitWalk {
  return { defaultBranch: "main", commits };
}

const STACKS = [claimant("apps/grafana:prod"), claimant("apps/loki:prod", ["shared/**"])];

function attribute(
  walk: CommitWalk,
  stackId: string,
  from: string | undefined,
  rest: { pushFiles?: Record<string, string[]>; unrelated?: string[]; stacks?: Claimant[] } = {},
) {
  const of = attributor({
    walk,
    pushFiles: new Map(
      Object.entries(rest.pushFiles ?? {}).map(([name, files]) => [sha(name), files]),
    ),
    stacks: rest.stacks ?? STACKS,
    unrelated: rest.unrelated ?? [],
    repoUrl: REPO_URL,
    scanSha: walk.commits[0]?.sha ?? sha("none"),
  });
  return of(stackId, from === undefined ? undefined : sha(from));
}

function compare(from: string, to: string): string {
  return `[compare](${REPO_URL}/compare/${sha(from).slice(0, 12)}...${sha(to).slice(0, 12)})`;
}

const grafana3 = pullRequest(3, "alice", ["apps/grafana/index.ts"]);
const loki2 = pullRequest(2, "carol", ["apps/loki/index.ts"]);

describe("squash merges", () => {
  // One commit per pull request, in a straight line.
  const walk = walkOf(
    commit("c3", ["c2"], { pullRequests: [grafana3] }),
    commit("c2", ["c1"], { pullRequests: [loki2] }),
    commit("c1", ["c0"], { pullRequests: [pullRequest(1, "dave", ["apps/grafana/old.ts"])] }),
  );

  test("a row names the pull request its stack claims since the last deployed commit", () => {
    expect(attribute(walk, "apps/grafana:prod", "c1").lines.full).toBe(
      `from #3 by alice · ${compare("c1", "c3")}`,
    );
  });

  test("a pull request that only another stack claims is neither named nor counted", () => {
    expect(attribute(walk, "apps/loki:prod", "c1").lines.full).toBe(
      `from #2 by carol · ${compare("c1", "c3")}`,
    );
  });

  test("the deployed commit itself and everything under it are out of range", () => {
    expect(attribute(walk, "apps/grafana:prod", "c1").lines.full).not.toContain("#1");
  });
});

describe("what a job has to read first", () => {
  test("nothing, when every commit in range has its pull request", () => {
    const walk = walkOf(commit("c2", ["c1"], { pullRequests: [grafana3] }), commit("c1", []));
    expect(directPushesToRead(walk, [sha("c1")])).toEqual([]);
  });
});

describe("a merge commit", () => {
  // Pull request 7 landed as a merge commit on top of its two branch commits,
  // while pull request 8 was squashed onto main in between.
  //
  //   m ── s8 ── c1 (deployed)
  //    └── b2 ── b1 ──┘
  const pr7 = pullRequest(7, "alice", ["apps/grafana/a.ts", "apps/grafana/b.ts"]);
  const pr8 = pullRequest(8, "carol", ["apps/grafana/c.ts"]);
  const walk = walkOf(
    commit("m", ["s8", "b2"], { pullRequests: [pr7] }),
    commit("b2", ["b1"], { pullRequests: [pr7] }),
    commit("s8", ["c1"], { pullRequests: [pr8] }),
    commit("b1", ["c1"], { pullRequests: [pr7] }),
    commit("c1", ["c0"], { pullRequests: [pullRequest(1, "dave", ["apps/grafana/old.ts"])] }),
    commit("c0", []),
  );

  test("and the branch commits under it name their pull request once", () => {
    expect(attribute(walk, "apps/grafana:prod", "c1").lines.full).toBe(
      `from #7 by alice, #8 by carol · ${compare("c1", "m")}`,
    );
  });

  test("a deploy from the first parent leaves the branch commits in range", () => {
    expect(attribute(walk, "apps/grafana:prod", "s8").lines.full).toBe(
      `from #7 by alice · ${compare("s8", "m")}`,
    );
  });

  test("a deploy of the merge commit leaves nothing in range", () => {
    expect(attribute(walk, "apps/grafana:prod", "m").lines.full).toBe(
      `nothing this stack claims has changed since its last deploy · ${compare("m", "m")}`,
    );
  });

  test("a parent outside the lookback is not followed", () => {
    const cut = walkOf(...walk.commits.slice(0, 4));
    expect(attribute(cut, "apps/grafana:prod", "s8").lines.full).toBe(
      `from #7 by alice · ${compare("s8", "m")}`,
    );
  });
});

describe("a rebase merge", () => {
  const pr9 = pullRequest(9, "alice", ["apps/grafana/a.ts"]);
  const walk = walkOf(
    commit("r3", ["r2"], { pullRequests: [pr9] }),
    commit("r2", ["r1"], { pullRequests: [pr9] }),
    commit("r1", ["c1"], { pullRequests: [pr9] }),
    commit("c1", []),
  );

  test("of three commits is one pull request on the line", () => {
    expect(attribute(walk, "apps/grafana:prod", "c1").lines.full).toBe(
      `from #9 by alice · ${compare("c1", "r3")}`,
    );
  });

  test("is still named when the deploy ran in the middle of it", () => {
    expect(attribute(walk, "apps/grafana:prod", "r1").lines.full).toBe(
      `from #9 by alice · ${compare("r1", "r3")}`,
    );
  });
});

describe("a direct push", () => {
  const walk = walkOf(
    commit("d2", ["d1"], { author: "bob" }),
    commit("d1", ["c1"], { author: undefined }),
    commit("c1", []),
  );
  const pushFiles = { d2: ["apps/grafana/x.ts"], d1: ["apps/grafana/y.ts"] };

  test("is named by its short id as a link, with the commit's author", () => {
    expect(attribute(walk, "apps/grafana:prod", "c1", { pushFiles }).lines.full).toBe(
      `from [d200000](${REPO_URL}/commit/${sha("d2")}) by bob, [d100000](${REPO_URL}/commit/${sha("d1")}) · ${compare("c1", "d2")}`,
    );
  });

  test("has its files read only when it is in the range of a stack", () => {
    expect(directPushesToRead(walk, [sha("d1")])).toEqual([sha("d2")]);
    expect(directPushesToRead(walk, [sha("d1"), sha("c1")])).toEqual([sha("d2"), sha("d1")]);
    expect(directPushesToRead(walk, [])).toEqual([]);
  });

  test("of a starting commit outside the lookback: every direct push is read", () => {
    expect(directPushesToRead(walk, [sha("gone")])).toEqual([sha("d2"), sha("d1"), sha("c1")]);
  });

  test("a commit whose only pull request went to another branch, or is not merged, is a direct push", () => {
    const other = walkOf(
      commit("e2", ["e1"], {
        pullRequests: [pullRequest(4, "alice", ["apps/grafana/x.ts"], { base: "release" })],
      }),
      commit("e1", ["c1"], {
        pullRequests: [pullRequest(5, "alice", ["apps/grafana/x.ts"], { merged: false })],
      }),
      commit("c1", []),
    );
    expect(directPushesToRead(other, [sha("c1")])).toEqual([sha("e2"), sha("e1")]);
  });

  test("whose files were not read counts as a change outside the stack", () => {
    expect(attribute(walk, "apps/grafana:prod", "c1").lines.full).toBe(
      `from 2 changes outside this stack · ${compare("c1", "d2")}`,
    );
  });

  test("with a file list at GitHub's cap counts as outside too, because files may be missing", () => {
    const many = Array.from({ length: 300 }, (_, index) => `apps/grafana/${index}.ts`);
    const line = attribute(walk, "apps/grafana:prod", "c1", {
      pushFiles: { ...pushFiles, d2: many },
    }).lines.full;
    expect(line).toBe(
      `from [d100000](${REPO_URL}/commit/${sha("d1")}), and 1 change outside this stack · ${compare("c1", "d2")}`,
    );
  });
});

describe("changes outside the stack", () => {
  const lockfile = pullRequest(20, "renovate[bot]", ["bun.lock"]);
  const mixed = pullRequest(21, "alice", ["apps/grafana/a.ts", "package.json"]);
  const shared = pullRequest(22, "carol", ["shared/labels.ts"]);
  const docs = pullRequest(23, "dave", ["docs/readme.md"]);
  const walk = walkOf(
    commit("c5", ["c4"], { pullRequests: [docs] }),
    commit("c4", ["c3"], { pullRequests: [shared] }),
    commit("c3", ["c2"], { pullRequests: [mixed] }),
    commit("c2", ["c1"], { pullRequests: [lockfile] }),
    commit("c1", []),
  );
  const unrelated = ["docs/**"];

  test("a change with a file no stack claims is counted on a row that does not claim it", () => {
    // 20 and 21 hold an unclaimed file. 22 is claimed by this stack through
    // its inputs. 23 is unrelated and counts for nothing.
    expect(attribute(walk, "apps/loki:prod", "c1", { unrelated }).lines.full).toBe(
      `from #22 by carol, and 2 changes outside this stack · ${compare("c1", "c5")}`,
    );
  });

  test("a change the stack claims is named and not counted again", () => {
    expect(attribute(walk, "apps/grafana:prod", "c1", { unrelated }).lines.full).toBe(
      `from #21 by alice, and 1 change outside this stack · ${compare("c1", "c5")}`,
    );
  });

  test("a row pending only through shared changes", () => {
    const only = walkOf(commit("c2", ["c1"], { pullRequests: [lockfile] }), commit("c1", []));
    expect(attribute(only, "apps/grafana:prod", "c1").lines.full).toBe(
      `from 1 change outside this stack · ${compare("c1", "c2")}`,
    );
  });

  test("a pull request with more than 100 changed files is not paged through and counts as outside", () => {
    const files = Array.from({ length: 100 }, (_, index) => `apps/grafana/${index}.ts`);
    const huge = pullRequest(30, "alice", files, { changedFiles: 101 });
    const exact = pullRequest(31, "alice", files);
    const big = walkOf(
      commit("c3", ["c2"], { pullRequests: [exact] }),
      commit("c2", ["c1"], { pullRequests: [huge] }),
      commit("c1", []),
    );
    expect(attribute(big, "apps/grafana:prod", "c1").lines.full).toBe(
      `from #31 by alice, and 1 change outside this stack · ${compare("c1", "c3")}`,
    );
    expect(attribute(big, "apps/loki:prod", "c1").lines.full).toBe(
      `from 1 change outside this stack · ${compare("c1", "c3")}`,
    );
  });
});

describe("the fixed order of the line", () => {
  const seven = Array.from({ length: 7 }, (_, index) =>
    commit(`p${7 - index}`, [index === 6 ? "old" : `p${6 - index}`], {
      pullRequests: [pullRequest(107 - index, "alice", ["apps/grafana/a.ts"])],
    }),
  );
  const walk = walkOf(
    commit("top", ["p7"], { pullRequests: [pullRequest(200, "renovate[bot]", ["bun.lock"])] }),
    ...seven,
  );

  test("five names newest first, then the rest as a count, then outside, then earlier, then the link", () => {
    expect(attribute(walk, "apps/grafana:prod", "gone").lines.full).toBe(
      `from #107 by alice, #106 by alice, #105 by alice, #104 by alice, #103 by alice, and 2 more, and 1 change outside this stack, and earlier changes · ${compare("gone", "top")}`,
    );
  });

  test("at budget level 1 the names become a count and everything else stays", () => {
    expect(attribute(walk, "apps/grafana:prod", "gone").lines.counted).toBe(
      `from 7 pull requests, and 1 change outside this stack, and earlier changes · ${compare("gone", "top")}`,
    );
  });

  test("the count says pull requests and direct pushes apart", () => {
    const pushed = walkOf(commit("d1", ["p7"]), ...seven.slice(0, 1), commit("old", []));
    const lines = attribute(pushed, "apps/grafana:prod", "old", {
      pushFiles: { d1: ["apps/grafana/x.ts"] },
    }).lines;
    expect(lines.counted).toBe(`from 1 pull request and 1 direct push · ${compare("old", "d1")}`);
  });

  test("a starting commit outside the lookback with nothing to name", () => {
    const quiet = walkOf(commit("c2", ["c1"], { pullRequests: [loki2] }));
    expect(attribute(quiet, "apps/grafana:prod", "gone").lines.full).toBe(
      `from earlier changes · ${compare("gone", "c2")}`,
    );
  });
});

describe("a stack with no successful deployment record", () => {
  test("gets no guess: the line says so, lists nothing and has no link", () => {
    const walk = walkOf(commit("c2", ["c1"], { pullRequests: [grafana3] }), commit("c1", []));
    expect(attribute(walk, "apps/grafana:prod", undefined)).toEqual({
      lines: {
        full: "not deployed from this dashboard yet",
        counted: "not deployed from this dashboard yet",
      },
      merges: [],
    });
  });
});

describe("authors", () => {
  test("a login is plain text: no @, and nothing in it acts as markup", () => {
    const walk = walkOf(
      commit("c2", ["c1"], {
        pullRequests: [pullRequest(40, "octo_cat_corp", ["apps/grafana/a.ts"])],
      }),
      commit("c1", []),
    );
    const { full } = attribute(walk, "apps/grafana:prod", "c1").lines;
    expect(full).toBe(`from #40 by octo&#95;cat&#95;corp · ${compare("c1", "c2")}`);
    expect(full).not.toContain("@");
  });

  test("a pull request whose author is gone is named without one", () => {
    const walk = walkOf(
      commit("c2", ["c1"], { pullRequests: [pullRequest(41, undefined, ["apps/grafana/a.ts"])] }),
      commit("c1", []),
    );
    expect(attribute(walk, "apps/grafana:prod", "c1").lines.full).toBe(
      `from #41 · ${compare("c1", "c2")}`,
    );
  });

  test("the author is who opened the pull request, not who made the merge commit", () => {
    const walk = walkOf(
      commit("m", ["c1", "b1"], { author: "merger", pullRequests: [grafana3] }),
      commit("b1", ["c1"], { author: "alice", pullRequests: [grafana3] }),
      commit("c1", []),
    );
    expect(attribute(walk, "apps/grafana:prod", "c1").lines.full).toContain("#3 by alice ·");
  });
});

describe("what the summary gets", () => {
  test("every claimed pull request and direct push in range, newest first and without a cut", () => {
    const commits = Array.from({ length: 8 }, (_, index) =>
      commit(`p${8 - index}`, [`p${7 - index}`], {
        pullRequests: [pullRequest(108 - index, "alice", ["apps/grafana/a.ts"])],
      }),
    );
    const walk = walkOf(commit("d1", ["p8"], { message: "fix the probe" }), ...commits);
    const { merges } = attribute(walk, "apps/grafana:prod", "p0", {
      pushFiles: { d1: ["apps/grafana/x.ts"] },
    });
    expect(merges).toHaveLength(9);
    expect(merges[0]).toEqual({
      kind: "push",
      sha: sha("d1"),
      message: "fix the probe",
      url: `${REPO_URL}/commit/${sha("d1")}`,
      author: "bob",
    });
    expect(merges[1]).toEqual({
      kind: "pull-request",
      number: 108,
      title: "Pull request 108",
      url: `${REPO_URL}/pull/108`,
      author: "alice",
    });
  });
});
