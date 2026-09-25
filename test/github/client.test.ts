import { describe, expect, test } from "bun:test";
import { API_VERSION, createGitHubClient } from "../../src/github/client.ts";

// Every call names the REST API version it was written against (issue 266).
// A request without one runs under GitHub's default, 2022-11-28, which
// GitHub ends on 10 March 2028, and a default that moves would move under a
// release.

function clientThatRemembers() {
  const versions: (string | null)[] = [];
  const fetch = async (_url: string, init: { headers?: Record<string, string> }) => {
    versions.push(new Headers(init.headers).get("x-github-api-version"));
    return new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { octokit: createGitHubClient("a-token", { request: { fetch } }), versions };
}

describe("the GitHub client", () => {
  test("pins the API version 2026-03-10", () => {
    expect(API_VERSION).toBe("2026-03-10");
  });

  test("names it on a REST call", async () => {
    const { octokit, versions } = clientThatRemembers();
    await octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}", {
      owner: "acme",
      repo: "infra",
      issue_number: 1,
    });
    expect(versions).toEqual(["2026-03-10"]);
  });

  test("names it on a GraphQL query", async () => {
    const { octokit, versions } = clientThatRemembers();
    await octokit.graphql("query { viewer { login } }");
    expect(versions).toEqual(["2026-03-10"]);
  });

  test("names it on every page of a list", async () => {
    const { octokit, versions } = clientThatRemembers();
    await octokit.paginate("GET /repos/{owner}/{repo}/issues", { owner: "acme", repo: "infra" });
    expect(versions).toEqual(["2026-03-10"]);
  });
});
