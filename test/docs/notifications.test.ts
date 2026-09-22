import { describe, expect, test } from "bun:test";
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

describe("the recipes for the apply job", () => {
  const conditions = outcomeConditions();

  test("there is one for Slack, Telegram and the generic webhook", () => {
    expect(conditions.length).toBeGreaterThanOrEqual(3);
  });

  for (const outcome of ["failed", "refused"]) {
    test(`send when the outcome is ${outcome}`, () => {
      for (const condition of conditions) {
        expect(sends(condition, { step: "failure", outputs: { outcome } })).toBe(true);
      }
    });
  }

  test("send when the step failed before it set an outcome", () => {
    for (const condition of conditions) {
      expect(sends(condition, { step: "failure", outputs: {} })).toBe(true);
    }
  });

  for (const outcome of ["deployed", "in-sync", "rehearsed"]) {
    test(`stay quiet when the outcome is ${outcome}`, () => {
      for (const condition of conditions) {
        expect(sends(condition, { step: "success", outputs: { outcome } })).toBe(false);
      }
    });
  }
});

// Slice 4.5: a message starts with the dot of its result, the same dots as
// the job log and the recently deployed list. The step's script runs in bash
// with `curl` printing what it would send.
describe("the message of a recipe", () => {
  const steps = fences(page)
    .filter(({ language }) => language === "yaml")
    .flatMap(({ text }) => {
      const parsed = Bun.YAML.parse(text) as Record<string, unknown>[] | undefined;
      return Array.isArray(parsed) ? parsed : [];
    });

  function sent(name: string, env: Record<string, string>): string {
    const step = steps.find((one) => one.name === name);
    expect(typeof step?.run).toBe("string");
    const run = Bun.spawnSync(["bash", "-euc", `curl() { cat; }\n${step?.run}`], {
      env: { PATH: process.env.PATH ?? "", ...env },
    });
    expect(run.stderr.toString()).toBe("");
    const message = JSON.parse(run.stdout.toString()) as { text: string };
    return message.text;
  }

  const scan = {
    SLACK_WEBHOOK_URL: "w",
    DASHBOARD: "https://github.com/acme/infra/issues/1",
    RUN: "run-url",
  };

  test("Slack: yellow when stacks are pending", () => {
    expect(
      sent("Tell Slack", { ...scan, STEP: "success", PENDING: "2", PREVIEW_FAILED: "0" }),
    ).toBe("🟡 Sluiceway: 2 pending, 0 preview failed. https://github.com/acme/infra/issues/1");
  });

  test("Slack: red when a preview failed", () => {
    expect(
      sent("Tell Slack", { ...scan, STEP: "success", PENDING: "2", PREVIEW_FAILED: "1" }),
    ).toStartWith("🔴 ");
  });

  test("Slack: red when the step failed", () => {
    expect(sent("Tell Slack", { ...scan, STEP: "failure", PENDING: "", PREVIEW_FAILED: "" })).toBe(
      "🔴 Sluiceway: 0 pending, 0 preview failed. https://github.com/acme/infra/issues/1",
    );
  });

  const telegram = { TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c", DASHBOARD: "d" };

  test("Telegram: red for a failed deploy", () => {
    expect(sent("Tell Telegram", { ...telegram, STACK: "a:prod", OUTCOME: "failed" })).toBe(
      "🔴 Sluiceway: a:prod was not deployed (failed). d",
    );
  });

  test("Telegram: yellow for a refused one", () => {
    expect(sent("Tell Telegram", { ...telegram, STACK: "a:prod", OUTCOME: "refused" })).toBe(
      "🟡 Sluiceway: a:prod was not deployed (refused). d",
    );
  });

  test("Telegram: red for a step that failed before it set an outcome", () => {
    expect(sent("Tell Telegram", { ...telegram, STACK: "", OUTCOME: "" })).toBe(
      "🔴 Sluiceway: a stack was not deployed (failed). d",
    );
  });
});
