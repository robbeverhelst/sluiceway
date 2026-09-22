import { describe, expect, test } from "bun:test";
import { ToolVersionError } from "../../../src/adapters/adapter.ts";
import { opentofu } from "../../../src/adapters/opentofu/index.ts";
import { tools } from "../../../src/adapters/tools.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, ROOT } from "./replay.ts";
import { DEV } from "./stacks.ts";

// The version check of the Terraform family (record 0068): each binary the
// stacks at hand need, once, against its own floor. A wrapper needs its own
// tool and the binary behind it.

const context = (run: Parameters<typeof opentofu.checkVersion>[0]["run"]) => ({
  root: ROOT,
  env: { PATH: "/usr/bin" },
  run,
});

const stack = (tool: string, wrapper?: string, name?: string): Stack => ({
  path: "infra",
  ...(name === undefined ? {} : { name }),
  options: { tool, varFiles: [], ...(wrapper === undefined ? {} : { wrapper }) },
});

const exited = (stdout: string) => ({ status: "exited" as const, exitCode: 0, stdout, stderr: "" });
const TOFU = exited('{"terraform_version":"1.12.6"}');
const TERRAFORM = exited('{"terraform_version":"1.16.3","terraform_outdated":false}');
const TERRAGRUNT = exited("terragrunt version v1.1.6\n");
const CDKTF = exited("0.21.0\n");

describe("the binaries a check runs", () => {
  test("terraform for a terraform stack, never tofu", async () => {
    const { run, runs } = answering(TERRAFORM);
    await opentofu.checkVersion(context(run), [stack("terraform")]);
    expect(runs.map((one) => one.argv)).toEqual([["terraform", "version", "-json"]]);
  });

  test("tofu and terraform once each, for a repo with both", async () => {
    const { run, runs } = answering(TOFU, TERRAFORM);
    await opentofu.checkVersion(context(run), [DEV, stack("terraform"), stack("terraform")]);
    expect(runs.map((one) => one.argv[0])).toEqual(["tofu", "terraform"]);
  });

  test("terragrunt and the binary behind it", async () => {
    const { run, runs } = answering(TERRAFORM, TERRAGRUNT);
    await opentofu.checkVersion(context(run), [stack("terraform", "terragrunt")]);
    expect(runs.map((one) => one.argv)).toEqual([
      ["terraform", "version", "-json"],
      ["terragrunt", "--version"],
    ]);
  });

  test("cdktf and the binary behind it", async () => {
    const { run, runs } = answering(TOFU, CDKTF);
    await opentofu.checkVersion(context(run), [stack("opentofu", "cdktf", "dev")]);
    expect(runs.map((one) => one.argv)).toEqual([
      ["tofu", "version", "-json"],
      ["cdktf", "--version"],
    ]);
  });

  test("the modes' adapter sends terraform stacks here and needs no pulumi for them", async () => {
    const { run, runs } = answering(TERRAFORM);
    await tools.checkVersion(context(run), [stack("terraform")]);
    expect(runs.map((one) => one.argv[0])).toEqual(["terraform"]);
  });
});

describe("the floors", () => {
  test("terraform older than v1.14.0", async () => {
    const { run } = answering(exited('{"terraform_version":"1.13.5"}'));
    await expect(opentofu.checkVersion(context(run), [stack("terraform")])).rejects.toThrow(
      new ToolVersionError(
        "Found terraform v1.13.5. Sluiceway needs terraform v1.14.0 or newer. Change the workflow step that installs terraform so it installs a newer version.",
      ),
    );
  });

  test("terragrunt older than v1.0.0", async () => {
    const { run } = answering(TERRAFORM, exited("terragrunt version v0.99.1\n"));
    await expect(
      opentofu.checkVersion(context(run), [stack("terraform", "terragrunt")]),
    ).rejects.toThrow(
      "Found terragrunt v0.99.1. Sluiceway needs terragrunt v1.0.0 or newer. Change the workflow step that installs terragrunt so it installs a newer version.",
    );
  });

  test("a cdktf that is not there", async () => {
    const { run } = answering(TOFU, { status: "not-started" });
    await expect(
      opentofu.checkVersion(context(run), [stack("opentofu", "cdktf", "dev")]),
    ).rejects.toThrow(
      "Could not start cdktf. Sluiceway needs cdktf v0.21.0 or newer on PATH and does not install it. Add a workflow step that installs cdktf before the step that runs Sluiceway.",
    );
  });

  test("terragrunt output that is not a version keeps its words for the job log", async () => {
    const { run } = answering(TOFU, exited("something else\n"));
    const error = await opentofu
      .checkVersion(context(run), [stack("opentofu", "terragrunt")])
      .catch((thrown) => thrown);
    expect(error).toBeInstanceOf(ToolVersionError);
    expect((error as ToolVersionError).message).toBe(
      '"terragrunt --version" did not print a version Sluiceway can read. Sluiceway needs terragrunt v1.0.0 or newer. The job log holds what the tool printed.',
    );
    expect((error as ToolVersionError).toolLog).toBe("something else\n");
  });
});
