import { configFileName } from "../core/config-file.ts";
import { type CredentialNeed, cloudWays } from "../core/credentials.ts";
import type { Stack } from "../core/stack.ts";
import { isHelmOptions } from "./helm/options.ts";
import { isKubectlOptions } from "./kubectl/options.ts";
import { credentialNeeds as tofuNeeds } from "./opentofu/credentials.ts";
import { isOpenTofuOptions } from "./opentofu/options.ts";
import { credentialNeeds as pulumiNeeds } from "./pulumi/credentials.ts";

// What each tool's stacks say, in their own files, the tool will want from
// the job environment (record 0099), on its own like file-references.ts, so
// that the check job and the command line reach files and nothing that
// starts a tool. A Helm release and a Kubernetes manifests stack want one
// thing, the cluster, and the entry that declares them is what names it.
export async function credentialNeeds(root: string, stack: Stack): Promise<CredentialNeed[]> {
  if (isHelmOptions(stack.options) || isKubectlOptions(stack.options)) {
    return [
      {
        what: "the cluster",
        namedIn: configFileName(root) ?? "sluiceway.yaml",
        ways: cloudWays("kubernetes"),
      },
    ];
  }
  if (isOpenTofuOptions(stack.options)) return tofuNeeds(root, stack);
  return pulumiNeeds(root, stack);
}
