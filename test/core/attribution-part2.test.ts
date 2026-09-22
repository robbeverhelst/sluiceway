import { describe, expect, test } from "bun:test";
import {
  type AttributionInput,
  attributor,
  type CommitWalk,
  directPushesToRead,
  pullRequestsToRead,
  type WalkedCommit,
  type WalkedPullRequest,
} from "../../src/core/attribution.ts";
import type { Claimant } from "../../src/core/claim.ts";

// Attribution part 2 (record 0072): a configurable number of names, the
// changes outside a stack named behind a fold, the old path of a renamed file,
// and what a deploy on the trail shipped.

const REPO_URL = "https://github.com/acme/infra";

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
    renamed: false,
    ...rest,
  };
}

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

function of(walk: CommitWalk, rest: Partial<AttributionInput> = {}) {
  return attributor({
    walk,
    pushFiles: new Map(),
    stacks: STACKS,
    unrelated: [],
    repoUrl: REPO_URL,
    scanSha: walk.commits[0]?.sha ?? sha("none"),
    ...rest,
  });
}

function compare(from: string, to: string): string {
  return `[compare](${REPO_URL}/compare/${sha(from).slice(0, 12)}...${sha(to).slice(0, 12)})`;
}

// Four pull requests to grafana on top of c1.
const four = walkOf(
  ...[4, 3, 2].map((n) =>
    commit(`p${n}`, [`p${n - 1}`], {
      pullRequests: [pullRequest(100 + n, "alice", ["apps/grafana/a.ts"])],
    }),
  ),
  commit("p1", ["c1"], { pullRequests: [pullRequest(101, "alice", ["apps/grafana/a.ts"])] }),
  commit("c1", []),
);

describe("the number of names on a row", () => {
  test("follows attribution.names, and the rest is a count", () => {
    expect(of(four, { names: 2 })("apps/grafana:prod", sha("c1")).lines.full).toBe(
      `from #104 by alice, #103 by alice, and 2 more · ${compare("c1", "p4")}`,
    );
  });

  test("0 names nothing: the row always has the count", () => {
    const { lines } = of(four, { names: 0 })("apps/grafana:prod", sha("c1"));
    expect(lines.full).toBe(`from 4 pull requests · ${compare("c1", "p4")}`);
    expect(lines.full).toBe(lines.counted);
  });

  test("five without the setting", () => {
    expect(of(four)("apps/grafana:prod", sha("c1")).lines.full).toBe(
      `from #104 by alice, #103 by alice, #102 by alice, #101 by alice · ${compare("c1", "p4")}`,
    );
  });
});

describe("changes outside a stack", () => {
  const lockfile = pullRequest(20, "renovate[bot]", ["bun.lock"]);
  const shared = pullRequest(22, "carol", ["packages/shared/labels.ts"]);
  const walk = walkOf(
    commit("d1", ["c3"], { author: undefined }),
    commit("c3", ["c2"], { pullRequests: [shared] }),
    commit("c2", ["c1"], { pullRequests: [lockfile] }),
    commit("c1", []),
  );

  test("are named behind a fold under the line, newest first, as links", () => {
    const { lines } = of(walk, { pushFiles: new Map([[sha("d1"), ["package.json"]]]) })(
      "apps/grafana:prod",
      sha("c1"),
    );
    expect(lines.full).toBe(`from 3 changes outside this stack · ${compare("c1", "d1")}`);
    expect(lines.outside).toEqual([
      "<details><summary>changes outside this stack</summary>",
      `<a href="${REPO_URL}/commit/${sha("d1")}">d100000</a><br>`,
      `<a href="${REPO_URL}/pull/22">#22</a> by carol<br>`,
      `<a href="${REPO_URL}/pull/20">#20</a> by renovate&#91;bot&#93;<br>`,
      "</details>",
    ]);
  });

  test("a row with none has no fold", () => {
    const quiet = walkOf(
      commit("c2", ["c1"], { pullRequests: [pullRequest(3, "alice", ["apps/grafana/a.ts"])] }),
      commit("c1", []),
    );
    expect(of(quiet)("apps/grafana:prod", sha("c1")).lines.outside).toBeUndefined();
  });

  test("the fold names twenty and counts the rest", () => {
    const many = walkOf(
      ...Array.from({ length: 23 }, (_, index) =>
        commit(`b${23 - index}y`, [index === 22 ? "c1" : `b${22 - index}y`], {
          pullRequests: [pullRequest(200 + 23 - index, "renovate[bot]", ["bun.lock"])],
        }),
      ),
      commit("c1", []),
    );
    const outside = of(many)("apps/grafana:prod", sha("c1")).lines.outside ?? [];
    expect(outside).toHaveLength(23);
    expect(outside[1]).toContain("#223");
    expect(outside[20]).toContain("#204");
    expect(outside[21]).toBe("and 3 more<br>");
    expect(outside[22]).toBe("</details>");
  });
});

describe("a renamed file", () => {
  // Pull request 9 moves a file out of grafana into loki. GraphQL gives only
  // the new path, and REST the old one too.
  const moved = pullRequest(9, "alice", ["apps/loki/rules.ts"], { renamed: true });
  const walk = walkOf(commit("c2", ["c1"], { pullRequests: [moved] }), commit("c1", []));

  test("counts under its old path once the pull request's files were read", () => {
    const read = of(walk, {
      pullRequestFiles: new Map([[9, ["apps/loki/rules.ts", "apps/grafana/rules.ts"]]]),
    });
    expect(read("apps/grafana:prod", sha("c1")).lines.full).toBe(
      `from #9 by alice · ${compare("c1", "c2")}`,
    );
    expect(read("apps/loki:prod", sha("c1")).lines.full).toContain("from #9 by alice");
  });

  test("counts under its new path alone when they were not read", () => {
    expect(of(walk)("apps/grafana:prod", sha("c1")).lines.full).toBe(
      `nothing this stack claims has changed since its last deploy · ${compare("c1", "c2")}`,
    );
  });

  test("its pull request is read only when it renamed a file and is in a range", () => {
    const plain = pullRequest(8, "alice", ["apps/loki/a.ts"]);
    const both = walkOf(
      commit("c3", ["c2"], { pullRequests: [plain] }),
      commit("c2", ["c1"], { pullRequests: [moved] }),
      commit("c1", []),
    );
    expect(pullRequestsToRead(both, [sha("c1")])).toEqual([9]);
    expect(pullRequestsToRead(both, [sha("c2")])).toEqual([]);
  });

  test("a pull request over the file cap is not read: it counts as outside already", () => {
    const huge = pullRequest(10, "alice", ["apps/loki/a.ts"], { renamed: true, changedFiles: 101 });
    const big = walkOf(commit("c2", ["c1"], { pullRequests: [huge] }), commit("c1", []));
    expect(pullRequestsToRead(big, [sha("c1")])).toEqual([]);
  });
});

describe("what a deploy shipped", () => {
  // c1 deployed, then 101 and 102 to grafana and the lockfile, c4 deployed,
  // then 104 to grafana, which is the scanned commit.
  const walk = walkOf(
    commit("c5", ["c4"], { pullRequests: [pullRequest(104, "alice", ["apps/grafana/a.ts"])] }),
    commit("c4", ["c3"], { pullRequests: [pullRequest(103, "renovate[bot]", ["bun.lock"])] }),
    commit("c3", ["c2"], { pullRequests: [pullRequest(102, "dave", ["apps/grafana/b.ts"])] }),
    commit("c2", ["c1"], { pullRequests: [pullRequest(101, "carol", ["apps/grafana/c.ts"])] }),
    commit("c1", []),
  );

  test("names the pull requests between the success before it and its own commit", () => {
    expect(of(walk).shipped("apps/grafana:prod", sha("c1"), sha("c4"))).toEqual({
      full: `shipped #102 by dave, #101 by carol, and 1 change outside this stack · ${compare("c1", "c4")}`,
      counted: `shipped 2 pull requests, and 1 change outside this stack · ${compare("c1", "c4")}`,
    });
  });

  test("follows attribution.names", () => {
    expect(of(walk, { names: 1 }).shipped("apps/grafana:prod", sha("c1"), sha("c4"))?.full).toBe(
      `shipped #102 by dave, and 1 more, and 1 change outside this stack · ${compare("c1", "c4")}`,
    );
  });

  test("says earlier changes when the success before it is outside the lookback", () => {
    const read = of(walk, { pushFiles: new Map([[sha("c1"), ["apps/loki/a.ts"]]]) });
    expect(read.shipped("apps/grafana:prod", sha("gone"), sha("c2"))?.full).toBe(
      `shipped #101 by carol, and earlier changes · ${compare("gone", "c2")}`,
    );
  });

  test("says nothing about a commit outside the lookback", () => {
    expect(of(walk).shipped("apps/grafana:prod", sha("c1"), sha("gone"))).toBeUndefined();
  });

  test("says nothing when nothing the stack claims or counts went out", () => {
    expect(of(walk).shipped("apps/loki:prod", sha("c3"), sha("c3"))).toBeUndefined();
  });

  test("its direct pushes are read like a row's", () => {
    const pushed = walkOf(commit("d2", ["d1"]), commit("d1", ["c1"]), commit("c1", []));
    expect(directPushesToRead(pushed, [{ from: sha("c1"), to: sha("d1") }])).toEqual([sha("d1")]);
  });
});
