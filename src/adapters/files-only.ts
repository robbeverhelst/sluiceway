import type { Adapter } from "./adapter.ts";
import { discoverAll } from "./discover-all.ts";
import { readsFiles } from "./file-references.ts";
import { explainRootModules } from "./opentofu/root-modules.ts";

// Of every tool, what the check uses: discovery, what root module discovery
// left out and why (record 0092), and what a stack's own files name as read
// (record 0074). Nothing here starts a tool (record 0042), so the check job
// and the command line (record 0094) hand the check the same thing.
export const filesOnly: Pick<Adapter, "discover" | "readsFiles" | "explainDiscovery"> = {
  discover: discoverAll,
  explainDiscovery: async (root, config) => explainRootModules(root, config),
  readsFiles,
};
