// The command lines of the OpenTofu adapter, checked against the OpenTofu
// docs of v1.11 and v1.12 (record 0053). Nothing but these reaches the tool:
// there are no free-form arguments (record 0015), and the var files are the
// one named option that changes a command line.
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

export function initCommand(): string[] {
  return [TOFU, "init", "-input=false", "-no-color"];
}

export function planCommand(planFile: string, varFiles: string[]): string[] {
  return [
    TOFU,
    "plan",
    "-input=false",
    "-no-color",
    "-refresh=false",
    "-json",
    `-out=${planFile}`,
    ...varFiles.map((file) => `-var-file=${file}`),
  ];
}

export function showCommand(planFile: string): string[] {
  return [TOFU, "show", "-json", "-no-color", planFile];
}

// The saved plan is the approval, so no -auto-approve, and it takes no
// planning options: the var files are in the plan (OpenTofu docs, "apply").
export function applyCommand(planFile: string): string[] {
  return [TOFU, "apply", "-input=false", "-no-color", "-json", planFile];
}

// The tool's own diff (record 0048): the plan as the tool displays it, with
// "(sensitive value)" for what it holds as sensitive. The preview's plan
// without -json and without a plan file.
export function toolDiffCommand(varFiles: string[]): string[] {
  return [
    TOFU,
    "plan",
    "-input=false",
    "-no-color",
    "-refresh=false",
    ...varFiles.map((file) => `-var-file=${file}`),
  ];
}

export function versionCommand(): string[] {
  return [TOFU, "version", "-json"];
}
