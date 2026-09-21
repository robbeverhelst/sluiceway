// Step outputs and the result file as a test sees them: every output the mode
// set, in order, and the result file written to a directory of the test's own.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type OutputName, resultFileName, type StepOutputs } from "../../src/github/outputs.ts";

export interface RememberingOutputs extends StepOutputs {
  // The last value of every output, as the runner keeps it.
  values: Partial<Record<OutputName, string>>;
  // Every call, in order.
  calls: [OutputName, string][];
  directory: string;
  // The result file as JSON, or nothing when none was written.
  resultFile(mode: "scan" | "apply"): unknown;
}

export function rememberingOutputs(options: { noTemp?: boolean } = {}): RememberingOutputs {
  const directory = mkdtempSync(join(tmpdir(), "sluiceway-outputs-"));
  const outputs: RememberingOutputs = {
    values: {},
    calls: [],
    directory,
    set(name, value) {
      outputs.calls.push([name, value]);
      outputs.values[name] = value;
    },
    writeResultFile(mode, text) {
      if (options.noTemp) throw new Error("RUNNER_TEMP is not set");
      const path = join(directory, resultFileName(mode));
      writeFileSync(path, text);
      return path;
    },
    resultFile(mode) {
      try {
        return JSON.parse(readFileSync(join(directory, resultFileName(mode)), "utf8"));
      } catch {
        return undefined;
      }
    },
  };
  return outputs;
}
