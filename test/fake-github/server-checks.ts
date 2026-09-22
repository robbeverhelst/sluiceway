import type { CheckRun, CheckRunOutput } from "../../src/github/port.ts";
import type { FakeGitHub } from "./fake-github.ts";
import type { Route } from "./server.ts";

// The check run calls of the preview pages (record 0050) on the fake GitHub
// server, in GitHub's form.

function apiCheckRun(run: CheckRun): unknown {
  return { id: run.id, name: run.name, html_url: run.htmlUrl, status: "completed" };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function output(value: unknown): CheckRunOutput {
  const { title, summary, text: body } = (value ?? {}) as Record<string, unknown>;
  return { title: text(title), summary: text(summary), text: text(body) };
}

function wholeNumber(value: string | null, fallback: number): number {
  return value !== null && /^[1-9]\d*$/.test(value) ? Number(value) : fallback;
}

export function checkRoutes(
  fake: FakeGitHub,
  repo: string,
  baseUrl: () => string,
): [string, RegExp, Route][] {
  return [
    [
      "GET",
      new RegExp(`^${repo}/commits/([^/]+)/check-runs$`),
      async ({ path, query }, sha = "") => {
        // The fake keeps no older run of a name apart from the list, so a
        // reader that asks for every run would get the wrong answer.
        if (query.get("filter") !== "latest") {
          return { status: 400, json: { message: "The fake lists only filter=latest" } };
        }
        const perPage = Math.min(wholeNumber(query.get("per_page"), 30), 100);
        const page = wholeNumber(query.get("page"), 1);
        const found = await fake.listCheckRunsPage(sha, page, perPage);
        const headers: Record<string, string> = {};
        if (found.more) {
          const next = new URLSearchParams(query);
          next.set("page", String(page + 1));
          headers.link = `<${baseUrl()}${path}?${next}>; rel="next"`;
        }
        return {
          status: 200,
          json: { total_count: found.runs.length, check_runs: found.runs.map(apiCheckRun) },
          headers,
        };
      },
    ],
    [
      "POST",
      new RegExp(`^${repo}/check-runs$`),
      async ({ body }) => {
        // The port always sends a finished, neutral run.
        if (body.status !== "completed" || body.conclusion !== "neutral") {
          return { status: 422, json: { message: "The fake only creates finished, neutral runs" } };
        }
        const run = await fake.createCheckRun({
          sha: text(body.head_sha),
          name: text(body.name),
          output: output(body.output),
        });
        return { status: 201, json: apiCheckRun(run) };
      },
    ],
    [
      "PATCH",
      new RegExp(`^${repo}/check-runs/(\\d+)$`),
      async ({ body }, id) => ({
        status: 200,
        json: apiCheckRun(await fake.updateCheckRun(Number(id), output(body.output))),
      }),
    ],
  ];
}
