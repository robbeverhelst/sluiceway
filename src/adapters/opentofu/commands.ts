import { join } from "node:path";
import type { Stack } from "../../core/stack.ts";
import { optionsOf } from "./environment.ts";
import { type FamilyTool, TERRAFORM, TERRAGRUNT } from "./options.ts";

// The command lines of the Terraform family (records 0053 and 0068), checked
// against the OpenTofu docs of v1.11 and v1.12, the Terraform docs of v1.14
// and v1.16, the help of Terragrunt v1.0 and v1.1 and of cdktf v0.21. Nothing
// but these reaches a tool: there are no free-form arguments (record 0015),
// and the var files are the one named option that changes a command line.
//
// - `-input=false` everywhere, so nothing waits for a person.
// - `-no-color`, because the words go to the job log.
// - `-refresh=false` on the plan: a preview compares code with state and
//   never reads every real object (record 0015). The plan file keeps it, so
//   the deploy of that plan does not refresh either.
// - `-json` on the plan and the deploy: the tool's human output of both prints
//   values, so only its diagnostics and progress messages are kept from the
//   JSON log. The plan's changes come from `show -json` of the plan file.

export const TOFU = "tofu";
export type Binary = "tofu" | "terraform";

export function binaryOf(tool: FamilyTool): Binary {
  return tool === TERRAFORM ? "terraform" : TOFU;
}

// Terragrunt runs the tool in one unit (Terragrunt docs, "run"), never
// `run --all`: one unit is one stack. `--tf-path` names the binary of the
// entry's tool, whatever TG_TF_PATH says. `--tf-forward-stdout` hands on the
// tool's stdout as it is, where Terragrunt would otherwise fold it into its
// own log, so the JSON stays JSON. `--no-auto-init`, because an init inside a
// preview would run side by side with others (record 0053): the preparation
// runs every init, one at a time.
const TERRAGRUNT_RUN = ["run", "--tf-forward-stdout", "--no-color", "--no-auto-init"];

// The command line of one step of a stack: the tool's own, or the same behind
// Terragrunt. A CDK for Terraform stack runs the tool itself, in the
// directory cdktf synth wrote (see workingDirectory).
export function command(stack: Stack, args: string[]): string[] {
  const { tool, wrapper } = optionsOf(stack);
  const binary = binaryOf(tool);
  if (wrapper !== TERRAGRUNT) return [binary, ...args];
  return [TERRAGRUNT, ...TERRAGRUNT_RUN, "--tf-path", binary, "--", ...args];
}

// Where cdktf synth writes a stack (cdktf docs, "synth": the default output
// directory, and a directory per stack under stacks/). Sluiceway passes the
// same directory with --output, so no cdktf.json setting moves it.
export const CDKTF_OUT = "cdktf.out";

export function workingDirectory(root: string, stack: Stack): string {
  if (optionsOf(stack).wrapper === "cdktf") {
    return join(root, stack.path, CDKTF_OUT, "stacks", stack.name ?? "");
  }
  return join(root, stack.path);
}

export function initArgs(): string[] {
  return ["init", "-input=false", "-no-color"];
}

export function planArgs(planFile: string, varFiles: string[]): string[] {
  return [
    "plan",
    "-input=false",
    "-no-color",
    "-refresh=false",
    "-json",
    `-out=${planFile}`,
    ...varFiles.map((file) => `-var-file=${file}`),
  ];
}

export function showArgs(planFile: string): string[] {
  return ["show", "-json", "-no-color", planFile];
}

// The saved plan is the approval, so no -auto-approve, and it takes no
// planning options: the var files are in the plan (OpenTofu docs, "apply").
export function applyArgs(planFile: string): string[] {
  return ["apply", "-input=false", "-no-color", "-json", planFile];
}

// The tool's own diff (record 0048): the plan as the tool displays it, with
// "(sensitive value)" for what it holds as sensitive. The preview's plan
// without -json and without a plan file.
export function toolDiffArgs(varFiles: string[]): string[] {
  return [
    "plan",
    "-input=false",
    "-no-color",
    "-refresh=false",
    ...varFiles.map((file) => `-var-file=${file}`),
  ];
}

export function versionCommand(binary: Binary = TOFU): string[] {
  return [binary, "version", "-json"];
}

export function terragruntVersionCommand(): string[] {
  return [TERRAGRUNT, "--version"];
}

export function cdktfVersionCommand(): string[] {
  return ["cdktf", "--version"];
}

// Writes every stack of a CDK for Terraform app as Terraform JSON, into
// cdktf.out/stacks/<name>. It runs the app, the command cdktf.json names, so
// the app's language and packages are the workflow's to prepare (record
// 0013).
export function synthCommand(): string[] {
  return ["cdktf", "synth", "--output", CDKTF_OUT];
}
