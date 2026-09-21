import type { getOctokit } from "@actions/github";

type Octokit = ReturnType<typeof getOctokit>;

// Counts every request the client sends from now on: each page of a list,
// each GraphQL query and each request GitHub refuses, which is how GitHub
// counts them against the budget of record 0017.
export function countRequests(octokit: Octokit): () => number {
  let count = 0;
  octokit.hook.before("request", () => {
    count++;
  });
  return () => count;
}
