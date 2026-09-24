import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Preparation } from "../../src/adapters/adapter.ts";
import type { Stack } from "../../src/core/stack.ts";
import { stackId } from "../../src/core/stack.ts";
import { APPLY_JOB_ID, handedOn, rows, runApply, states } from "./apply-harness.ts";
import { change, pending, repoRoot } from "./harness.ts";
import { RESOLVE_RUN_URL } from "./resolve-harness.ts";

// Slice 5.38 (record 0103): `apply` gives the stack's fresh preview, its
// preparation and its deploy the file the stack's entry names, on top of the
// environment of the step, and a file that cannot be loaded fails the fresh
// preview, so nothing goes out.

const CONFIG = "stacks:\n  - path: a\n    name: prod\n    envFile: ci/a.env\n";
const STEP_ENV = { PATH: "/usr/bin", REGION: "us-east-1" };
const OWN = { ...STEP_ENV, AWS_ACCESS_KEY_ID: "AKIA0123456789", REGION: "eu-west-1" };

const FILE = "AWS_ACCESS_KEY_ID=AKIA0123456789\nREGION=eu-west-1\n";

// The scan that wrote the row had the file. Whether `apply` has it, and what
// it says, is the test's.
async function ticked(files: Record<string, string>) {
  const root = repoRoot(CONFIG);
  mkdirSync(join(root, "ci"), { recursive: true });
  writeFileSync(join(root, "ci/a.env"), FILE);
  const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
    root,
  });
  rmSync(join(root, "ci/a.env"));
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
  h.context.env = STEP_ENV;
  const masked: string[] = [];
  h.context.mask = (value) => void masked.push(value);
  return { h, masked };
}

describe("the env file of a stack in apply", () => {
  test("the fresh preview and the deploy get the stack's file on top of the step's environment, masked first", async () => {
    const { h, masked } = await ticked({ "ci/a.env": FILE });
    const seen: Record<string, Record<string, string | undefined>> = {};
    const preview = h.adapter.preview;
    h.adapter.preview = async (stack, options) => {
      seen.preview = options.env;
      return preview(stack, options);
    };
    const deploy = h.adapter.apply;
    h.adapter.apply = async (stack, context, plan, options) => {
      seen.deploy = context.env;
      return deploy(stack, context, plan, options);
    };

    await runApply(h);

    expect(seen).toEqual({ preview: OWN, deploy: OWN });
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
    expect(masked.sort()).toEqual(["AKIA0123456789", "eu-west-1"]);
    const loaded = h.log.groups.findIndex(
      ({ title }) => title === "Loaded the env file ci/a.env for a:prod",
    );
    expect(loaded).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(h.log)).not.toContain("AKIA0123456789");
    expect(h.github.issue(h.number).body).not.toContain("AKIA0123456789");
  });

  test("the preparation of the stack gets its file too", async () => {
    const { h } = await ticked({ "ci/a.env": FILE });
    let seen: Record<string, string | undefined> | undefined;
    h.adapter.prepare = (stacks: Stack[]): Preparation[] =>
      stacks.map((stack) => ({
        title: stackId(stack),
        stacks: [stack],
        run: async (context) => {
          seen = context.env;
          return { ok: true, toolLog: "" };
        },
      }));

    await runApply(h);

    expect(seen).toEqual(OWN);
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
  });

  test("a file that is not there fails the fresh preview, and nothing goes out", async () => {
    const { h } = await ticked({});

    await expect(runApply(h)).rejects.toThrow(
      "a:prod was not deployed: the preview before the deploy failed: the env file of the stack could not be loaded.",
    );

    expect(h.adapter.previewed).toEqual([]);
    expect(h.adapter.applied).toEqual([]);
    expect(states(h)).toEqual(["queued", "in_progress", "failure"]);
    expect(rows(h)["a:prod"]).toStartWith(
      `- **a:prod** · preview failed: the env file of the stack could not be loaded · [run](${RESOLVE_RUN_URL}/job/${APPLY_JOB_ID})`,
    );
    const group = h.log.groups.find(({ title }) => title === "a:prod: the fresh preview");
    expect(group?.lines).toContain(
      "The envFile of the stack names ci/a.env, and there is no such file in the checkout.",
    );
  });
});
