import * as core from "@actions/core";

// The job log, the annotations and the summary of the run. Modes write all
// three through this, and a test hands them one that remembers.
export interface JobLog {
  info(line: string): void;
  // A foldable group of lines under a title.
  group(title: string, lines: string[]): void;
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
    group(title, lines) {
      core.startGroup(title);
      for (const line of lines) core.info(line);
      core.endGroup();
    },
    warning: (message, title) => core.warning(message, { title }),
    async writeSummary(text) {
      // The file belongs to this step alone, so nothing of another step is lost.
      await core.summary.emptyBuffer().addRaw(text).write({ overwrite: true });
    },
  };
}
