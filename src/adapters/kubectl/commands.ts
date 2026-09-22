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
// - No --prune: kubectl's pruning is still alpha. An object taken out of the
//   manifests stays in the cluster, and the diff never shows a delete.
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

// Exit code 0: no differences. 1: differences. Above 1: kubectl or diff
// failed (kubectl reference, "kubectl diff").
export function diffCommand(file: string, options: KubectlOptions): string[] {
  return [KUBECTL_COMMAND, "diff", "--server-side", ...target(options), "-f", file];
}

export function applyCommand(file: string, options: KubectlOptions): string[] {
  return [KUBECTL_COMMAND, "apply", "--server-side", ...target(options), "-f", file];
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
