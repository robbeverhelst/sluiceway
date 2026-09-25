import { getOctokit } from "@actions/github";

type Octokit = ReturnType<typeof getOctokit>;
type Options = Parameters<typeof getOctokit>[1];

// The version of GitHub's REST API every call is written against (issue 266).
// A request that names none runs under GitHub's default, 2022-11-28, which
// GitHub ends on 10 March 2028, so the action names it itself and a new
// default never moves under a release. Moving it is a change of its own:
// read GitHub's breaking changes for the new version first.
export const API_VERSION = "2026-03-10";

// The one client every mode talks to GitHub through. The version goes on in a
// hook, because Octokit takes no default headers from its options, and the
// hook sees every request: each REST call, each page of a list and each
// GraphQL query.
export function createGitHubClient(token: string, options?: Options): Octokit {
  const octokit = getOctokit(token, options);
  octokit.hook.before("request", (request) => {
    request.headers["x-github-api-version"] = API_VERSION;
  });
  return octokit;
}
