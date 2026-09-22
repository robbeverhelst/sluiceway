import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import * as core from "@actions/core";

// The job log, the annotations and the summary of the run. Modes write all
// three through this, and a test hands them one that remembers.
export interface JobLog {
  info(line: string): void;
  // A foldable group of lines under a title. `verbatim` is the tool's own
  // diff (record 0048): printed after the lines with the runner's workflow
  // commands stopped, so no line of it can act as one.
  group(title: string, lines: string[], verbatim?: string[]): void;
  // A warning annotation on the run (record 0012). Sluiceway's own words only,
  // because annotations show on the run's summary page (record 0022).
  warning(message: string, title: string): void;
  // The whole summary of this step. A second call takes the place of the
  // first. Fails when the runner gave the step no summary file, or it cannot
  // be written. A scan goes on without it (record 0037).
  writeSummary(text: string): Promise<void>;
}

export function actionsLog(): JobLog {
  return {
    info: (line) => core.info(line),
    group(title, lines, verbatim = []) {
      core.startGroup(title);
      for (const line of lines) core.info(line);
      if (verbatim.length > 0) {
        // The runner reads no workflow command until it sees the token again,
        // and the token is new for every group, so no text before it can
        // know it (record 0048). Masks still apply.
        const token = randomUUID();
        core.info(`::stop-commands::${token}`);
        for (const line of verbatim) core.info(line);
        core.info(`::${token}::`);
      }
      core.endGroup();
    },
    warning: (message, title) => core.warning(message, { title }),
    async writeSummary(text) {
      // The file belongs to this step alone, so nothing of another step is
      // lost. The path is read at every write, not once: an auto step writes
      // the summary of each mode it runs, and @actions/core would keep the
      // path it first saw (record 0077).
      const file = process.env.GITHUB_STEP_SUMMARY;
      if (!file) {
        throw new Error(
          "The runner gave this step no summary file (GITHUB_STEP_SUMMARY is not set).",
        );
      }
      await writeFile(file, text, "utf8");
    },
  };
}
