import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { readApplyInputs, readScanInputs } from "../src/github/inputs.ts";
import { MODES } from "../src/mode.ts";

const ROOT = resolve(import.meta.dir, "..");

type ActionMetadata = {
  inputs: Record<string, { description: string; required?: boolean; default?: string }>;
  outputs: Record<string, { description: string }>;
  runs: { using: string; main: string; post?: string; "post-if"?: string };
  branding?: { icon?: string; color?: string };
};

const action = Bun.YAML.parse(await Bun.file(resolve(ROOT, "action.yml")).text()) as ActionMetadata;

describe("action.yml", () => {
  test("runs the committed bundle on node24", () => {
    expect(action.runs.using).toBe("node24");
    expect(existsSync(resolve(ROOT, action.runs.main))).toBe(true);
  });

  // Record 0077: a cancelled one-job run settles in the post step. The file
  // is written by hand and loads the one bundle.
  test("has a post step that runs always and loads the same bundle", () => {
    expect(action.runs.post).toBe("dist/post.js");
    expect(action.runs["post-if"]).toBe("always()");
    const post = readFileSync(resolve(ROOT, "dist/post.js"), "utf8");
    expect(post).toContain("globalThis.sluicewayPost = true;");
    expect(post).toContain('await import("./index.js");');
  });

  // The line of the build plan, section 5. Growing past it is a question for
  // the owner, so CI fails here first. The dist check holds the committed
  // bundle to the source, so this is the size of what the source builds.
  test("the committed bundle stays under 3 MB", () => {
    expect(statSync(resolve(ROOT, action.runs.main)).size).toBeLessThanOrEqual(3_000_000);
  });

  test("the defaults of the scan inputs are the ones of the build plan, and the scan can read them", () => {
    const defaults = (name: string) => action.inputs[name]?.default ?? "";
    expect(readScanInputs((name) => (name === "github-token" ? "token" : defaults(name)))).toEqual({
      concurrency: undefined,
      previewTimeoutMinutes: 10,
      token: "token",
      strict: false,
    });
  });

  // Record 0084: an empty optional input means its default, so a workflow
  // that passes an input through from its own dispatch inputs reads what
  // action.yml would have given. The defaults live in both places, and this
  // holds them together.
  test("an empty optional input reads as the default action.yml gives it", () => {
    const defaults = (name: string) => action.inputs[name]?.default ?? "";
    const token = (name: string) => (name === "github-token" ? "token" : "");
    const empty = (name: string) => token(name);
    expect(readScanInputs(empty)).toEqual(readScanInputs((name) => token(name) || defaults(name)));
    const apply = (read: (name: string) => string) => (name: string) =>
      name === "deployment-id" ? "12" : read(name);
    expect(readApplyInputs(apply(empty))).toEqual(
      readApplyInputs(apply((name) => token(name) || defaults(name))),
    );
  });

  // Slice 5.21 (record 0085): a default in action.yml would reach the step as
  // if the workflow had set it, and the pool could never follow the machine.
  test("concurrency has no default, so the pool follows the cores of the machine", () => {
    expect(action.inputs.concurrency?.required).toBe(false);
    expect(action.inputs.concurrency?.default).toBeUndefined();
  });

  // Record 0044: the id of the running job is in no variable of its
  // environment. As the default of an input it costs no permission, and the
  // lab saw it equal the job's id on real GitHub on 2026-09-21.
  test("takes the id of the running job from job.check_run_id", () => {
    expect(action.inputs["job-id"]?.default).toBe("${{ job.check_run_id }}");
    expect(action.inputs["job-id"]?.required).toBe(false);
  });

  // Slice 5.12 (record 0077): a step without a mode picks its own.
  test("the mode input is optional, auto by default, and names every mode", () => {
    expect(action.inputs.mode?.required).toBe(false);
    expect(action.inputs.mode?.default).toBe("auto");
    for (const mode of MODES) {
      expect(action.inputs.mode?.description).toContain(mode);
    }
  });

  // Records 0035 and 0041, with the modes that set each one (build plan,
  // section 3).
  test("declares the outputs of the build plan, each naming the modes that set it", () => {
    const modes: Record<string, string[]> = {
      // The scan's after a merge from the dashboard (record 0054).
      matrix: ["scan", "resolve"],
      "dashboard-url": ["scan", "apply", "settle"],
      pending: ["scan"],
      "preview-failed": ["scan"],
      "in-sync": ["scan"],
      "dashboard-changed": ["scan"],
      outcome: ["apply"],
      stack: ["apply"],
      "result-file": ["scan", "apply"],
    };
    expect(Object.keys(action.outputs)).toEqual(Object.keys(modes));
    for (const [name, setBy] of Object.entries(modes)) {
      const description = action.outputs[name]?.description ?? "";
      const named: string[] = MODES.filter((mode) =>
        new RegExp(`\\b${mode}\\b`).test(description.split(".")[0] ?? ""),
      );
      expect([name, named]).toEqual([name, setBy]);
    }
  });

  // Record 0035: the five inputs of v1, `job-id` of record 0044, the four
  // channels of record 0078, and the env file of record 0100.
  test("declares only the inputs the decision records fix", () => {
    expect(Object.keys(action.inputs).sort()).toEqual([
      "backend",
      "concurrency",
      "deploy-timeout",
      "deployment-id",
      "dry-run",
      "env-file",
      "github-token",
      "job-id",
      "mode",
      "preview-timeout",
      "pull-request-preview",
      "slack-webhook-url",
      "strict",
      "telegram-bot-token",
      "telegram-chat-id",
      "webhook-url",
    ]);
  });

  // Required in apply mode only, which the action checks itself: GitHub reads
  // `required` for no mode in particular.
  test("deployment-id has no default and is not required by GitHub", () => {
    expect(action.inputs["deployment-id"]?.required).toBe(false);
    expect(action.inputs["deployment-id"]?.default).toBeUndefined();
    expect(action.inputs["deployment-id"]?.description).toContain("apply");
  });

  // Record 0051: a rehearsal of apply. Off unless a workflow turns it on.
  test("dry-run is false by default and belongs to apply", () => {
    expect(action.inputs["dry-run"]?.required).toBe(false);
    expect(action.inputs["dry-run"]?.default).toBe("false");
    expect(action.inputs["dry-run"]?.description).toContain("apply");
  });

  // Record 0100: the env file is empty by default, and the description names
  // the modes that read it and says that every value is masked.
  test("env-file has no default and names the modes that read it", () => {
    expect(action.inputs["env-file"]?.required).toBe(false);
    expect(action.inputs["env-file"]?.default).toBeUndefined();
    const description = action.inputs["env-file"]?.description ?? "";
    for (const word of ["scan", "apply", "backend: true", "mask"]) {
      expect(description).toContain(word);
    }
  });

  // Record 0074: the check asks the backend only when a workflow says so.
  test("backend is false by default and belongs to check", () => {
    expect(action.inputs.backend?.required).toBe(false);
    expect(action.inputs.backend?.default).toBe("false");
    expect(action.inputs.backend?.description).toContain("check");
  });

  // The Marketplace shows an action with its icon on its colour, and GitHub
  // refuses a name outside its own lists. The icon is a Feather icon from the
  // list GitHub allows, the colour one of the nine it names.
  test("has a branding block that GitHub allows: the droplet on blue", async () => {
    const icons = (await Bun.file(resolve(ROOT, "test/fixtures/github/action-icons.txt")).text())
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"));
    const colors = [
      "white",
      "black",
      "yellow",
      "blue",
      "green",
      "orange",
      "red",
      "purple",
      "gray-dark",
    ];
    expect(icons).toContain(action.branding?.icon ?? "");
    expect(colors).toContain(action.branding?.color ?? "");
    expect(action.branding).toEqual({ icon: "droplet", color: "blue" });
  });
});
