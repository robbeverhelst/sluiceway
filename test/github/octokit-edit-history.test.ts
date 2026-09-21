import { describe, expect, test } from "bun:test";
import { getOctokit } from "@actions/github";
import { createOctokitPort } from "../../src/github/octokit-port.ts";

// The real Octokit with its fetch swapped for one that answers from a list, as
// in octokit-port.test.ts. The answers have the shape real GitHub gave for the
// query on 2026-09-21: an edited issue of this repo, and one never edited.

interface Answer {
  status?: number;
  json: unknown;
}

function portThatAnswers(answers: Answer[]) {
  const sent: { method: string; path: string; body: { query: string; variables: unknown } }[] = [];
  const fetch = async (url: string, init: { method?: string; body?: string }) => {
    sent.push({
      method: init.method ?? "GET",
      path: new URL(url).pathname,
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const answer = answers.shift();
    if (!answer) throw new Error(`No answer left for ${init.method} ${url}`);
    return new Response(JSON.stringify(answer.json), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  const octokit = getOctokit("a-token", { request: { fetch } });
  return { port: createOctokitPort(octokit, { owner: "acme", repo: "infra" }), sent };
}

function answer(issue: unknown): Answer {
  return { json: { data: { repository: { issue } } } };
}

const FIRST_PAGE = { size: 10, after: undefined };

describe("reading the edit history", () => {
  test("the body and one page of the history come from one GraphQL query", async () => {
    const { port, sent } = portThatAnswers([
      answer({
        body: "ticked",
        userContentEdits: {
          totalCount: 3,
          pageInfo: { hasNextPage: false, endCursor: "Y3Vyc29yOnYyOpHO8igRmg==" },
          nodes: [
            {
              editedAt: "2026-09-21T07:11:52Z",
              deletedAt: null,
              editor: { __typename: "User", login: "robbeverhelst" },
              diff: "ticked",
            },
            {
              editedAt: "2026-09-20T20:18:26Z",
              deletedAt: null,
              editor: { __typename: "Bot", login: "github-actions" },
              diff: "unticked",
            },
            {
              editedAt: "2026-09-20T20:18:24Z",
              deletedAt: null,
              editor: { __typename: "Bot", login: "github-actions" },
              diff: "original",
            },
          ],
        },
      }),
    ]);

    expect(await port.readEditHistory(12, FIRST_PAGE)).toEqual({
      body: "ticked",
      entries: [
        {
          editor: { login: "robbeverhelst", type: "User" },
          editedAt: "2026-09-21T07:11:52Z",
          body: "ticked",
        },
        {
          editor: { login: "github-actions", type: "Bot" },
          editedAt: "2026-09-20T20:18:26Z",
          body: "unticked",
        },
        {
          editor: { login: "github-actions", type: "Bot" },
          editedAt: "2026-09-20T20:18:24Z",
          body: "original",
        },
      ],
      total: 3,
      // GitHub names an end cursor on the last page too. It is no next page.
      next: undefined,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: "POST", path: "/graphql" });
    expect(sent[0]?.body.variables).toEqual({
      owner: "acme",
      repo: "infra",
      number: 12,
      first: 10,
      after: null,
    });
    const query = sent[0]?.body.query.replace(/\s+/g, " ");
    expect(query).toContain("repository(owner: $owner, name: $repo)");
    expect(query).toContain("issue(number: $number)");
    expect(query).toContain("userContentEdits(first: $first, after: $after)");
    expect(query).toContain("nodes { editedAt deletedAt editor { __typename login } diff }");
  });

  test("a page that has one after it names it, and the next read asks for it", async () => {
    const page = (hasNextPage: boolean, endCursor: string) => ({
      body: "b",
      userContentEdits: { totalCount: 25, pageInfo: { hasNextPage, endCursor }, nodes: [] },
    });
    const { port, sent } = portThatAnswers([
      answer(page(true, "cursor-one")),
      answer(page(false, "x")),
    ]);

    const first = await port.readEditHistory(12, { size: 5, after: undefined });
    const second = await port.readEditHistory(12, { size: 5, after: first.next });

    expect(first.next).toBe("cursor-one");
    expect(first.total).toBe(25);
    expect(second.next).toBeUndefined();
    expect(sent[1]?.body.variables).toMatchObject({ first: 5, after: "cursor-one" });
  });

  test("an issue that was never edited has no entries, and an issue without a body has an empty one", async () => {
    const { port } = portThatAnswers([
      answer({
        body: null,
        userContentEdits: {
          totalCount: 0,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      }),
    ]);

    expect(await port.readEditHistory(12, FIRST_PAGE)).toEqual({
      body: "",
      entries: [],
      total: 0,
      next: undefined,
    });
  });

  test("an entry without content, or marked as deleted, has no body", async () => {
    const { port } = portThatAnswers([
      answer({
        body: "b",
        userContentEdits: {
          totalCount: 3,
          pageInfo: { hasNextPage: false, endCursor: "c" },
          nodes: [
            {
              editedAt: "2026-09-21T09:00:00Z",
              deletedAt: null,
              editor: { __typename: "User", login: "alice" },
              diff: null,
            },
            {
              editedAt: "2026-09-21T08:00:00Z",
              deletedAt: "2026-09-21T10:00:00Z",
              editor: { __typename: "User", login: "mallory" },
              diff: "still here",
            },
            {
              editedAt: "2026-09-21T07:00:00Z",
              deletedAt: null,
              editor: { __typename: "User", login: "bob" },
              diff: "kept",
            },
          ],
        },
      }),
    ]);

    const history = await port.readEditHistory(12, FIRST_PAGE);

    expect(history.entries.map((entry) => entry.body)).toEqual([null, null, "kept"]);
    expect(history.entries[1]?.editor).toEqual({ login: "mallory", type: "User" });
  });

  test("an editor GitHub no longer knows is nobody", async () => {
    const { port } = portThatAnswers([
      answer({
        body: "b",
        userContentEdits: {
          totalCount: 2,
          pageInfo: { hasNextPage: false, endCursor: "c" },
          nodes: [
            { editedAt: "2026-09-21T09:00:00Z", deletedAt: null, editor: null, diff: "b" },
            null,
          ],
        },
      }),
    ]);

    const history = await port.readEditHistory(12, FIRST_PAGE);

    expect(history.entries[0]?.editor).toEqual({ login: "", type: "" });
    // The schema lets an entry itself be null. It breaks a stretch like any
    // entry without a body.
    expect(history.entries[1]).toEqual({
      editor: { login: "", type: "" },
      editedAt: "",
      body: null,
    });
  });

  // What a token without `issues: read` gets (issue 28).
  test("a GraphQL error is thrown", async () => {
    const { port } = portThatAnswers([
      {
        json: {
          data: { repository: { issue: null } },
          errors: [
            { type: "NOT_FOUND", message: "Could not resolve to an Issue with the number of 12." },
          ],
        },
      },
    ]);

    await expect(port.readEditHistory(12, FIRST_PAGE)).rejects.toThrow(
      "Could not resolve to an Issue",
    );
  });

  test("an answer without the issue is an error, not an empty history", async () => {
    const { port } = portThatAnswers([answer(null)]);

    await expect(port.readEditHistory(12, FIRST_PAGE)).rejects.toThrow(
      "GitHub gave no issue 12 when the edit history was read.",
    );
  });
});
