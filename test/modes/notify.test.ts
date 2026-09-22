import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import { createNotifier, type Fetch } from "../../src/notify/send.ts";
import type { WebhookMessage } from "../../src/render/notification.ts";
import { handedOn, runApply, states } from "./apply-harness.ts";
import {
  change,
  dashboardBody,
  harness,
  inSync,
  pending,
  REPO_URL,
  tableAdapter,
} from "./harness.ts";
import { RESOLVE_RUN_URL, scanned, tick, wake } from "./resolve-harness.ts";

// A person with no account GitHub knows, whose tick is refused (record 0018).
const MALLORY = { login: "mallory", type: "User" };

// Slice 5.13 (record 0078): the modes send the built-in notifications through
// the notifier the glue hands them, to a webhook here, so a test reads what
// went out. A send that fails is a warning and changes nothing else.

const WEBHOOK = "https://hooks.example.com/SECRET";
const DASHBOARD = `${REPO_URL}/issues/1`;

function webhook(answer: { ok: boolean; status: number } = { ok: true, status: 200 }) {
  const sent: WebhookMessage[] = [];
  const fetch: Fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body) as WebhookMessage);
    return answer;
  };
  return { sent, fetch };
}

describe("a scan", () => {
  const table = {
    "a:prod": pending("a:prod", change("logs")),
    "b:prod": inSync("b:prod"),
  };

  test("tells the stacks that became pending, with the dashboard, once", async () => {
    const { sent, fetch } = webhook();
    const h = harness(tableAdapter(table));
    h.context.notifier = createNotifier({ webhook: WEBHOOK }, { fetch, log: h.log });

    await scan(h.context);
    await scan(h.context);

    expect(sent).toEqual([
      {
        version: 1,
        event: "pending",
        repository: "acme/infra",
        stacks: ["a:prod"],
        dashboard: DASHBOARD,
        run: null,
        text: `🟡 Sluiceway in acme/infra: a:prod is pending. Dashboard: ${DASHBOARD}`,
      },
    ]);
  });

  test("sends nothing for an event sluiceway.yaml leaves out", async () => {
    const { sent, fetch } = webhook();
    const h = harness(tableAdapter(table), { config: "notify:\n  events: [failed]\n" });
    h.context.notifier = createNotifier({ webhook: WEBHOOK }, { fetch, log: h.log });
    await scan(h.context);
    expect(sent).toEqual([]);
  });

  test("a channel that fails is a warning, and the dashboard is written all the same", async () => {
    const { fetch } = webhook({ ok: false, status: 500 });
    const h = harness(tableAdapter(table));
    h.context.notifier = createNotifier({ webhook: WEBHOOK }, { fetch, log: h.log });
    await scan(h.context);
    expect(dashboardBody(h.github)).toContain('stack="a:prod" state="pending"');
    expect(h.log.warnings.map(({ title }) => title)).toEqual(["Notification not sent"]);
  });
});

// The leak test of record 0052 on the notifications: a value the repo lets
// the dashboard show stays on the dashboard.
test("a value dashboard.showValues shows on the row never reaches a notification", async () => {
  const shown = {
    ...change("app", "update"),
    changedKeys: ["image"],
    values: [{ path: "image", old: "CANARY-VALUE", new: "CANARY-VALUE-2" }],
  };
  const { sent, fetch } = webhook();
  const h = harness(tableAdapter({ "a:prod": pending("a:prod", shown) }), {
    config: "dashboard:\n  showValues: [image]\n",
  });
  h.context.notifier = createNotifier({ webhook: WEBHOOK }, { fetch, log: h.log });
  await scan(h.context);
  expect(dashboardBody(h.github)).toContain("CANARY-VALUE");
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent)).not.toContain("CANARY");
});

describe("resolve", () => {
  test("tells a refused tick, with the stack and the dashboard", async () => {
    const h = await scanned({ "a:prod": pending("a:prod", change("logs")) });
    const { sent, fetch } = webhook();
    h.context.notifier = createNotifier({ webhook: WEBHOOK }, { fetch, log: h.log });
    tick(h, MALLORY, ["a:prod"]);

    await wake(h);

    expect(h.github.comments(h.number)).toHaveLength(1);
    expect(
      sent.map(({ event, stacks, dashboard, run }) => ({ event, stacks, dashboard, run })),
    ).toEqual([
      { event: "refused", stacks: ["a:prod"], dashboard: DASHBOARD, run: RESOLVE_RUN_URL },
    ]);
  });

  test("tells nothing for a tick that deploys", async () => {
    const h = await scanned({ "a:prod": pending("a:prod", change("logs")) });
    const { sent, fetch } = webhook();
    h.context.notifier = createNotifier({ webhook: WEBHOOK }, { fetch, log: h.log });
    tick(h, { login: "alice", type: "User" }, ["a:prod"]);
    await wake(h);
    expect(sent).toEqual([]);
  });
});

describe("apply", () => {
  const table = () => ({ "a:prod": pending("a:prod", change("bucket")) });

  test("tells a deploy that went out when deployed is listed", async () => {
    const h = await handedOn(table(), ["a:prod"], { config: "notify:\n  events: [deployed]\n" });
    const { sent, fetch } = webhook();
    h.context.notifier = createNotifier({ webhook: WEBHOOK }, { fetch, log: h.log });

    await runApply(h);

    expect(sent.map(({ event, stacks, dashboard }) => ({ event, stacks, dashboard }))).toEqual([
      { event: "deployed", stacks: ["a:prod"], dashboard: DASHBOARD },
    ]);
    expect(sent[0]?.run).toStartWith(`${REPO_URL}/actions/runs/`);
  });

  test("says nothing about a deploy that went out by default", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    const { sent, fetch } = webhook();
    h.context.notifier = createNotifier({ webhook: WEBHOOK }, { fetch, log: h.log });
    await runApply(h);
    expect(sent).toEqual([]);
  });

  test("tells a deploy that failed, and the job is red for the deploy alone", async () => {
    const broken = {
      "a:prod": {
        ok: false as const,
        reason: { kind: "tool-error" as const, exitCode: 1 },
        toolLog: "error: CANARY-VALUE\n",
      },
    };
    const h = await handedOn(table(), ["a:prod"], { deploys: broken });
    const { sent, fetch } = webhook();
    h.context.notifier = createNotifier({ webhook: WEBHOOK }, { fetch, log: h.log });

    await expect(runApply(h)).rejects.toThrow();

    expect(sent.map(({ event, stacks }) => ({ event, stacks }))).toEqual([
      { event: "failed", stacks: ["a:prod"] },
    ]);
    expect(JSON.stringify(sent)).not.toContain("CANARY-VALUE");
  });

  test("a channel that fails never fails a deploy that went out", async () => {
    const h = await handedOn(table(), ["a:prod"], { config: "notify:\n  events: [deployed]\n" });
    const { fetch } = webhook({ ok: false, status: 503 });
    h.context.notifier = createNotifier({ webhook: WEBHOOK }, { fetch, log: h.log });

    await runApply(h);

    expect(states(h).at(-1)).toBe("success");
    expect(h.log.warnings.map(({ title }) => title)).toEqual(["Notification not sent"]);
  });

  test("a channel that throws never fails a deploy either", async () => {
    const h = await handedOn(table(), ["a:prod"], { config: "notify:\n  events: [deployed]\n" });
    const fetch: Fetch = async () => {
      throw new Error("boom");
    };
    h.context.notifier = createNotifier({ webhook: WEBHOOK }, { fetch, log: h.log });
    await runApply(h);
    expect(states(h).at(-1)).toBe("success");
  });
});
