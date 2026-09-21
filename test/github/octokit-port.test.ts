import { describe, expect, test } from "bun:test";
import { getOctokit } from "@actions/github";
import { createOctokitPort } from "../../src/github/octokit-port.ts";

// The real Octokit, with its fetch swapped for one that answers from a list.
// So these tests pin what goes over the wire and how the answers are read,
// and no test knows which Octokit method was called.

interface Sent {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

interface Answer {
  status?: number;
  headers?: Record<string, string>;
  json: unknown;
}

function portThatAnswers(answers: Answer[]) {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: { method?: string; body?: string }) => {
    const parsed = new URL(url);
    sent.push({
      method: init.method ?? "GET",
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const answer = answers.shift();
    if (!answer) throw new Error(`No answer left for ${init.method} ${url}`);
    return new Response(JSON.stringify(answer.json), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json", ...answer.headers },
    });
  };
  const octokit = getOctokit("a-token", { request: { fetch } });
  return { port: createOctokitPort(octokit, { owner: "acme", repo: "infra" }), sent };
}

const BOT_USER = { login: "github-actions[bot]", type: "Bot" };

function apiIssue(over: Record<string, unknown> = {}) {
  return {
    number: 12,
    node_id: "I_kwDOabc",
    state: "open",
    closed_at: null,
    title: "Sluiceway dashboard",
    body: "the body",
    labels: [{ name: "sluiceway" }, "plain-text-label"],
    user: BOT_USER,
    ...over,
  };
}

describe("reading an issue", () => {
  test("an issue comes back in the port's words", async () => {
    const { port, sent } = portThatAnswers([{ json: apiIssue() }]);

    expect(await port.getIssue(12)).toEqual({
      number: 12,
      nodeId: "I_kwDOabc",
      state: "open",
      closedAt: null,
      title: "Sluiceway dashboard",
      body: "the body",
      labels: ["sluiceway", "plain-text-label"],
      author: { login: "github-actions[bot]", type: "Bot" },
    });
    expect(sent).toEqual([
      { method: "GET", path: "/repos/acme/infra/issues/12", query: {}, body: undefined },
    ]);
  });

  test("no body is an empty body, and a closed issue keeps its time", async () => {
    const { port } = portThatAnswers([
      { json: apiIssue({ body: null, state: "closed", closed_at: "2026-09-20T06:00:12Z" }) },
    ]);

    expect(await port.getIssue(12)).toMatchObject({
      body: "",
      state: "closed",
      closedAt: "2026-09-20T06:00:12Z",
    });
  });

  test("an author GitHub no longer knows is nobody, so never the bot", async () => {
    const { port } = portThatAnswers([{ json: apiIssue({ user: null }) }]);

    expect((await port.getIssue(12)).author).toEqual({ login: "", type: "" });
  });
});

describe("listing issues", () => {
  test("asks for the label and the state in pages of 100, and leaves pull requests out", async () => {
    const { port, sent } = portThatAnswers([
      { json: [apiIssue({ number: 9 }), apiIssue({ number: 4, pull_request: { url: "x" } })] },
    ]);

    const issues = await port.listIssues({ label: "sluiceway", state: "closed" });

    expect(issues.map((issue) => issue.number)).toEqual([9]);
    expect(sent).toEqual([
      {
        method: "GET",
        path: "/repos/acme/infra/issues",
        query: {
          labels: "sluiceway",
          state: "closed",
          sort: "created",
          direction: "asc",
          per_page: "100",
        },
        body: undefined,
      },
    ]);
  });

  test("follows every page", async () => {
    const next =
      '<https://api.github.com/repos/acme/infra/issues?labels=sluiceway&state=open&page=2>; rel="next"';
    const { port, sent } = portThatAnswers([
      { json: [apiIssue({ number: 1 })], headers: { link: next } },
      { json: [apiIssue({ number: 2 })] },
    ]);

    const issues = await port.listIssues({ label: "sluiceway", state: "open" });

    expect(issues.map((issue) => issue.number)).toEqual([1, 2]);
    expect(sent).toHaveLength(2);
  });
});

describe("writing", () => {
  test("a create sends the title, the body and the label", async () => {
    const { port, sent } = portThatAnswers([{ status: 201, json: apiIssue({ number: 13 }) }]);

    const issue = await port.createIssue({ title: "T", body: "B", labels: ["sluiceway"] });

    expect(issue.number).toBe(13);
    expect(sent).toEqual([
      {
        method: "POST",
        path: "/repos/acme/infra/issues",
        query: {},
        body: { title: "T", body: "B", labels: ["sluiceway"] },
      },
    ]);
  });

  test("a refused create is an error with GitHub's status", async () => {
    const { port } = portThatAnswers([
      {
        status: 422,
        json: { message: "Validation Failed: body is too long (maximum is 65536 characters)" },
      },
    ]);

    const refused = port.createIssue({ title: "T", body: "B", labels: [] });

    await expect(refused).rejects.toMatchObject({ status: 422 });
  });

  test("a body update sends only the body, and gives back GitHub's answer as it is", async () => {
    const { port, sent } = portThatAnswers([{ json: apiIssue({ body: "echoed" }) }]);

    const answer = await port.updateIssueBody(12, "new body");

    expect(answer.body).toBe("echoed");
    expect(sent).toEqual([
      {
        method: "PATCH",
        path: "/repos/acme/infra/issues/12",
        query: {},
        body: { body: "new body" },
      },
    ]);
  });

  test("closing says not planned, and reopening opens", async () => {
    const { port, sent } = portThatAnswers([{ json: apiIssue() }, { json: apiIssue() }]);

    await port.closeIssue(12);
    await port.reopenIssue(12);

    expect(sent.map((request) => request.body)).toEqual([
      { state: "closed", state_reason: "not_planned" },
      { state: "open" },
    ]);
  });

  test("a comment goes to the issue", async () => {
    const { port, sent } = portThatAnswers([{ status: 201, json: { id: 1 } }]);

    await port.createComment(12, "hello");

    expect(sent).toEqual([
      {
        method: "POST",
        path: "/repos/acme/infra/issues/12/comments",
        query: {},
        body: { body: "hello" },
      },
    ]);
  });
});

describe("pinning", () => {
  test("is the GraphQL pinIssue mutation with the node id", async () => {
    const { port, sent } = portThatAnswers([
      { json: { data: { pinIssue: { issue: { id: "I_kwDOabc" } } } } },
    ]);

    await port.pinIssue("I_kwDOabc");

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: "POST", path: "/graphql" });
    expect(sent[0]?.body).toMatchObject({
      variables: { issueId: "I_kwDOabc" },
      query: expect.stringContaining("pinIssue(input: {issueId: $issueId})"),
    });
  });

  test("a GraphQL error is thrown, so the caller can decide that a pin is best effort", async () => {
    const { port } = portThatAnswers([
      { json: { data: null, errors: [{ message: "Maximum 3 pinned issues per repository" }] } },
    ]);

    await expect(port.pinIssue("I_kwDOabc")).rejects.toThrow("Maximum 3 pinned issues");
  });
});

describe("comparing two commits", () => {
  const BASE = "1111111111111111111111111111111111111111";
  const HEAD = "2222222222222222222222222222222222222222";

  test("one request, with the files of the whole comparison and a single commit", async () => {
    const { port, sent } = portThatAnswers([
      {
        json: {
          status: "ahead",
          commits: [{ sha: HEAD }],
          files: [
            { filename: "apps/loki/index.ts", status: "modified" },
            {
              filename: "apps/loki/new.ts",
              status: "renamed",
              previous_filename: "apps/grafana/old.ts",
            },
            { filename: "gone.txt", status: "removed" },
          ],
        },
      },
    ]);

    expect(await port.compareCommits(BASE, HEAD)).toEqual({
      status: "ahead",
      files: [
        { path: "apps/loki/index.ts" },
        { path: "apps/loki/new.ts", previousPath: "apps/grafana/old.ts" },
        { path: "gone.txt" },
      ],
    });
    // GitHub gives every file, up to its cap of 300, on the first page
    // whatever the page size, which only counts commits. Sluiceway reads no
    // commit here, so it asks for one.
    expect(sent).toEqual([
      {
        method: "GET",
        path: `/repos/acme/infra/compare/${BASE}...${HEAD}`,
        query: { per_page: "1" },
        body: undefined,
      },
    ]);
  });

  test("a comparison without a file list has no files", async () => {
    const { port } = portThatAnswers([{ json: { status: "identical", commits: [] } }]);
    expect(await port.compareCommits(HEAD, HEAD)).toEqual({ status: "identical", files: [] });
  });

  test("a commit GitHub no longer has is an error, as after a force push", async () => {
    const { port } = portThatAnswers([{ status: 404, json: { message: "Not Found" } }]);
    await expect(port.compareCommits(BASE, HEAD)).rejects.toThrow("Not Found");
  });
});

describe("looking up a person's permission", () => {
  // The answers are the ones the real endpoint gave on 2026-09-21, cut down to
  // what is read and what could be mistaken for it.
  function answer(permission: string, permissions: Record<string, boolean>) {
    return {
      permission,
      role_name: permission,
      user: { login: "alice", type: "User", permissions, role_name: permission },
    };
  }

  test("one request, and the three booleans come back", async () => {
    const { port, sent } = portThatAnswers([
      {
        json: answer("admin", {
          admin: true,
          maintain: true,
          push: true,
          triage: true,
          pull: true,
        }),
      },
    ]);

    expect(await port.getPermission("alice")).toEqual({ push: true, maintain: true, admin: true });
    expect(sent).toEqual([
      {
        method: "GET",
        path: "/repos/acme/infra/collaborators/alice/permission",
        query: {},
        body: undefined,
      },
    ]);
  });

  test("someone who is not a collaborator is a clean answer with no access", async () => {
    // A public repo says "read" and a private one "none". Both come with 200.
    const { port } = portThatAnswers([
      {
        json: answer("read", {
          admin: false,
          maintain: false,
          push: false,
          triage: false,
          pull: true,
        }),
      },
    ]);
    expect(await port.getPermission("alice")).toEqual({
      push: false,
      maintain: false,
      admin: false,
    });
  });

  test("the level is read from the booleans, never from the role name", async () => {
    // A custom organization role has a name of its own.
    const { port } = portThatAnswers([
      {
        json: answer("deployer", {
          admin: false,
          maintain: true,
          push: true,
          triage: true,
          pull: true,
        }),
      },
    ]);
    expect(await port.getPermission("alice")).toEqual({ push: true, maintain: true, admin: false });
  });

  test("an answer without the booleans is an error, not a guess", async () => {
    const { port } = portThatAnswers([{ json: { permission: "admin", user: null } }]);
    await expect(port.getPermission("alice")).rejects.toThrow(
      "GitHub's answer holds no permissions for alice",
    );
  });

  test("a boolean that is missing counts as false", async () => {
    const { port } = portThatAnswers([{ json: answer("write", { push: true, pull: true }) }]);
    expect(await port.getPermission("alice")).toEqual({
      push: true,
      maintain: false,
      admin: false,
    });
  });

  test("a login GitHub does not know is an error", async () => {
    const { port } = portThatAnswers([
      { status: 404, json: { message: "nobody-here is not a user" } },
    ]);
    await expect(port.getPermission("nobody-here")).rejects.toThrow("is not a user");
  });
});
