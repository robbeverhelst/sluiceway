import { join, normalize } from "node:path";
import type { Stack } from "../../core/stack.ts";
import type { FileReference } from "../adapter.ts";
import type { HelmStackOptions } from "./options.ts";

// The files of the repo a Helm stack reads (record 0074): its local chart and
// its values files, both named in its `stacks` entry, which discovery already
// found inside the repo and there (record 0058). The check suggests the ones
// the stack does not claim as inputs.
export async function readsFiles(_root: string, stack: Stack): Promise<FileReference[]> {
  const options = stack.options as unknown as HelmStackOptions;
  const namedIn = "sluiceway.yaml";
  const chart: FileReference[] =
    options.chartDir === undefined || options.chartDir === "."
      ? []
      : [{ path: options.chartDir, kind: "directory", namedIn }];
  const values = options.valuesFiles.map(
    (file): FileReference => ({
      path: normalize(join(stack.path, file)).split("\\").join("/"),
      kind: "file",
      namedIn,
    }),
  );
  return [...chart, ...values];
}
