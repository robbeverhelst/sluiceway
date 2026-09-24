import { describe, expect, test } from "bun:test";
import { NOTIFY_EVENTS } from "../../src/core/notify.ts";
import { notificationText, webhookMessage } from "../../src/render/notification.ts";
import { fences, read } from "./docs.ts";

// Slice 2.22: the recipes of docs/notifications.md tell people about a deploy
// that did not go out for a reason that needs a person, `failed` or `refused`
// (a moved change is `refused`, records 0041 and 0051), and about a step that
// failed before it set an outcome. `in-sync` and `rehearsed` are green jobs
// that sent nothing, and saying so every time was noise (slice 2.20).

const page = read("docs/notifications.md");

// Every condition in the page that reads the `outcome` output: the `if` of a
// step in a YAML block, and an `if:` written inline in the prose.
function outcomeConditions(): string[] {
  const inFences = fences(page)
    .filter(({ language }) => language === "yaml")
    .flatMap(({ text }) => {
      const parsed = Bun.YAML.parse(text) as Record<string, unknown>[] | undefined;
      return (Array.isArray(parsed) ? parsed : []).map((step) => step.if);
    })
    .filter((condition): condition is string => typeof condition === "string");
  const inline = [...page.matchAll(/`if: ([^`]+)`/g)].map((match) => match[1] ?? "");
  return [...inFences, ...inline].filter((condition) => condition.includes("outputs.outcome"));
}

// A GitHub expression of the shapes the recipes use, evaluated for one run of
// the step: `always()`, `==`, `!=`, `&&`, `||`, parentheses, the step's
// `outcome` and its outputs, and string literals.
function sends(
  condition: string,
  run: { step: "success" | "failure"; outputs: Record<string, string> },
): boolean {
  const js = condition
    .replaceAll("always()", "true")
    .replaceAll(
      /steps\.sluiceway\.outputs\['([\w-]+)'\]/g,
      (_, name) => `o[${JSON.stringify(name)}]`,
    )
    .replaceAll(/steps\.sluiceway\.outputs\.([\w-]+)/g, (_, name) => `o[${JSON.stringify(name)}]`)
    .replaceAll("steps.sluiceway.outcome", "step")
    .replaceAll("!=", "!==")
    .replaceAll(/(?<![!=])==(?!=)/g, "===");
  expect(js).toMatch(/^[\s\w"'[\]().&|!=-]+$/);
  const outputs: Record<string, string> = {
    "result-file": "/tmp/sluiceway-apply-result.json",
    ...run.outputs,
  };
  // Unset outputs are empty strings in GitHub's expressions.
  const o = new Proxy(outputs, { get: (target, name) => target[name as string] ?? "" });
  return new Function("o", "step", `return (${js});`)(o, run.step) as boolean;
}

describe("the recipe for the apply job", () => {
  const conditions = outcomeConditions();

  test("the result file has one", () => {
    expect(conditions.length).toBeGreaterThanOrEqual(1);
  });

  for (const outcome of ["failed", "refused"]) {
    test(`sends when the outcome is ${outcome}`, () => {
      for (const condition of conditions) {
        expect(sends(condition, { step: "failure", outputs: { outcome } })).toBe(true);
      }
    });
  }

  test("sends when the step failed before it set an outcome", () => {
    for (const condition of conditions) {
      expect(sends(condition, { step: "failure", outputs: {} })).toBe(true);
    }
  });

  for (const outcome of ["deployed", "in-sync", "rehearsed"]) {
    test(`stays quiet when the outcome is ${outcome}`, () => {
      for (const condition of conditions) {
        expect(sends(condition, { step: "success", outputs: { outcome } })).toBe(false);
      }
    });
  }
});

// The step for a scan that failed before it wrote the dashboard, which the
// built-in notifications cannot tell (record 0078). Its script runs in bash
// with `curl` printing what it would send.
describe("the step for a scan that failed", () => {
  const steps = fences(page)
    .filter(({ language }) => language === "yaml")
    .flatMap(({ text }) => {
      const parsed = Bun.YAML.parse(text) as Record<string, unknown>[] | undefined;
      return Array.isArray(parsed) ? parsed : [];
    });
  const step = steps.find((one) => one.name === "Tell Slack the scan failed");

  test("sends a red message with the run", () => {
    expect(typeof step?.run).toBe("string");
    const run = Bun.spawnSync(["bash", "-euc", `curl() { cat; }\n${step?.run}`], {
      env: { PATH: process.env.PATH ?? "", SLACK_WEBHOOK_URL: "w", RUN: "run-url" },
    });
    expect(run.stderr.toString()).toBe("");
    expect((JSON.parse(run.stdout.toString()) as { text: string }).text).toBe(
      "🔴 Sluiceway: the scan failed before it wrote the dashboard. run-url",
    );
  });

  test("sends only for a failed step that has no dashboard", () => {
    const condition = String(step?.if);
    expect(sends(condition, { step: "failure", outputs: {} })).toBe(true);
    expect(sends(condition, { step: "failure", outputs: { "dashboard-url": "d" } })).toBe(false);
    expect(sends(condition, { step: "success", outputs: {} })).toBe(false);
  });
});

// Slice 5.13 (record 0078): the messages and the webhook body the page shows
// are what the renderer writes.
describe("the built-in messages the page shows", () => {
  const DASHBOARD = "https://github.com/acme/infra/issues/1";
  const APPLY_RUN = "https://github.com/acme/infra/actions/runs/7/attempts/1";
  const RESOLVE_RUN = "https://github.com/acme/infra/actions/runs/7";
  const base = { repository: "acme/infra", dashboardUrl: DASHBOARD };

  test("each example line is the renderer's text", () => {
    const lines = (fences(page).find(({ language }) => language === "text")?.text ?? "")
      .trim()
      .split("\n");
    expect(lines).toEqual([
      notificationText({ ...base, event: "pending", stacks: ["network:prod", "app:prod"] }),
      notificationText({ ...base, event: "drift", stacks: ["network:prod"] }),
      notificationText({ ...base, event: "deployed", stacks: ["network:prod"], runUrl: APPLY_RUN }),
      notificationText({ ...base, event: "failed", stacks: ["network:prod"], runUrl: APPLY_RUN }),
      notificationText({
        ...base,
        event: "refused",
        stacks: ["network:prod"],
        runUrl: RESOLVE_RUN,
      }),
    ]);
  });

  test("the webhook body is the renderer's", () => {
    const example = fences(page).find(
      ({ language, text }) => language === "json" && text.includes('"event"'),
    );
    expect(JSON.parse(example?.text ?? "")).toEqual(
      webhookMessage({ ...base, event: "pending", stacks: ["app:prod", "network:prod"] }),
    );
  });

  test("the page names every event and the default of notify.events", () => {
    for (const event of NOTIFY_EVENTS) expect(page).toContain(`| \`${event}\` |`);
    expect(page).toContain("The default is every event but `deployed`");
  });
});

// Record 0061: the result file has a published schema. Slice 5.33 (record
// 0096): its fields and its examples, taken from a run, are on the page of
// what Sluiceway writes, so this page shows no example of its own to drift.
test("the page links the schema and the page that documents every field", () => {
  expect(page).toContain("../schema/result-file.schema.json");
  expect(page).toContain("what-sluiceway-writes.md#the-result-file-and-the-outputs");
  expect(fences(page).some(({ text }) => text.includes('"mode": "scan"'))).toBe(false);
});
