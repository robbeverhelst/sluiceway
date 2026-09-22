import type { ExitCodes } from "../tool-run.ts";
import type { KubectlOptions } from "./options.ts";

// The command lines of the Kubernetes manifests adapter, checked against the
// kubectl reference on kubernetes.io and kubectl's source on 2026-09-22
// (record 0060). Nothing but these reaches the tool: there are no free-form
// arguments (record 0015), and the context and the namespace are the named
// options that change a command line.
//
// - The preview and the deploy read the same rendered set, one file, so the
//   deploy applies exactly what the preview diffed.
// - `--server-side` on both: the preview is a server-side apply run as a dry
//   run, and the deploy is that apply. Both use kubectl's field manager for a
//   server-side apply, "kubectl", so the preview meets the same conflicts as
//   the deploy. There is no --force-conflicts: a field another manager owns
//   fails the preview, before anyone ticks.
// - No --prune: kubectl's pruning is still alpha and does not see an object
//   a server-side apply made. With the prune option Sluiceway prunes itself,
//   from the inventory it keeps next to the objects (record 0070).
// - --force-conflicts and --field-manager only when the stack's options say
//   so, and then on the preview, the drift check and the deploy alike
//   (record 0070).
// - Secrets stay masked: never --show-secrets.

export const KUBECTL_COMMAND = "kubectl";

function target(options: KubectlOptions): string[] {
  return [
    ...(options.context === undefined ? [] : [`--context=${options.context}`]),
    ...(options.namespace === undefined ? [] : [`--namespace=${options.namespace}`]),
  ];
}

// Renders a kustomization, run in the stack's directory. It reads files and
// reaches no cluster.
export function kustomizeCommand(): string[] {
  return [KUBECTL_COMMAND, "kustomize", "."];
}

// What makes a server-side apply of this stack: who applies, and whether it
// takes a field that another field manager holds.
function applier(options: KubectlOptions): string[] {
  return [
    ...(options.forceConflicts === true ? ["--force-conflicts"] : []),
    ...(options.fieldManager === undefined ? [] : [`--field-manager=${options.fieldManager}`]),
  ];
}

// Exit code 0: no differences. 1: differences. Above 1: kubectl or diff
// failed (kubectl reference, "kubectl diff"), a tool error with the code.
export const DIFF_EXIT_CODES: ExitCodes = { success: [0, 1] };

// The drift check asks for the field managers of both sides as well (record
// 0070).
export function diffCommand(
  file: string,
  options: KubectlOptions,
  extra: { managedFields?: boolean } = {},
): string[] {
  return [
    KUBECTL_COMMAND,
    "diff",
    "--server-side",
    ...target(options),
    ...applier(options),
    ...(extra.managedFields === true ? ["--show-managed-fields"] : []),
    "-f",
    file,
  ];
}

export function applyCommand(file: string, options: KubectlOptions): string[] {
  return [
    KUBECTL_COMMAND,
    "apply",
    "--server-side",
    ...target(options),
    ...applier(options),
    "-f",
    file,
  ];
}

// The stack's inventory, the ConfigMap that lists what the stack deployed
// (record 0070). Nothing at all when there is none yet.
export function inventoryCommand(name: string, options: KubectlOptions): string[] {
  return [
    KUBECTL_COMMAND,
    "get",
    "configmap",
    name,
    ...target(options),
    "--ignore-not-found",
    "--output=json",
  ];
}

// The live objects a file names, with who holds each field. One object, a
// List of several, or nothing when none is there.
export function liveCommand(file: string, options: KubectlOptions): string[] {
  return [
    KUBECTL_COMMAND,
    "get",
    ...target(options),
    "--ignore-not-found",
    "--show-managed-fields",
    "--output=json",
    "-f",
    file,
  ];
}

// The deploy's pruning: the objects of the prune file, and one that went in
// the meantime is no error.
export function deleteCommand(file: string, options: KubectlOptions): string[] {
  return [KUBECTL_COMMAND, "delete", ...target(options), "--ignore-not-found", "-f", file];
}

// The client only: the version check reaches no cluster.
export function versionCommand(): string[] {
  return [KUBECTL_COMMAND, "version", "--client", "--output=json"];
}

// The diff program kubectl runs for the preview. The whole object on both
// sides, not three lines around a change, so the adapter can read every
// object whole from one hunk. kubectl passes an argument only when it is
// letters, digits, "-" and "=". A context of a million lines and not the
// largest number: Apple's diff repeats hunks when the context is 2^31 - 1.
export const PREVIEW_DIFF = "diff -N -U1000000";
