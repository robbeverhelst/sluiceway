import type { Stack } from "../../core/stack.ts";
import { toolEnvironment } from "../environment.ts";
import type { KubectlStackOptions } from "./options.ts";

// The whole environment of the job reaches kubectl (record 0013): KUBECONFIG
// and whatever a credential plugin of the kubeconfig reads. The preview alone
// sets KUBECTL_EXTERNAL_DIFF, because the adapter reads the diff program's
// output and has to know its form. The tool diff and the deploy get the
// environment as it is.
export function kubectlEnvironment(
  env: Record<string, string | undefined>,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { ...toolEnvironment(env), ...extra };
}

export function optionsOf(stack: Stack): KubectlStackOptions {
  return stack.options as unknown as KubectlStackOptions;
}
