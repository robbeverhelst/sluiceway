import { describe, expect, test } from "bun:test";
import type { Editor, Permission, TickTarget } from "../../src/core/tick-rule.ts";
import { commentOnRefusedTicks, judgeTicks, type Tick } from "../../src/github/ticks.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";

const WRITE: Permission = { push: true, maintain: false, admin: false };
const ADMIN: Permission = { push: true, maintain: true, admin: true };

function person(login: string): Editor {
  return { login, type: "User" };
}

function stack(stackId: string, rule: Extract<TickTarget, { kind: "stack" }>["rule"]): TickTarget {
  return { kind: "stack", stackId, rule };
}

// A repo with a dashboard, an admin and a collaborator with write access.
function repo() {
  const github = new FakeGitHub();
  const dashboard = github.seedIssue({ labels: ["sluiceway"] }).number;
  github.seedPermission("olivia", ADMIN);
  github.seedPermission("will", WRITE);
  return { github, dashboard };
}

// What a `resolve` run does with its ticks: judge them, then tell the people.
async function handle(github: FakeGitHub, dashboard: number, ticks: Tick[]) {
  const outcomes = await judgeTicks(github, ticks);
  await commentOnRefusedTicks(github, dashboard, outcomes);
  return outcomes.map(({ outcome }) => outcome);
}

describe("a tick by a person the rule allows", () => {
  test("is allowed after one live lookup, and nobody is told anything", async () => {
    const { github, dashboard } = repo();

    expect(
      await handle(github, dashboard, [
        { target: stack("network:prod", "admin"), editor: person("olivia") },
      ]),
    ).toEqual(["allowed"]);
    expect(github.requests).toEqual(["getPermission"]);
    expect(github.comments(dashboard)).toEqual([]);
  });

  test("nothing is cached: access that was removed fails at the next tick", async () => {
    const { github, dashboard } = repo();
    const tick = { target: stack("network:prod", "write"), editor: person("will") };
    expect(await handle(github, dashboard, [tick])).toEqual(["allowed"]);

    github.seedPermission("will", { push: false, maintain: false, admin: false });

    expect(await handle(github, dashboard, [tick])).toEqual(["refused"]);
  });
});

describe("a refused tick", () => {
  test("gets one comment that mentions the ticker, names the stack and states the rule", async () => {
    const { github, dashboard } = repo();

    const outcomes = await judgeTicks(github, [
      { target: stack("network:prod", "admin"), editor: person("will") },
    ]);
    await commentOnRefusedTicks(github, dashboard, outcomes);

    expect(outcomes).toMatchObject([{ outcome: "refused", reason: "below-level" }]);
    expect(github.comments(dashboard)).toEqual([
      "@will ticked **network:prod**. The tick was refused: the tick rule of this stack is `admin`, which takes admin access to this repository. Nothing was started and the box is cleared.",
    ]);
  });

  test("a list does not widen: a named person who is not a collaborator is refused", async () => {
    const { github, dashboard } = repo();

    const outcomes = await judgeTicks(github, [
      { target: stack("network:prod", ["stranger"]), editor: person("stranger") },
    ]);
    await commentOnRefusedTicks(github, dashboard, outcomes);

    expect(outcomes).toMatchObject([{ outcome: "refused", reason: "no-write-access" }]);
    expect(github.comments(dashboard)[0]).toContain("ticking needs write access");
  });

  test("the rescan box needs write access and no more", async () => {
    const { github, dashboard } = repo();

    expect(
      await handle(github, dashboard, [
        { target: { kind: "rescan" }, editor: person("will") },
        { target: { kind: "rescan" }, editor: person("stranger") },
      ]),
    ).toEqual(["allowed", "refused"]);
    expect(github.comments(dashboard)).toEqual([
      "@stranger ticked the rescan box. The tick was refused: ticking needs write access to this repository. Nothing was started and the box is cleared.",
    ]);
  });
});

describe("several ticks in one run", () => {
  test("each is judged on its own, and the refused ones share one comment", async () => {
    const { github, dashboard } = repo();

    expect(
      await handle(github, dashboard, [
        { target: stack("app:prod", "write"), editor: person("will") },
        { target: stack("network:prod", "admin"), editor: person("will") },
        { target: stack("site", ["olivia"]), editor: person("will") },
        { target: stack("network:dev", "admin"), editor: person("olivia") },
      ]),
    ).toEqual(["allowed", "refused", "refused", "allowed"]);
    expect(github.comments(dashboard)).toEqual([
      [
        "Nothing was started for these ticks and their boxes are cleared.",
        "",
        "- @will ticked **network:prod**. The tick was refused: the tick rule of this stack is `admin`, which takes admin access to this repository.",
        "- @will ticked **site**. The tick was refused: the tick rule of this stack names who can tick it: olivia.",
      ].join("\n"),
    ]);
  });

  test("a person is looked up once per run, in whatever case the login comes", async () => {
    const { github, dashboard } = repo();

    await handle(github, dashboard, [
      { target: stack("app:prod", "write"), editor: person("will") },
      { target: stack("site", "write"), editor: person("Will") },
      { target: stack("network:dev", "admin"), editor: person("olivia") },
    ]);

    expect(github.requests).toEqual(["getPermission", "getPermission"]);
  });
});

describe("a tick by a bot or by ghost", () => {
  test("is not judged: no lookup, no comment", async () => {
    const { github, dashboard } = repo();
    // Even a bot that GitHub would call an admin.
    github.seedPermission("github-actions[bot]", ADMIN);
    github.seedPermission("ghost", ADMIN);

    expect(
      await handle(github, dashboard, [
        {
          target: stack("network:prod", "write"),
          editor: { login: "github-actions[bot]", type: "Bot" },
        },
        { target: stack("app:prod", "write"), editor: person("ghost") },
        { target: { kind: "rescan" }, editor: { login: "renovate[bot]", type: "Bot" } },
      ]),
    ).toEqual(["not-a-person", "not-a-person", "not-a-person"]);
    expect(github.requests).toEqual([]);
    expect(github.comments(dashboard)).toEqual([]);
  });
});

describe("a lookup that fails", () => {
  test("fails closed: the tick is unverified, the comment asks for a fresh tick, the error is kept", async () => {
    const { github, dashboard } = repo();
    github.failPermissionLookup("olivia", 502);

    const outcomes = await judgeTicks(github, [
      { target: stack("network:prod", "admin"), editor: person("olivia") },
    ]);
    await commentOnRefusedTicks(github, dashboard, outcomes);

    expect(outcomes).toMatchObject([{ outcome: "unverified", error: { status: 502 } }]);
    expect(github.comments(dashboard)).toEqual([
      "@olivia ticked **network:prod**. The tick could not be verified, because the permission lookup failed. Tick the box again for a fresh try. Nothing was started and the box is cleared.",
    ]);
  });

  test("stops nobody else: the other tickers are still judged, and it is not tried twice", async () => {
    const { github, dashboard } = repo();
    github.failPermissionLookup("olivia");

    expect(
      await handle(github, dashboard, [
        { target: stack("network:prod", "admin"), editor: person("olivia") },
        { target: stack("network:dev", "admin"), editor: person("olivia") },
        { target: stack("app:prod", "write"), editor: person("will") },
      ]),
    ).toEqual(["unverified", "unverified", "allowed"]);
    expect(github.requests).toEqual(["getPermission", "getPermission", "createComment"]);
  });
});

describe("the comment", () => {
  test("is not written when nothing was refused, and says whether it was", async () => {
    const { github, dashboard } = repo();
    const allowed = await judgeTicks(github, [
      { target: stack("app:prod", "write"), editor: person("will") },
    ]);
    const refused = await judgeTicks(github, [
      { target: stack("app:prod", "admin"), editor: person("will") },
    ]);

    expect(await commentOnRefusedTicks(github, dashboard, allowed)).toBe(false);
    expect(await commentOnRefusedTicks(github, dashboard, [])).toBe(false);
    expect(await commentOnRefusedTicks(github, dashboard, refused)).toBe(true);
    expect(github.comments(dashboard)).toHaveLength(1);
  });
});
