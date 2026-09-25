import { afterEach, expect, test } from "bun:test";
import type { MatrixEntry } from "../../src/core/resolve.ts";
import { createGitHubClient } from "../../src/github/client.ts";
import { createOctokitPort } from "../../src/github/octokit-port.ts";
import { countRequests } from "../../src/github/request-count.ts";
import { apply } from "../../src/modes/apply.ts";
import { resolve } from "../../src/modes/resolve.ts";
import { scan } from "../../src/modes/scan.ts";
import { settle } from "../../src/modes/settle.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";
import { type FakeGitHubServer, startFakeGitHubServer } from "../fake-github/server.ts";
import {
  ACTION_REF,
  change,
  harness,
  pending,
  REPO_URL,
  SHA,
  steppingClock,
  tableAdapter,
} from "./harness.ts";
import { ALICE, RESOLVE_RUN, WORKFLOW, WRITE } from "./resolve-harness.ts";

// Issue 266: every request the action makes names API version 2026-03-10.
// The whole loop runs through the real Octokit port and real HTTP, and the
// fake server refuses a request without the version and keeps it, so a call
// that forgets it fails here even where the port swallows the failure.

const servers: FakeGitHubServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

test("a scan, a tick, an apply and a settle send every request with the API version", async () => {
  const fake = new FakeGitHub();
  const server = await startFakeGitHubServer(fake);
  servers.push(server);
  const octokit = createGitHubClient("a-token", { baseUrl: server.url });
  const sent = countRequests(octokit);
  const github = createOctokitPort(octokit, { owner: "acme", repo: "infra" });

  const adapter = tableAdapter({ "app:prod": pending("app:prod", change("bucket")) });
  const { context, log } = harness(adapter, { github });
  await scan(context);
  const afterScan = sent();

  // Alice ticks the row, as a person does in the issue.
  const body = fake.issue(1).body;
  const ticked = body
    .split("\n")
    .map((line) =>
      parseDashboard(line).rows[0]?.stackId === "app:prod"
        ? line.replace("- [ ] ", "- [x] ")
        : line,
    )
    .join("\n");
  fake.editBody(1, ticked, ALICE);
  fake.seedPermission(ALICE.login, WRITE);
  fake.seedBranch("main", SHA);
  fake.seedRun(RESOLVE_RUN, { completed: false });
  const event = fake.deliverEvent();
  const outputs: Record<string, string> = {};
  await resolve({
    root: context.root,
    adapter,
    github,
    log,
    repoUrl: REPO_URL,
    runId: RESOLVE_RUN,
    sha: SHA,
    actionRef: ACTION_REF,
    event,
    workflow: WORKFLOW,
    setOutput: (name, value) => {
      outputs[name] = value;
    },
  });
  const [entry] = JSON.parse(outputs.matrix ?? "[]") as MatrixEntry[];
  if (!entry) throw new Error("resolve handed nothing on.");
  const afterResolve = sent();

  await apply({
    root: context.root,
    env: { PATH: "/usr/bin" },
    mask: () => {},
    adapter,
    run: async () => {
      throw new Error("The table adapter starts no process.");
    },
    github,
    log,
    previewTimeoutMinutes: 10,
    now: steppingClock(),
    repoUrl: REPO_URL,
    runId: RESOLVE_RUN,
    runAttempt: "1",
    jobId: "106502299999",
    sha: SHA,
    actionRef: ACTION_REF,
    deploymentId: entry.deployment,
    workflow: { file: "sluiceway.yml", ref: "refs/heads/main" },
    event,
  });
  const afterApply = sent();

  await settle({
    root: context.root,
    adapter,
    github,
    log,
    repoUrl: REPO_URL,
    runId: RESOLVE_RUN,
    event,
    workflow: WORKFLOW,
    actionRef: ACTION_REF,
  });

  // The loop went round: the tick deployed exactly that stack.
  expect(adapter.applied).toEqual(["app:prod"]);
  expect(fake.deploymentStatuses(entry.deployment).at(-1)?.state).toBe("success");
  // Each part asked GitHub something, and GitHub refused none of it.
  expect(afterScan).toBeGreaterThan(0);
  expect(afterResolve).toBeGreaterThan(afterScan);
  expect(afterApply).toBeGreaterThan(afterResolve);
  expect(sent()).toBeGreaterThan(afterApply);
  expect(server.refused).toEqual([]);
  // Every request the client sent reached the fake.
  expect(fake.requests).toHaveLength(sent());
});
