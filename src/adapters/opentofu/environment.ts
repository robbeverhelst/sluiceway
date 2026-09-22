import type { Stack } from "../../core/stack.ts";
import { toolEnvironment } from "../environment.ts";
import type { OpenTofuStackOptions } from "./options.ts";

// Sluiceway sets only what makes the tool behave in CI and what the stack's
// named options say (records 0013 and 0053). Every TF_* variable of the job
// reaches the tool as it is: TF_VAR_*, TF_CLI_CONFIG_FILE, TF_ENCRYPTION,
// TF_PLUGIN_CACHE_DIR and the rest. A workspace named in the options is set
// for every command of the stack, so the plan, its JSON and the deploy of the
// saved plan always name the same one.
export function tofuEnvironment(
  env: Record<string, string | undefined>,
  stack?: Stack,
): Record<string, string> {
  const workspace = stack === undefined ? undefined : optionsOf(stack).workspace;
  return {
    ...toolEnvironment(env),
    // Keeps the tool from suggesting commands to run next (OpenTofu docs,
    // "Environment Variables").
    TF_IN_AUTOMATION: "true",
    ...(workspace === undefined ? {} : { TF_WORKSPACE: workspace }),
  };
}

export function optionsOf(stack: Stack): OpenTofuStackOptions {
  return stack.options as unknown as OpenTofuStackOptions;
}
