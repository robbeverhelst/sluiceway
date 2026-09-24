// The words of the job log for the env file (record 0100): which names were
// loaded, which got no mask and why, and which the file replaced. Names only,
// never a value.

import { unmaskedReason } from "../core/env-file.ts";

export function envFileGroupTitle(path: string): string {
  return `Loaded the env file ${path}`;
}

export const ENV_FILE_EMPTY = "No value: the file has no NAME=value line.";

export function envFileLines(values: Record<string, string>, replaced: string[]): string[] {
  const names = Object.keys(values);
  if (names.length === 0) return [ENV_FILE_EMPTY];
  const masked = names.filter((name) => unmaskedReason(values[name] ?? "") === undefined);
  const unmasked = names
    .filter((name) => !masked.includes(name))
    .map((name) => `${name} (${unmaskedReason(values[name] ?? "")})`);
  return [
    `${names.length} ${names.length === 1 ? "value" : "values"} for the tool: ${names.join(", ")}.`,
    ...(masked.length > 0 ? [`Masked: ${masked.join(", ")}.`] : []),
    ...(unmasked.length > 0 ? [`Not masked: ${unmasked.join(", ")}.`] : []),
    ...(replaced.length > 0
      ? [`The file wins over the job environment for: ${replaced.join(", ")}.`]
      : []),
  ];
}
