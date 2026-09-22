import type { Adapter } from "../adapter.ts";
import { apply } from "./apply.ts";
import { findInBackend } from "./backend.ts";
import { discover } from "./discover.ts";
import { detectDrift } from "./drift.ts";
import { readsFiles } from "./file-references.ts";
import { deployHistory } from "./history.ts";
import { previewWithReferences } from "./preview.ts";
import { readDependencies } from "./references.ts";
import { toolDiff } from "./tool-diff.ts";
import { checkVersion } from "./version.ts";

// A preview that was asked for the stacks it depends on turns its stack
// references into stack ids of the repo (record 0059). That reads project
// files, so it happens here and not in the preview, which reaches no disk.
const preview: Adapter["preview"] = async (stack, options) => {
  const { result, references } = await previewWithReferences(stack, options);
  if (!result.ok || options.dependencies === undefined) return result;
  const dependencies = await readDependencies(
    stack,
    references,
    options.root,
    options.dependencies,
  );
  return { ...result, dependencies };
};

export const pulumi: Adapter = {
  discover,
  checkVersion,
  preview,
  toolDiff,
  detectDrift,
  deployHistory,
  apply,
  readsFiles,
  findInBackend,
};
