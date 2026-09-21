import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Issue } from "../../src/github/port.ts";
import { type FakeGitHub, FakeGitHubError } from "./fake-github.ts";
import { deploymentRoutes, deploymentsQuery, isDeploymentsQuery } from "./server-deployments.ts";

// A small HTTP server around the fake, for the e2e workflow (build plan,
// section 5). It speaks the part of GitHub's REST API that the Octokit port
// sends, and answers from the fake, so the committed bundle can run a whole
// scan with no GitHub on the other end. It listens on this machine only.

export interface FakeGitHubServer {
  // What GITHUB_API_URL is set to.
  url: string;
  close(): Promise<void>;
}

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
}

export interface Answer {
  status: number;
  json?: unknown;
  headers?: Record<string, string>;
}

export type Route = (call: Call, ...parts: string[]) => Promise<Answer>;

// GitHub's form of an issue, with the fields the port reads.
function apiIssue(issue: Issue): unknown {
  return {
    number: issue.number,
    node_id: issue.nodeId,
    state: issue.state,
    closed_at: issue.closedAt,
    title: issue.title,
    body: issue.body,
    labels: issue.labels.map((name) => ({ name })),
    user: issue.author,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const REPO = "/repos/[^/]+/[^/]+";

function wholeNumber(value: string | null, fallback: number): number {
  return value !== null && /^[1-9]\d*$/.test(value) ? Number(value) : fallback;
}

function routes(fake: FakeGitHub, baseUrl: () => string): [string, RegExp, Route][] {
  return [
    [
      "GET",
      new RegExp(`^${REPO}/issues$`),
      async ({ path, query }) => {
        const state = query.get("state") === "closed" ? "closed" : "open";
        const perPage = Math.min(wholeNumber(query.get("per_page"), 30), 100);
        const page = wholeNumber(query.get("page"), 1);
        const found = await fake.listIssuesPage(
          { label: query.get("labels") ?? "", state },
          page,
          perPage,
        );
        // Pages the way GitHub does: the next page is named in a Link header,
        // and a list without one has ended.
        const headers: Record<string, string> = {};
        if (found.more) {
          const next = new URLSearchParams(query);
          next.set("page", String(page + 1));
          headers.link = `<${baseUrl()}${path}?${next}>; rel="next"`;
        }
        return { status: 200, json: found.issues.map(apiIssue), headers };
      },
    ],
    [
      "GET",
      new RegExp(`^${REPO}/issues/(\\d+)$`),
      async (_call, number) => ({
        status: 200,
        json: apiIssue(await fake.getIssue(Number(number))),
      }),
    ],
    [
      "POST",
      new RegExp(`^${REPO}/issues$`),
      async ({ body }) => {
        const labels = Array.isArray(body.labels) ? body.labels.map(text) : [];
        const created = await fake.createIssue({
          title: text(body.title),
          body: text(body.body),
          labels,
        });
        return { status: 201, json: apiIssue(created) };
      },
    ],
    [
      "PATCH",
      new RegExp(`^${REPO}/issues/(\\d+)$`),
      async ({ body }, number) => {
        // The port sends a body, or a state, never both.
        if (typeof body.body === "string") {
          return {
            status: 200,
            json: apiIssue(await fake.updateIssueBody(Number(number), body.body)),
          };
        }
        if (body.state === "closed") await fake.closeIssue(Number(number));
        else if (body.state === "open") await fake.reopenIssue(Number(number));
        else
          throw new FakeGitHubError(422, "The fake GitHub server only updates a body or a state");
        return { status: 200, json: apiIssue(fake.issue(Number(number))) };
      },
    ],
    [
      "POST",
      new RegExp(`^${REPO}/issues/(\\d+)/comments$`),
      async ({ body }, number) => {
        await fake.createComment(Number(number), text(body.body));
        return { status: 201, json: { body: text(body.body) } };
      },
    ],
    [
      "GET",
      new RegExp(`^${REPO}/compare/(.+)$`),
      async (_call, basehead) => {
        const [base = "", head = ""] = basehead.split("...");
        const comparison = await fake.compareCommits(base, head);
        return {
          status: 200,
          json: {
            status: comparison.status,
            files: comparison.files.map((file) => ({
              filename: file.path,
              ...(file.previousPath === undefined ? {} : { previous_filename: file.previousPath }),
            })),
          },
        };
      },
    ],
    ...deploymentRoutes(fake, REPO),
    [
      "GET",
      new RegExp(`^${REPO}/collaborators/([^/]+)/permission$`),
      async (_call, login) => {
        const permission = await fake.getPermission(login);
        return {
          status: 200,
          json: {
            user: {
              login,
              permissions: { ...permission, triage: permission.push, pull: true },
            },
          },
        };
      },
    ],
    [
      "POST",
      /^\/graphql$/,
      async ({ body }) => {
        if (isDeploymentsQuery(text(body.query))) return deploymentsQuery(fake, body.variables);
        // The GraphQL calls of the port. GraphQL answers 200 and puts what
        // went wrong in the answer.
        const variables = body.variables as { issueId?: unknown } | undefined;
        if (text(body.query).includes("userContentEdits("))
          return editHistory(fake, body.variables);
        if (!text(body.query).includes("pinIssue(")) {
          return {
            status: 200,
            json: { errors: [{ message: "The fake GitHub server only pins" }] },
          };
        }
        try {
          await fake.pinIssue(text(variables?.issueId));
          return {
            status: 200,
            json: { data: { pinIssue: { issue: { id: variables?.issueId } } } },
          };
        } catch (error) {
          if (!(error instanceof FakeGitHubError)) throw error;
          return { status: 200, json: { errors: [{ message: error.message }] } };
        }
      },
    ],
  ];
}

// The body and one page of the edit history, in GitHub's form. The cursor is
// the fake's own `next`.
async function editHistory(fake: FakeGitHub, variables: unknown): Promise<Answer> {
  const { number, first, after } = (variables ?? {}) as Record<string, unknown>;
  try {
    const history = await fake.readEditHistory(Number(number), {
      size: Number(first),
      after: typeof after === "string" ? after : undefined,
    });
    const issue = {
      body: history.body,
      userContentEdits: {
        totalCount: history.total,
        pageInfo: { hasNextPage: history.next !== undefined, endCursor: history.next ?? null },
        nodes: history.entries.map((entry) => ({
          editedAt: entry.editedAt,
          // GitHub's docs say the content of a deleted entry goes. The time of
          // the deletion is not something the fake keeps.
          deletedAt: entry.body === null ? entry.editedAt : null,
          editor: { __typename: entry.editor.type, login: entry.editor.login },
          diff: entry.body,
        })),
      },
    };
    return { status: 200, json: { data: { repository: { issue } } } };
  } catch (error) {
    if (!(error instanceof FakeGitHubError)) throw error;
    return { status: 200, json: { errors: [{ message: error.message }] } };
  }
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return {};
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

function send(response: ServerResponse, answer: Answer): void {
  if (answer.json === undefined) {
    response.writeHead(answer.status).end();
    return;
  }
  response
    .writeHead(answer.status, {
      "content-type": "application/json; charset=utf-8",
      ...answer.headers,
    })
    .end(JSON.stringify(answer.json));
}

export async function startFakeGitHubServer(fake: FakeGitHub): Promise<FakeGitHubServer> {
  let url = "";
  const table = routes(fake, () => url);
  const server = createServer(async (request, response) => {
    try {
      const target = new URL(request.url ?? "/", "http://fake");
      const method = request.method ?? "GET";
      for (const [verb, pattern, route] of table) {
        const match = verb === method ? pattern.exec(target.pathname) : null;
        if (!match) continue;
        const call = {
          method,
          path: target.pathname,
          query: target.searchParams,
          body: await readBody(request),
        };
        send(response, await route(call, ...match.slice(1).map(decodeURIComponent)));
        return;
      }
      // A call the port does not make. The scan fails on it, loudly.
      send(response, {
        status: 404,
        json: { message: `The fake GitHub server has no ${method} ${target.pathname}` },
      });
    } catch (error) {
      const status = error instanceof FakeGitHubError ? error.status : 500;
      send(response, {
        status,
        json: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  url = `http://127.0.0.1:${port}`;
  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
