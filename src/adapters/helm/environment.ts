import type { Stack } from "../../core/stack.ts";
import { toolEnvironment } from "../environment.ts";
import type { HelmStackOptions } from "./options.ts";

// Helm gets the job's environment as it is (records 0013 and 0058):
// KUBECONFIG and the cloud credentials that a kubeconfig's exec plugin reads,
// HELM_* such as HELM_REGISTRY_CONFIG after a `helm registry login`, and the
// plugin's own HELM_DIFF_* settings. Sluiceway sets nothing: every flag it
// needs is on the command line.
export function helmEnvironment(env: Record<string, string | undefined>): Record<string, string> {
  return toolEnvironment(env);
}

export function optionsOf(stack: Stack): HelmStackOptions {
  return stack.options as unknown as HelmStackOptions;
}
