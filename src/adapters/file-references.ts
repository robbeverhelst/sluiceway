import type { Stack } from "../core/stack.ts";
import type { FileReference } from "./adapter.ts";
import { readsFiles as helmReads } from "./helm/file-references.ts";
import { isHelmOptions } from "./helm/options.ts";
import { isKubectlOptions } from "./kubectl/options.ts";
import { isOpenTofuOptions } from "./opentofu/options.ts";
import { readsFiles as pulumiReads } from "./pulumi/file-references.ts";

// The files each tool's stacks name as read (record 0074), on its own like
// discover-all.ts, so that the check job reaches files and nothing that
// starts a tool. Pulumi and Helm can tell. OpenTofu and Kubernetes manifests
// stacks answer nothing yet (docs/later.md).
export async function readsFiles(root: string, stack: Stack): Promise<FileReference[]> {
  if (isHelmOptions(stack.options)) return helmReads(root, stack);
  if (isOpenTofuOptions(stack.options) || isKubectlOptions(stack.options)) return [];
  return pulumiReads(root, stack);
}
