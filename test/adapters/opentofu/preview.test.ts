import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { opentofu } from "../../../src/adapters/opentofu/index.ts";
import type { Change } from "../../../src/core/diff.ts";
import { answering, ROOT, replay, VERSIONS } from "./replay.ts";
import { DEV, DNS, PROD } from "./stacks.ts";

// The OpenTofu preview (record 0053): `tofu plan -out` into a directory of its
// own, `tofu show -json` of that plan, and the diff from resource_changes.
// Every expected diff here is worked out by hand from the plan the scenario
// makes, not from the adapter.

async function previewOf(
  version: string,
  scenario: string,
  stack = DEV,
  extra: { showValues?: string[]; savePlan?: boolean } = {},
): Promise<PreviewResult & { plans: string[] }> {
  const { run, plans } = replay(version, scenario);
  const result = await opentofu.preview(stack, {
    root: ROOT,
    env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_secret" },
    run,
    timeoutMinutes: 10,
    ...extra,
  });
  return { ...result, plans };
}

function changes(result: PreviewResult): Change[] {
  if (!result.ok) throw new Error(`The preview failed: ${JSON.stringify(result.reason)}`);
  return result.diff.changes;
}

const change = (
  address: string,
  op: Change["op"],
  keys: Partial<Pick<Change, "changedKeys" | "replaceKeys" | "tracking" | "previousAddress">> = {},
): Change => {
  const [type = "", ...rest] = address.split(".");
  return { address, type, name: rest.join("."), op, changedKeys: [], replaceKeys: [], ...keys };
};

const REPLACED_NOTES_KEYS = [
  "content",
  "content_base64sha256",
  "content_base64sha512",
  "content_md5",
  "content_sha1",
  "content_sha256",
  "content_sha512",
  "id",
];

for (const version of VERSIONS) {
  describe(`tofu ${version}: every op as the plan gives it`, () => {
    test("a new stack is all creates, and creates list no keys", async () => {
      const result = await previewOf(version, "new-stack");
      expect(changes(result)).toEqual([
        change("local_file.notes", "create"),
        change("null_resource.trigger", "create"),
        change("random_pet.name", "create"),
        change("terraform_data.config", "create"),
      ]);
      if (result.ok) expect(result.diff.stackId).toBe("network:dev");
    });

    test("nothing changed: every no-op is dropped", async () => {
      expect(changes(await previewOf(version, "no-changes"))).toEqual([]);
    });

    test("an update names the changed path and the output known only after the deploy", async () => {
      expect(changes(await previewOf(version, "update"))).toEqual([
        change("terraform_data.config", "update", { changedKeys: ["input.greeting", "output"] }),
      ]);
    });

    test("both replace orders are a replace, with what forced it from replace_paths", async () => {
      expect(changes(await previewOf(version, "replace"))).toEqual([
        change("local_file.notes", "replace", {
          changedKeys: REPLACED_NOTES_KEYS,
          replaceKeys: ["content"],
        }),
      ]);
    });

    test("a delete", async () => {
      expect(changes(await previewOf(version, "delete"))).toEqual([
        change("null_resource.trigger", "delete"),
      ]);
    });

    test("a forget is a tracking change, never a destroy", async () => {
      expect(changes(await previewOf(version, "forget"))).toEqual([
        change("null_resource.trigger", "none", { tracking: "forget" }),
      ]);
    });

    test("a moved block is a move, with the address it had", async () => {
      expect(changes(await previewOf(version, "move"))).toEqual([
        change("random_pet.pet", "none", { tracking: "move", previousAddress: "random_pet.name" }),
      ]);
    });

    test("an import block is an import", async () => {
      expect(changes(await previewOf(version, "import"))).toEqual([
        change("random_string.imported", "none", { tracking: "import" }),
      ]);
    });

    test("a mixed plan, where a data source read is dropped", async () => {
      expect(changes(await previewOf(version, "mixed"))).toEqual([
        change("local_file.notes", "replace", {
          changedKeys: REPLACED_NOTES_KEYS,
          replaceKeys: ["content"],
        }),
        change("null_resource.trigger", "delete"),
        change("random_pet.extra", "create"),
        change("terraform_data.config", "update", { changedKeys: ["input.greeting", "output"] }),
      ]);
    });

    test("a changed sensitive value is a changed path like any other", async () => {
      expect(changes(await previewOf(version, "changed-secret"))).toEqual([
        change("null_resource.trigger", "replace", {
          changedKeys: ["id", "triggers", "triggers.secret"],
          replaceKeys: ["triggers"],
        }),
        change("terraform_data.config", "update", { changedKeys: ["input.secret", "output"] }),
      ]);
    });

    test("a change to root outputs alone shows as in sync (record 0036)", async () => {
      expect(changes(await previewOf(version, "outputs-only"))).toEqual([]);
    });

    test("another workspace with its own var file", async () => {
      expect(
        changes(await previewOf(version, "other-workspace", PROD)).map((one) => one.op),
      ).toEqual(["create", "create", "create", "create"]);
    });

    test("a root module of .tofu files in the default workspace", async () => {
      const result = await previewOf(version, "tofu-files", DNS);
      expect(changes(result)).toEqual([
        change("random_id.zone", "create"),
        change("terraform_data.record", "create"),
      ]);
      if (result.ok) expect(result.diff.stackId).toBe("dns");
    });

    test("the same plan twice gives the same diff", async () => {
      const { run } = replay(version, "same-plan-twice");
      const options = { root: ROOT, env: {}, run, timeoutMinutes: 10 };
      const first = await opentofu.preview(DEV, options);
      const second = await opentofu.preview(DEV, options);
      expect(second).toEqual(first);
    });
  });

  describe(`tofu ${version}: how the tool is run`, () => {
    test("plan and show, in the stack's directory and workspace, without the action's inputs", async () => {
      const { run, runs } = replay(version, "update");
      await opentofu.preview(DEV, {
        root: ROOT,
        env: { PATH: "/usr/bin", INPUT_GITHUB_TOKEN: "ghs_secret", TF_VAR_region: "eu" },
        run,
        timeoutMinutes: 7,
      });
      expect(runs.map((one) => one.argv.slice(0, 2))).toEqual([
        ["tofu", "plan"],
        ["tofu", "show"],
      ]);
      for (const one of runs) {
        expect(one.cwd).toBe(`${ROOT}/network`);
        expect(one.env).toEqual({
          PATH: "/usr/bin",
          TF_VAR_region: "eu",
          TF_IN_AUTOMATION: "true",
          TF_WORKSPACE: "dev",
        });
        expect(one.timeoutMs).toBe(7 * 60_000);
      }
    });

    test("a stack without a workspace leaves TF_WORKSPACE as the job has it", async () => {
      const { run, runs } = replay(version, "tofu-files");
      await opentofu.preview(DNS, { root: ROOT, env: {}, run, timeoutMinutes: 10 });
      expect(runs.every((one) => one.env.TF_WORKSPACE === undefined)).toBe(true);
    });

    test("the plan file lives in a directory of its own, removed when the preview ends", async () => {
      const result = await previewOf(version, "update");
      expect(result.plans).toHaveLength(2);
      expect(result.plans[0]).toBe(result.plans[1] as string);
      expect(existsSync(dirname(result.plans[0] as string))).toBe(false);
      if (result.ok) expect(result.plan).toBeUndefined();
    });

    test("asked to save it, the preview keeps the plan until it is let go", async () => {
      const result = await previewOf(version, "update", DEV, { savePlan: true });
      if (!result.ok || result.plan === undefined) throw new Error("Expected a saved plan.");
      const dir = dirname(result.plans[0] as string);
      expect(existsSync(dir)).toBe(true);
      await result.plan.dispose();
      expect(existsSync(dir)).toBe(false);
    });
  });

  describe(`tofu ${version}: a preview that fails`, () => {
    test("a program error: the exit code of the plan, and the tool's diagnostics for the job log", async () => {
      const result = await previewOf(version, "program-error");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toEqual({ kind: "tool-error", exitCode: 1 });
      expect(result.plans).toHaveLength(1);
      expect(result.toolLog).toContain("Error: Unclosed configuration block");
      expect(result.toolLog).toContain("main.tf, line 50");
      expect(existsSync(dirname(result.plans[0] as string))).toBe(false);
    });

    test("a variable with no value", async () => {
      const result = await previewOf(version, "missing-variable");
      expect(result.ok ? undefined : result.reason).toEqual({ kind: "tool-error", exitCode: 1 });
      expect(result.toolLog).toContain("No value for required variable");
    });
  });
}

describe("what no recording holds", () => {
  const exited = (stdout: string, exitCode = 0) =>
    ({ status: "exited", exitCode, stdout, stderr: "" }) as const;
  const options = (run: Parameters<typeof opentofu.preview>[1]["run"]) => ({
    root: ROOT,
    env: {},
    run,
    timeoutMinutes: 3,
  });

  test("a plan that runs out of time", async () => {
    const { run } = answering({ status: "timed-out", stdout: "", stderr: "" });
    const result = await opentofu.preview(DEV, options(run));
    expect(result.ok ? undefined : result.reason).toEqual({ kind: "timed-out", minutes: 3 });
  });

  test("a tool that cannot be started", async () => {
    const { run } = answering({ status: "not-started" });
    const result = await opentofu.preview(DEV, options(run));
    expect(result.ok ? undefined : result.reason).toEqual({ kind: "tool-error", exitCode: null });
  });

  test("a plan JSON that is not JSON, or of another major format version", async () => {
    for (const stdout of ["not json", '{"format_version":"2.0","resource_changes":[]}']) {
      const { run } = answering(exited(""), exited(stdout));
      const result = await opentofu.preview(DEV, options(run));
      expect(result.ok ? undefined : result.reason).toEqual({ kind: "unreadable-output" });
    }
  });

  test("an errored plan is never shown as in sync", async () => {
    const { run } = answering(
      exited(""),
      exited('{"format_version":"1.2","errored":true,"resource_changes":[]}'),
    );
    const result = await opentofu.preview(DEV, options(run));
    expect(result.ok ? undefined : result.reason).toEqual({ kind: "unreadable-output" });
  });

  test("an action Sluiceway does not know fails the preview, and the detail quotes nothing", async () => {
    const plan = {
      format_version: "1.2",
      resource_changes: [
        {
          address: "x.y",
          mode: "managed",
          type: "x",
          name: "y",
          change: { actions: ["create", "forget"], before: null, after: { v: "CANARY-VALUE" } },
        },
      ],
    };
    const { run } = answering(exited(""), exited(JSON.stringify(plan)));
    const result = await opentofu.preview(DEV, options(run));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toEqual({ kind: "unknown-step" });
    expect(result.detail).toEqual([
      "The tool's output, at resource_changes[0].change.actions: expected actions that Sluiceway knows.",
    ]);
  });

  test("a deposed object has an address of its own", async () => {
    const plan = {
      format_version: "1.2",
      resource_changes: [
        { address: "x.y", mode: "managed", type: "x", name: "y", change: { actions: ["create"] } },
        {
          address: "x.y",
          deposed: "00000001",
          mode: "managed",
          type: "x",
          name: "y",
          change: { actions: ["delete"], before: {} },
        },
      ],
    };
    const { run } = answering(exited(""), exited(JSON.stringify(plan)));
    expect(changes(await opentofu.preview(DEV, options(run)))).toEqual([
      { address: "x.y", type: "x", name: "y", op: "create", changedKeys: [], replaceKeys: [] },
      {
        address: "x.y deposed 00000001",
        type: "x",
        name: "y (deposed 00000001)",
        op: "delete",
        changedKeys: [],
        replaceKeys: [],
      },
    ]);
  });

  test("a resource in a module and under for_each is named by its module and key", async () => {
    const plan = {
      format_version: "1.2",
      resource_changes: [
        {
          address: 'module.web.local_file.page["index"]',
          module_address: "module.web",
          mode: "managed",
          type: "local_file",
          name: "page",
          index: "index",
          change: { actions: ["create"] },
        },
      ],
    };
    const { run } = answering(exited(""), exited(JSON.stringify(plan)));
    expect(changes(await opentofu.preview(DEV, options(run)))).toEqual([
      {
        address: 'module.web.local_file.page["index"]',
        type: "local_file",
        name: 'module.web.page["index"]',
        op: "create",
        changedKeys: [],
        replaceKeys: [],
      },
    ]);
  });
});
