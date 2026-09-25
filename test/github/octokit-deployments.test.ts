import { describe, expect, test } from "bun:test";
import { getOctokit } from "@actions/github";
import { createOctokitPort } from "../../src/github/octokit-port.ts";

// The deployment calls of the port on the wire, as octokit-port.test.ts holds
// the rest: the real Octokit with its fetch swapped for one that answers from
// a list. The answers are shaped like the ones the lab repo gave on
// 2026-09-21 (issue 27 and the pull request of slice 2.1).

interface Sent {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

interface Answer {
  status?: number;
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
      headers: { "content-type": "application/json" },
    });
  };
  const octokit = getOctokit("a-token", { request: { fetch } });
  return { port: createOctokitPort(octokit, { owner: "acme", repo: "infra" }), sent };
}

const SHA = "0123456789abcdef0123456789abcdef01234567";
const PAYLOAD = { v: 1, hash: "2b44350653e84a11", ticker: "alice", run: "4242" };

function apiDeployment(over: Record<string, unknown> = {}) {
  return {
    id: 6575759143,
    task: "sluiceway:apps/grafana:prod",
    environment: "sluiceway",
    sha: SHA,
    ref: SHA,
    payload: PAYLOAD,
    created_at: "2026-09-21T18:51:58Z",
    creator: { login: "github-actions[bot]" },
    ...over,
  };
}

describe("creating a deployment record", () => {
  test("one request, with no auto merge and no required contexts (record 0003)", async () => {
    const { port, sent } = portThatAnswers([{ status: 201, json: apiDeployment() }]);

    expect(
      await port.createDeployment({
        sha: SHA,
        task: "sluiceway:apps/grafana:prod",
        environment: "sluiceway",
        payload: PAYLOAD,
      }),
    ).toEqual({
      id: 6575759143,
      task: "sluiceway:apps/grafana:prod",
      environment: "sluiceway",
      sha: SHA,
      payload: PAYLOAD,
      createdAt: "2026-09-21T18:51:58Z",
      creator: "github-actions[bot]",
    });
    expect(sent).toEqual([
      {
        method: "POST",
        path: "/repos/acme/infra/deployments",
        query: {},
        body: {
          ref: SHA,
          task: "sluiceway:apps/grafana:prod",
          environment: "sluiceway",
          payload: PAYLOAD,
          auto_merge: false,
          required_contexts: [],
        },
      },
    ]);
  });
});

describe("writing a status", () => {
  test("auto_inactive is always sent as false (issue 27)", async () => {
    const { port, sent } = portThatAnswers([
      {
        status: 201,
        json: {
          state: "error",
          description: "the run ended without a result",
          log_url: "https://github.com/acme/infra/actions/runs/4242",
          created_at: "2026-09-21T18:51:58Z",
        },
      },
    ]);

    expect(
      await port.createDeploymentStatus(7, {
        state: "error",
        description: "the run ended without a result",
        logUrl: "https://github.com/acme/infra/actions/runs/4242",
      }),
    ).toEqual({
      state: "error",
      description: "the run ended without a result",
      createdAt: "2026-09-21T18:51:58Z",
    });
    expect(sent).toEqual([
      {
        method: "POST",
        path: "/repos/acme/infra/deployments/7/statuses",
        query: {},
        body: {
          state: "error",
          auto_inactive: false,
          description: "the run ended without a result",
          log_url: "https://github.com/acme/infra/actions/runs/4242",
        },
      },
    ]);
  });

  test("a status without a reason or a link sends neither, and still sends auto_inactive", async () => {
    const { port, sent } = portThatAnswers([
      {
        status: 201,
        json: { state: "queued", description: "", created_at: "2026-09-21T18:51:58Z" },
      },
    ]);
    await port.createDeploymentStatus(7, { state: "queued" });
    expect(sent[0]?.body).toEqual({ state: "queued", auto_inactive: false });
  });
});

describe("the newest deployment records of an environment", () => {
  function node(over: Record<string, unknown> = {}) {
    return {
      databaseId: 6575759143,
      task: "sluiceway:apps/grafana:prod",
      environment: "sluiceway",
      commitOid: SHA,
      // GraphQL gives the payload as a string that holds JSON text of a JSON
      // string: encoded twice. Seen in the lab on 2026-09-21.
      payload: JSON.stringify(JSON.stringify(PAYLOAD)),
      createdAt: "2026-09-21T18:51:58Z",
      latestStatus: {
        state: "IN_PROGRESS",
        description: null,
        createdAt: "2026-09-21T18:52:30Z",
      },
      ...over,
    };
  }

  // Record 0109: who opened a record is read from GitHub, never the payload.
  test("reads who created each record, and leaves it out when GitHub names nobody", async () => {
    const { port, sent } = portThatAnswers([
      {
        json: {
          data: {
            repository: {
              deployments: {
                pageInfo: { hasNextPage: false },
                nodes: [node({ creator: { login: "deploy-bot[bot]" } }), node({ creator: null })],
              },
            },
          },
        },
      },
    ]);
    const { records } = await port.listNewestDeployments("sluiceway");
    expect(records.map(({ creator }) => creator)).toEqual(["deploy-bot[bot]", undefined]);
    expect(String((sent[0]?.body as { query?: string } | undefined)?.query)).toContain("creator {");
  });

  test("one GraphQL request for one page of 100, newest first", async () => {
    const { port, sent } = portThatAnswers([
      {
        json: {
          data: {
            repository: {
              deployments: { pageInfo: { hasNextPage: false }, nodes: [node()] },
            },
          },
        },
      },
    ]);

    expect(await port.listNewestDeployments("sluiceway")).toEqual({
      records: [
        {
          id: 6575759143,
          task: "sluiceway:apps/grafana:prod",
          environment: "sluiceway",
          sha: SHA,
          payload: PAYLOAD,
          createdAt: "2026-09-21T18:51:58Z",
          status: { state: "in_progress", description: "", createdAt: "2026-09-21T18:52:30Z" },
        },
      ],
      more: false,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: "POST", path: "/graphql" });
    const { query, variables } = (sent[0]?.body ?? {}) as { query: string; variables: unknown };
    expect(variables).toEqual({ owner: "acme", repo: "infra", environment: "sluiceway" });
    expect(query).toContain("environments: [$environment]");
    expect(query).toContain("first: 100");
    expect(query).toContain("orderBy: {field: CREATED_AT, direction: DESC}");
  });

  test("a record without a payload or a status, and the word that more records exist", async () => {
    const { port } = portThatAnswers([
      {
        json: {
          data: {
            repository: {
              deployments: {
                pageInfo: { hasNextPage: true },
                // The lab's records of issue 27 read like this: payload null.
                nodes: [node({ payload: null, latestStatus: null, task: "deploy" })],
              },
            },
          },
        },
      },
    ]);
    const page = await port.listNewestDeployments("sluiceway");
    expect(page.more).toBe(true);
    expect(page.records[0]).toMatchObject({ task: "deploy", payload: null, status: undefined });
  });

  test("a payload that is no JSON stays the text it is", async () => {
    const { port } = portThatAnswers([
      {
        json: {
          data: {
            repository: {
              deployments: {
                pageInfo: { hasNextPage: false },
                nodes: [node({ payload: "not json" })],
              },
            },
          },
        },
      },
    ]);
    expect((await port.listNewestDeployments("sluiceway")).records[0]?.payload).toBe("not json");
  });

  // Slice 4.11 (record 0062). GitHub writes `inactive` when another writer's
  // success supersedes a record, and `latestStatus` then holds that moment.
  // The statuses of a record come newest first, the success right under the
  // `inactive` (seen in the lab repo on 2026-09-22), so the page asks for two.
  test("an inactive record carries the time of the success it superseded", async () => {
    const statuses = {
      nodes: [
        { state: "INACTIVE", createdAt: "2026-09-21T08:00:00Z" },
        { state: "SUCCESS", createdAt: "2026-09-21T07:59:58Z" },
      ],
    };
    const { port, sent } = portThatAnswers([
      {
        json: {
          data: {
            repository: {
              deployments: {
                pageInfo: { hasNextPage: false },
                nodes: [
                  node({
                    latestStatus: {
                      state: "INACTIVE",
                      description: "",
                      createdAt: "2026-09-21T08:00:00Z",
                    },
                    statuses,
                  }),
                ],
              },
            },
          },
        },
      },
    ]);
    expect((await port.listNewestDeployments("sluiceway")).records[0]?.status).toEqual({
      state: "inactive",
      description: "",
      createdAt: "2026-09-21T08:00:00Z",
      succeededAt: "2026-09-21T07:59:58Z",
    });
    expect(sent).toHaveLength(1);
    const { query } = (sent[0]?.body ?? {}) as { query: string };
    expect(query).toContain("statuses(first: 2)");
  });

  test("a status that is not inactive, or no success under it, carries no success time", async () => {
    const nodes = [
      node({
        statuses: { nodes: [{ state: "IN_PROGRESS", createdAt: "2026-09-21T18:52:30Z" }] },
      }),
      node({
        databaseId: 2,
        latestStatus: { state: "INACTIVE", description: "", createdAt: "2026-09-21T08:00:00Z" },
        statuses: {
          nodes: [
            { state: "INACTIVE", createdAt: "2026-09-21T08:00:00Z" },
            { state: "IN_PROGRESS", createdAt: "2026-09-21T07:59:00Z" },
          ],
        },
      }),
    ];
    const { port } = portThatAnswers([
      {
        json: {
          data: { repository: { deployments: { pageInfo: { hasNextPage: false }, nodes } } },
        },
      },
    ]);
    const { records } = await port.listNewestDeployments("sluiceway");
    expect(records.map((record) => record.status?.succeededAt)).toEqual([undefined, undefined]);
  });

  test("a repo GitHub does not show has no records to read, which is an error", async () => {
    const { port } = portThatAnswers([{ json: { data: { repository: null } } }]);
    await expect(port.listNewestDeployments("sluiceway")).rejects.toThrow(
      "GitHub gave no repository",
    );
  });
});

describe("the REST fall back for a stack that is not on the page", () => {
  test("the newest record of a task is one request for one record", async () => {
    const { port, sent } = portThatAnswers([{ json: [apiDeployment()] }]);

    expect(await port.newestDeploymentOfTask("sluiceway:apps/grafana:prod")).toEqual({
      id: 6575759143,
      task: "sluiceway:apps/grafana:prod",
      environment: "sluiceway",
      sha: SHA,
      payload: PAYLOAD,
      createdAt: "2026-09-21T18:51:58Z",
      creator: "github-actions[bot]",
    });
    expect(sent).toEqual([
      {
        method: "GET",
        path: "/repos/acme/infra/deployments",
        query: { task: "sluiceway:apps/grafana:prod", per_page: "1" },
        body: undefined,
      },
    ]);
  });

  test("a task without a record gives nothing", async () => {
    const { port } = portThatAnswers([{ json: [] }]);
    expect(await port.newestDeploymentOfTask("sluiceway:new")).toBeUndefined();
  });

  test("REST gives no status with a record, so the latest status is a request of its own", async () => {
    const { port, sent } = portThatAnswers([
      {
        json: [
          {
            state: "failure",
            description: "the tool exited with an error",
            created_at: "2026-09-21T18:53:00Z",
          },
        ],
      },
    ]);

    expect(await port.latestDeploymentStatus(7)).toEqual({
      state: "failure",
      description: "the tool exited with an error",
      createdAt: "2026-09-21T18:53:00Z",
    });
    expect(sent).toEqual([
      {
        method: "GET",
        path: "/repos/acme/infra/deployments/7/statuses",
        // Two, for the success under an inactive (record 0062).
        query: { per_page: "2" },
        body: undefined,
      },
    ]);
  });

  test("an inactive status carries the time of the success under it, in the same request", async () => {
    const { port, sent } = portThatAnswers([
      {
        json: [
          { state: "inactive", description: "", created_at: "2026-09-21T08:00:00Z" },
          { state: "success", description: "", created_at: "2026-09-21T07:59:58Z" },
        ],
      },
    ]);
    expect(await port.latestDeploymentStatus(7)).toEqual({
      state: "inactive",
      description: "",
      createdAt: "2026-09-21T08:00:00Z",
      succeededAt: "2026-09-21T07:59:58Z",
    });
    expect(sent).toHaveLength(1);
  });

  test("a record without a status yet gives nothing", async () => {
    const { port } = portThatAnswers([{ json: [] }]);
    expect(await port.latestDeploymentStatus(7)).toBeUndefined();
  });
});

describe("one record by its id", () => {
  test("one request, and the record in the port's words", async () => {
    const { port, sent } = portThatAnswers([{ json: apiDeployment() }]);
    expect(await port.getDeployment(6575759143)).toEqual({
      id: 6575759143,
      task: "sluiceway:apps/grafana:prod",
      environment: "sluiceway",
      sha: SHA,
      payload: PAYLOAD,
      createdAt: "2026-09-21T18:51:58Z",
      creator: "github-actions[bot]",
    });
    expect(sent).toEqual([
      {
        method: "GET",
        path: "/repos/acme/infra/deployments/6575759143",
        query: {},
        body: undefined,
      },
    ]);
  });

  test("a record GitHub does not have is an error", async () => {
    const { port } = portThatAnswers([{ status: 404, json: { message: "Not Found" } }]);
    await expect(port.getDeployment(1)).rejects.toThrow("Not Found");
  });
});

describe("reading a workflow run", () => {
  test("one request, and only whether the run is over is kept", async () => {
    const { port, sent } = portThatAnswers([
      { json: { id: 4242, status: "completed", conclusion: "cancelled" } },
    ]);
    expect(await port.getWorkflowRun("4242")).toEqual({ completed: true });
    expect(sent).toEqual([
      { method: "GET", path: "/repos/acme/infra/actions/runs/4242", query: {}, body: undefined },
    ]);
  });

  test("a run that waits, is queued or runs is not over", async () => {
    for (const status of ["queued", "in_progress", "waiting", "requested", "pending"]) {
      const { port } = portThatAnswers([{ json: { id: 4242, status, conclusion: null } }]);
      expect(await port.getWorkflowRun("4242")).toEqual({ completed: false });
    }
  });

  test("a run GitHub does not have gives nothing", async () => {
    const { port } = portThatAnswers([{ status: 404, json: { message: "Not Found" } }]);
    expect(await port.getWorkflowRun("1")).toBeUndefined();
  });

  test("any other refusal is an error, such as a token without actions: read", async () => {
    const { port } = portThatAnswers([
      { status: 403, json: { message: "Resource not accessible by integration" } },
    ]);
    await expect(port.getWorkflowRun("4242")).rejects.toThrow(
      "Resource not accessible by integration",
    );
  });
});
