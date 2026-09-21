import type { Adapter } from "../adapter.ts";
import { apply } from "./apply.ts";
import { discover } from "./discover.ts";
import { preview } from "./preview.ts";
import { toolDiff } from "./tool-diff.ts";
import { checkVersion } from "./version.ts";

export const pulumi: Adapter = { discover, checkVersion, preview, toolDiff, apply };
