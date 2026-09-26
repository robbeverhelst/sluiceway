import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../docs/docs.ts";

// An in-memory app for the command line's tests (slice 5.53). It answers
// /api/v1 as the app does, and holds every answer it gives to the schema the
// app's own OpenAPI document names for it, a copy of which is committed at
// test/fixtures/app/openapi.json. So a fake that drifts from the app's
// contract fails the test that uses it, not a person's terminal.

type Schema = Record<string, unknown>;
type Json = unknown;

export const OPENAPI = JSON.parse(
  readFileSync(join(ROOT, "test/fixtures/app/openapi.json"), "utf8"),
) as {
  info: { version: string };
  paths: Record<string, Record<string, { responses: Record<string, Schema> }>>;
  components: { schemas: Record<string, Schema> };
};

// The parts of JSON Schema the document uses: type, enum, anyOf, items,
// properties, required, additionalProperties and $ref.
export function problems(value: Json, schema: Schema, at = "$"): string[] {
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace("#/components/schemas/", "");
    const target = OPENAPI.components.schemas[name];
    if (target === undefined) return [`${at}: no schema ${name}`];
    return problems(value, target, at);
  }
  if (Array.isArray(schema.anyOf)) {
    const each = (schema.anyOf as Schema[]).map((one) => problems(value, one, at));
    return each.some((found) => found.length === 0) ? [] : [`${at}: matches no anyOf`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return [`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`];
  }
  switch (schema.type) {
    case "string":
      return typeof value === "string" ? [] : [`${at}: not a string`];
    case "integer":
      return Number.isInteger(value) ? [] : [`${at}: not an integer`];
    case "boolean":
      return typeof value === "boolean" ? [] : [`${at}: not a boolean`];
    case "null":
      return value === null ? [] : [`${at}: not null`];
    case "array":
      if (!Array.isArray(value)) return [`${at}: not a list`];
      return value.flatMap((item, index) =>
        problems(item, schema.items as Schema, `${at}[${index}]`),
      );
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return [`${at}: not an object`];
      }
      const record = value as Record<string, Json>;
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      const found: string[] = [];
      for (const key of (schema.required ?? []) as string[]) {
        if (!(key in record)) found.push(`${at}.${key}: missing`);
      }
      for (const [key, item] of Object.entries(record)) {
        const property = properties[key];
        if (property !== undefined) found.push(...problems(item, property, `${at}.${key}`));
        else if (schema.additionalProperties === false)
          found.push(`${at}.${key}: not in the schema`);
      }
      return found;
    }
    default:
      return [];
  }
}

// The schema of one answer of one route, from the document.
function answerSchema(route: string, method: string, status: number): Schema {
  const answer = OPENAPI.paths[route]?.[method]?.responses[String(status)] as
    | { content?: { "application/json"?: { schema?: Schema } } }
    | undefined;
  const schema = answer?.content?.["application/json"]?.schema;
  if (schema === undefined)
    throw new Error(`The app never answers ${method} ${route} with ${status}.`);
  return schema;
}

export const TOKEN = "sluiceway_K7nQ2vX9pL4mR8sT1wY6zA3bC5dE0fG2hJ4kM6nP8qR";

export interface FakeStack {
  line: Record<string, Json>;
  row: Record<string, Json>;
  // What a tick of it comes to.
  tick?: { outcome: string; sentence: string; deployment?: number };
}

export interface Call {
  method: string;
  url: string;
  authorization: string | null;
  userAgent: string | null;
  body: Json;
}

export interface FakeApp {
  origin: string;
  calls: Call[];
  fetch: typeof fetch;
  // Set by a test to change what the app says.
  state: {
    tokens: Map<string, { login: string; org: string; name: string; expiresAt: string }>;
    // An error every request gets, as the app says it.
    failWith?: { status: number; error: string; code: string; retryAfter?: string };
    org: Record<string, Json>;
    repos: Record<string, Record<string, Json>>;
    stacks: Record<string, FakeStack>;
    // Each poll of a deployment takes the next answer; the last one stays.
    deployments: Record<number, (Record<string, Json> | "not-yet")[]>;
    rescan: Record<string, Json>;
    config: Record<string, Json>;
    pullRequest: { status: number; body: Record<string, Json> };
  };
}

const COUNTS = { pending: 0, deploying: 0, drifted: 0, failed: 0, "in-sync": 0 };

export function stackLine(
  stack: string,
  state: string,
  word: string,
  extra: Record<string, Json> = {},
) {
  return { stack, repo: "acme/infra", state, word, destroys: false, line: "", at: null, ...extra };
}

export function fakeApp(origin = "https://console.sluiceway.dev"): FakeApp {
  const calls: Call[] = [];
  const repoLine = {
    name: "acme/infra",
    page: `${origin}/acme/infra`,
    dashboard: "https://github.com/acme/infra/issues/7",
    stacks: 4,
    counts: { ...COUNTS, pending: 2, deploying: 1, "in-sync": 1 },
    recordWriter: null,
  };
  const lines = [
    stackLine("site:prod", "in-sync", "in sync"),
    stackLine("network:prod", "pending", "pending", { line: "1 update · from #12 by alice" }),
    stackLine("apps/api:prod", "pending", "pending", {
      destroys: true,
      line: "1 update, 1 replace · from #14 by bob",
    }),
    stackLine("db:prod", "deploying", "queued", { line: "ticked by carol" }),
  ];
  const row = (stack: string, extra: Record<string, Json> = {}) => ({
    stack,
    repo: "acme/infra",
    state: "pending",
    word: "pending",
    line: "1 update · from #12 by alice",
    counts: { creates: 0, updates: 1, replaces: 0, deletes: 0, tracking: 0, changed: 0, gone: 0 },
    changes: "1 update",
    destroys: null,
    drift: null,
    ticked: false,
    failed: false,
    dashboard: "https://github.com/acme/infra/issues/7",
    preview: {
      name: `sluiceway / ${stack}`,
      url: "https://github.com/acme/infra/commit/0a1b2c3d/checks",
    },
    run: null,
    lastDeploy: null,
    at: "2026-09-26T08:00:00Z",
    ...extra,
  });
  const state: FakeApp["state"] = {
    tokens: new Map([
      [TOKEN, { login: "alice", org: "acme", name: "laptop", expiresAt: "2026-12-25T00:00:00Z" }],
    ]),
    org: {
      org: { login: "acme", kind: "organization", page: `${origin}/acme` },
      counts: repoLine.counts,
      total: 4,
      lastScan: { sha: "0a1b2c3d4e5f", at: "2026-09-26T08:00:00Z", repo: "acme/infra" },
      repos: [repoLine],
      stacks: lines,
      locked: [],
      allowance: { plan: "free", limit: 3, sentence: null },
    },
    repos: {
      infra: {
        org: { login: "acme", kind: "organization", page: `${origin}/acme` },
        repo: repoLine,
        scan: { sha: "0a1b2c3d4e5f", at: "2026-09-26T08:00:00Z", run: null },
        counts: repoLine.counts,
        total: 4,
        stacks: lines,
      },
    },
    stacks: {
      "network:prod": {
        line: lines[1] as Record<string, Json>,
        row: row("network:prod"),
        tick: {
          outcome: "asked",
          sentence: "The tick of network:prod is asked: the deployment record is open.",
          deployment: 4242,
        },
      },
      "apps/api:prod": {
        line: lines[2] as Record<string, Json>,
        row: row("apps/api:prod", {
          line: "1 update, 1 replace · from #14 by bob",
          counts: {
            creates: 0,
            updates: 1,
            replaces: 1,
            deletes: 0,
            tracking: 0,
            changed: 0,
            gone: 0,
          },
          changes: "1 update, 1 replace",
          destroys: "1 replace",
        }),
        tick: {
          outcome: "asked",
          sentence: "The tick of apps/api:prod is asked: the deployment record is open.",
          deployment: 4243,
        },
      },
    },
    deployments: {
      4242: ["not-yet", deploy(4242, "network:prod", "waiting to start")],
      4243: [deploy(4243, "apps/api:prod", "waiting to start")],
    },
    rescan: {
      repo: "acme/infra",
      outcome: "asked",
      sentence: "GitHub was asked for a full scan of acme/infra.",
      dashboard: "https://github.com/acme/infra/issues/7",
    },
    config: {
      repo: "acme/infra",
      file: "sluiceway.yaml",
      sha: "0a1b2c3d4e5f",
      url: "https://github.com/acme/infra/blob/0a1b2c3d4e5f/sluiceway.yaml",
      text: "dashboard:\n  redact: false\n",
      problem: null,
      keys: { "dashboard.redact": false, tickers: "write", "drift.enabled": false },
      pullRequest: {
        title: "Sluiceway: dashboard settings",
        branch: "sluiceway/dashboard",
        base: "main",
      },
    },
    pullRequest: {
      status: 200,
      body: {
        outcome: "opened",
        pullRequest: 31,
        url: "https://github.com/acme/infra/pull/31",
        sentence: "Opened pull request #31 on sluiceway.yaml.",
        changes: ["dashboard.redact: false → true"],
        problems: [],
      },
    },
  };

  const polls = new Map<number, number>();

  function answer(
    route: string,
    method: string,
    status: number,
    body: Json,
    headers: Record<string, string> = {},
  ) {
    const found = problems(body, answerSchema(route, method, status));
    if (found.length > 0) {
      throw new Error(
        `The fake app broke the contract on ${method} ${route} ${status}:\n${found.join("\n")}`,
      );
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  }
  const notFound = (route: string, method: string) =>
    answer(route, method, 404, { error: "Not found.", code: "not-found" });

  const handle = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? "GET").toLowerCase();
    const headers = new Headers(init?.headers);
    const body =
      typeof init?.body === "string" && init.body !== "" ? JSON.parse(init.body) : undefined;
    calls.push({
      method: method.toUpperCase(),
      url: url.href,
      authorization: headers.get("authorization"),
      userAgent: headers.get("user-agent"),
      body,
    });
    if (url.origin !== origin)
      throw new Error(`The command line asked ${url.origin}, not the app.`);

    const path = url.pathname;
    const parts = path.split("/").slice(1).map(decodeURIComponent);
    const route = routeOf(parts);
    if (route === undefined)
      return new Response('{"error":"Not found.","code":"not-found"}', { status: 404 });

    const bearer = headers.get("authorization")?.replace(/^Bearer /, "");
    const person = bearer === undefined ? undefined : state.tokens.get(bearer);
    if (person === undefined) {
      return answer(
        route,
        method,
        401,
        {
          error: "That token does not work: it was revoked, it expired, or it never was one.",
          code: "token-not-working",
        },
        { "www-authenticate": "Bearer" },
      );
    }
    if (state.failWith !== undefined) {
      const { status, error, code, retryAfter } = state.failWith;
      return answer(
        route,
        method,
        status,
        { error, code },
        retryAfter ? { "retry-after": retryAfter } : {},
      );
    }
    if (route === "/api/v1/me") {
      return answer(route, method, 200, {
        login: person.login,
        org: person.org,
        token: { name: person.name, expiresAt: person.expiresAt },
      });
    }
    const [, , , org, , repo, , id] = parts;
    if (org !== person.org) return notFound(route, method);
    switch (route) {
      case "/api/v1/orgs/{org}":
        return answer(route, method, 200, state.org);
      case "/api/v1/orgs/{org}/repos/{repo}": {
        const found = state.repos[repo ?? ""];
        return found === undefined ? notFound(route, method) : answer(route, method, 200, found);
      }
      case "/api/v1/orgs/{org}/repos/{repo}/stacks/{stack}": {
        const found = repo === "infra" ? state.stacks[id ?? ""] : undefined;
        return found === undefined
          ? notFound(route, method)
          : answer(route, method, 200, found.row);
      }
      case "/api/v1/orgs/{org}/repos/{repo}/stacks/{stack}/tick": {
        const found = repo === "infra" ? state.stacks[id ?? ""] : undefined;
        if (found?.tick === undefined) return notFound(route, method);
        const { outcome, sentence, deployment } = found.tick;
        return answer(route, method, 200, {
          outcome,
          sentence,
          deployment:
            deployment === undefined
              ? null
              : {
                  id: deployment,
                  status: `${origin}/api/v1/orgs/acme/repos/infra/deployments/${deployment}`,
                },
          dashboard: "https://github.com/acme/infra/issues/7",
        });
      }
      case "/api/v1/orgs/{org}/repos/{repo}/deployments/{deployment}": {
        const number = Number(id);
        const answers = state.deployments[number] ?? [];
        const index = Math.min(polls.get(number) ?? 0, answers.length - 1);
        polls.set(number, (polls.get(number) ?? 0) + 1);
        const next = answers[index];
        if (next === undefined || next === "not-yet") return notFound(route, method);
        return answer(route, method, 200, next);
      }
      case "/api/v1/orgs/{org}/repos/{repo}/rescan":
        return repo === "infra"
          ? answer(route, method, 200, state.rescan)
          : notFound(route, method);
      case "/api/v1/orgs/{org}/repos/{repo}/config":
        return repo === "infra"
          ? answer(route, method, 200, state.config)
          : notFound(route, method);
      case "/api/v1/orgs/{org}/repos/{repo}/config/pull-request":
        if (repo !== "infra") return notFound(route, method);
        return answer(route, method, state.pullRequest.status, state.pullRequest.body);
      default:
        return notFound(route, method);
    }
  };

  return {
    origin,
    calls,
    state,
    fetch: Object.assign(handle, { preconnect: () => {} }) as typeof fetch,
  };
}

// The route of the document a path falls under.
function routeOf(parts: string[]): string | undefined {
  const [api, v1, orgs, , repos, , kind, , extra] = parts;
  if (api !== "api" || v1 !== "v1") return undefined;
  if (parts.length === 3 && orgs === "me") return "/api/v1/me";
  if (orgs !== "orgs") return undefined;
  if (parts.length === 4) return "/api/v1/orgs/{org}";
  if (repos !== "repos") return undefined;
  if (parts.length === 6) return "/api/v1/orgs/{org}/repos/{repo}";
  if (parts.length === 7 && kind === "rescan") return "/api/v1/orgs/{org}/repos/{repo}/rescan";
  if (parts.length === 7 && kind === "config") return "/api/v1/orgs/{org}/repos/{repo}/config";
  if (parts.length === 8 && kind === "config" && parts[7] === "pull-request") {
    return "/api/v1/orgs/{org}/repos/{repo}/config/pull-request";
  }
  if (parts.length === 8 && kind === "stacks")
    return "/api/v1/orgs/{org}/repos/{repo}/stacks/{stack}";
  if (parts.length === 9 && kind === "stacks" && extra === "tick") {
    return "/api/v1/orgs/{org}/repos/{repo}/stacks/{stack}/tick";
  }
  if (parts.length === 8 && kind === "deployments") {
    return "/api/v1/orgs/{org}/repos/{repo}/deployments/{deployment}";
  }
  return undefined;
}

export function deploy(
  deployment: number,
  stack: string,
  result: string,
  extra: Record<string, Json> = {},
) {
  return {
    deployment,
    stack,
    repo: "acme/infra",
    who: "ticked by alice via the command line",
    via: "via the command line",
    result,
    state: result === "waiting to start" || result === "deploying now" ? "deploying" : "in-sync",
    sha: "0a1b2c3d4e5f",
    run: "https://github.com/acme/infra/actions/runs/99",
    at: "2026-09-26T08:05:00Z",
    flagged: false,
    approvedBy: null,
    ...extra,
  };
}
