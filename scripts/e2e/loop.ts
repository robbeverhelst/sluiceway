// What the e2e run holds the loop to: a tick, `resolve`, `apply` and `settle`,
// each started as its own step. Like the checks of a scan, every check reads
// only what a person could read after a real run: the issue, its comments,
// the deployment records, the step's outputs, its summary and its job log. The
// rows are read with small regexes of their own, not with the renderer's
// parser, so a check cannot agree with the code it checks by sharing it.

// What a person does in GitHub's interface: check the box on one row.
export function tickRow(body: string, stack: string): string {
  const lines = body.split("\n");
  const index = lines.findIndex((line) => line.includes(`<!-- sluiceway:row stack="${stack}"`));
  const line = lines[index];
  if (line === undefined) throw new Error(`The dashboard has no row for ${stack}.`);
  if (!line.startsWith("- [ ] ")) throw new Error(`The row of ${stack} has no box to tick.`);
  lines[index] = `- [x] ${line.slice("- [ ] ".length)}`;
  return lines.join("\n");
}

// One deployment record as GitHub keeps it, with every status it was given,
// oldest first.
export interface LoopRecord {
  id: number;
  task: string;
  environment: string;
  payload: unknown;
  states: string[];
  // The description of the newest status.
  description: string;
}

// What one step of the loop left behind.
export interface LoopStep {
  exitCode: number;
  // Everything the step printed.
  log: string;
  summary: string;
  // What the step wrote to its output file.
  outputs: Record<string, string>;
  // The body of the open dashboard after the step.
  body: string;
  // The comments the step wrote on the dashboard.
  newComments: string[];
  // Every deployment record after the step.
  records: LoopRecord[];
  // The GitHub requests of the step, in order.
  requests: string[];
  // How many workflow runs the step started.
  newDispatches: number;
}

interface RowFacts {
  state: string;
  failed: boolean;
  ticked: boolean;
}

// The first line of every row, read the plain way: its marker and its box.
function rows(body: string): Map<string, RowFacts> {
  const found = new Map<string, RowFacts>();
  for (const line of body.split("\n")) {
    const marker = /<!-- sluiceway:row stack="([^"]*)" state="([^"]*)"([^>]*)-->/.exec(line);
    if (!marker) continue;
    const [, stack = "", state = "", rest = ""] = marker;
    found.set(stack, {
      state,
      failed: / failed="true"/.test(rest),
      ticked: line.startsWith("- [x] "),
    });
  }
  return found;
}

function exitCode(step: LoopStep, green: boolean): string[] {
  if (green && step.exitCode !== 0) {
    return [`The step ended with exit code ${step.exitCode}, expected 0.`];
  }
  if (!green && step.exitCode === 0)
    return ["The step ended with exit code 0, expected a red job."];
  return [];
}

function needLine(log: string, start: string): string[] {
  return log.split("\n").some((line) => line.startsWith(start))
    ? []
    : [`The job log has no line that starts with "${start}".`];
}

function rowState(body: string, stack: string, state: string): string[] {
  const row = rows(body).get(stack);
  if (!row) return [`The dashboard has no row for ${stack}.`];
  return row.state === state
    ? []
    : [`The row of ${stack} is in state ${row.state}, expected ${state}.`];
}

function failureLine(body: string, stack: string, failed: boolean): string[] {
  const row = rows(body).get(stack);
  if (!row || row.failed === failed) return [];
  return [
    failed
      ? `The row of ${stack} has no failure line.`
      : `The row of ${stack} has a failure line, expected none.`,
  ];
}

function statuses(record: LoopRecord, states: string[], description?: string): string[] {
  const problems: string[] = [];
  if (record.states.join() !== states.join()) {
    problems.push(
      `Deployment record ${record.id} has the statuses ${record.states.join(", ")}, expected ${states.join(", ")}.`,
    );
  }
  if (description !== undefined && record.description !== description) {
    problems.push(
      `Deployment record ${record.id} has the description "${record.description}", expected "${description}".`,
    );
  }
  return problems;
}

function unchanged(records: LoopRecord[], before: LoopRecord[]): string[] {
  return before.flatMap((was) => {
    const is = records.find((record) => record.id === was.id);
    return is && is.states.join() === was.states.join()
      ? []
      : [
          `Deployment record ${was.id} changed: ${is?.states.join(", ") ?? "gone"}, expected ${was.states.join(", ")}.`,
        ];
  });
}

function payloadField(payload: unknown, key: string): unknown {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}

// A tick by a person the tick rule does not allow (record 0018): nothing
// starts, the box is cleared and the person is told, and the job stays green.
export function checkRefusedTick(
  step: LoopStep,
  expected: { stack: string; ticker: string },
): string[] {
  const { stack, ticker } = expected;
  const problems = exitCode(step, true);
  if (step.outputs.matrix !== "[]") {
    problems.push(`The matrix output is ${step.outputs.matrix}, expected [].`);
  }
  if (step.records.some((record) => record.task === `sluiceway:${stack}`)) {
    problems.push(`A deployment record exists for ${stack}.`);
  }
  if (rows(step.body).get(stack)?.ticked) problems.push(`The box of ${stack} is still ticked.`);
  const told = step.newComments.filter(
    (comment) => comment.includes(`@${ticker}`) && comment.includes(stack),
  );
  if (told.length !== 1) {
    problems.push(`Expected one comment that names ${ticker} and ${stack}, found ${told.length}.`);
  }
  problems.push(...needLine(step.log, `${stack} was ticked by ${ticker}, who may not tick it`));
  return problems;
}

// `resolve` after an allowed tick (records 0003 and 0035): one record, queued,
// handed on in the matrix, and the row says deploying.
export function checkResolve(
  step: LoopStep,
  expected: { stack: string; environment: string; ticker: string; runId: string },
): string[] {
  const { stack, environment, ticker, runId } = expected;
  const problems = exitCode(step, true);
  const text = step.outputs.matrix;
  if (text === undefined) return [...problems, "The step set no matrix output."];
  const matrix = matrixEntries(text);
  const [entry] = matrix;
  if (matrix.length !== 1 || entry?.stack !== stack || entry.environment !== environment) {
    return [...problems, `The matrix output is ${text}, expected one entry for ${stack}.`];
  }
  const record = step.records.find(({ id }) => id === entry.deployment);
  if (!record) {
    return [
      ...problems,
      `The matrix hands on deployment record ${entry.deployment}, which does not exist.`,
    ];
  }
  if (record.task !== `sluiceway:${stack}`) {
    problems.push(`Deployment record ${record.id} has the task ${record.task}.`);
  }
  if (record.environment !== environment) {
    problems.push(
      `Deployment record ${record.id} is in the environment ${record.environment}, expected ${environment}.`,
    );
  }
  const named = payloadField(record.payload, "ticker");
  if (named !== ticker) {
    problems.push(`Deployment record ${record.id} names the ticker ${named}, expected ${ticker}.`);
  }
  const run = payloadField(record.payload, "run");
  if (run !== runId) {
    problems.push(`Deployment record ${record.id} belongs to run ${run}, expected ${runId}.`);
  }
  problems.push(...statuses(record, ["queued"]), ...rowState(step.body, stack, "deploying"));
  return problems;
}

export interface MatrixEntry {
  stack: string;
  environment: string;
  deployment: number;
}

// The matrix output of `resolve`, or nothing for one that is not a list.
export function matrixEntries(text: string): MatrixEntry[] {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as MatrixEntry[]) : [];
  } catch {
    return [];
  }
}

// `apply` of one record (records 0008, 0019, 0035 and 0051). A deploy that
// went out ends as success, is a green job and leaves the row in sync. A fresh
// preview with nothing to deploy ends as success that says so, is a green job
// and leaves the row in sync with no failure line. A change that moved since
// the tick deploys nothing, ends as error, is a red job, and the row shows the
// fresh preview with a failure line.
export function checkApply(
  step: LoopStep,
  expected: {
    stack: string;
    deployment: number;
    outcome: "deployed" | "in-sync" | "moved";
    rowState?: string;
  },
): string[] {
  const { stack, deployment, outcome } = expected;
  const green = outcome !== "moved";
  const problems = exitCode(step, green);
  const record = step.records.find(({ id }) => id === deployment);
  if (!record) problems.push(`Deployment record ${deployment} does not exist.`);
  else if (outcome === "deployed") {
    problems.push(...statuses(record, ["queued", "in_progress", "success"]));
  } else if (outcome === "in-sync") {
    problems.push(
      ...statuses(
        record,
        ["queued", "in_progress", "success"],
        "nothing to deploy, already in sync",
      ),
    );
  } else {
    problems.push(
      ...statuses(record, ["queued", "in_progress", "error"], "the change moved since the tick"),
    );
  }
  if (step.outputs.outcome !== (outcome === "moved" ? "refused" : outcome)) {
    problems.push(`The outcome output is ${step.outputs.outcome}, expected ${outcome}.`);
  }
  problems.push(
    ...rowState(step.body, stack, expected.rowState ?? "in-sync"),
    ...failureLine(step.body, stack, !green),
  );
  if (step.summary.trim() === "") problems.push("The summary is empty.");
  return problems;
}

// A rehearsal (record 0051): `apply` with `dry-run: true` previews, checks
// the hash and deploys nothing. The record ends as inactive with its own
// words, the job is green, the row is pending again with its box, and the
// trail says rehearsed.
export function checkRehearsal(
  step: LoopStep,
  expected: { stack: string; deployment: number; ticker: string },
): string[] {
  const { stack, deployment, ticker } = expected;
  const problems = exitCode(step, true);
  const record = step.records.find(({ id }) => id === deployment);
  if (!record) problems.push(`Deployment record ${deployment} does not exist.`);
  else {
    problems.push(
      ...statuses(record, ["queued", "in_progress", "inactive"], "rehearsed, nothing was deployed"),
    );
  }
  if (step.outputs.outcome !== "rehearsed") {
    problems.push(`The outcome output is ${step.outputs.outcome}, expected rehearsed.`);
  }
  problems.push(...rowState(step.body, stack, "pending"));
  const row = rows(step.body).get(stack);
  if (row?.ticked) problems.push(`The box of ${stack} is still ticked.`);
  // The purple dot of a rehearsal (slice 4.5).
  const trail = `- 🟣&nbsp;${stack} · rehearsed · ${ticker} · `;
  if (!step.body.split("\n").some((line) => line.startsWith(trail))) {
    problems.push(`Recently deployed does not say that ${stack} was rehearsed.`);
  }
  return problems;
}

// A re-run of an `apply` job whose record already ended (record 0019): one
// request, no tool, nothing written, and a red job.
export function checkRerun(
  step: LoopStep,
  expected: { deployment: number; before: LoopRecord[] },
): string[] {
  const problems = exitCode(step, false);
  if (step.requests.join() !== "latestDeploymentStatus") {
    problems.push(
      `The re-run made the requests ${step.requests.join(", ")}, expected only latestDeploymentStatus.`,
    );
  }
  const was = expected.before.find(({ id }) => id === expected.deployment);
  problems.push(
    ...unchanged(step.records, expected.before),
    ...needLine(
      step.log,
      `Deployment record ${expected.deployment} already ended as ${was?.states.at(-1)}`,
    ),
  );
  return problems;
}

// `settle` at the end of a run (records 0003 and 0035). With nothing open it
// does nothing. A record the run left open ends as error, and a full scan is
// started to write its row again.
export function checkSettle(
  step: LoopStep,
  expected: { ended: number | undefined; before: LoopRecord[] },
): string[] {
  const problems = exitCode(step, true);
  const { ended, before } = expected;
  if (ended === undefined) {
    problems.push(...unchanged(step.records, before));
  } else {
    const record = step.records.find(({ id }) => id === ended);
    const was = before.find(({ id }) => id === ended);
    if (!record) problems.push(`Deployment record ${ended} does not exist.`);
    else {
      problems.push(
        ...statuses(record, [...(was?.states ?? []), "error"], "the run ended without a result"),
      );
    }
  }
  const scans = ended === undefined ? 0 : 1;
  if (step.newDispatches !== scans) {
    problems.push(
      `The step started ${step.newDispatches} ${step.newDispatches === 1 ? "scan" : "scans"}, expected ${scans}.`,
    );
  }
  return problems;
}

// What a scan after the loop shows on the rows: a failure line on every stack
// whose last deploy from the dashboard failed and on no other, and the stacks
// deployed from the dashboard under Recently deployed (record 0029).
export function checkRowFacts(
  body: string,
  expected: { failed: string[]; recentlyDeployed: string[] },
): string[] {
  const problems: string[] = [];
  for (const [stack] of rows(body)) {
    problems.push(...failureLine(body, stack, expected.failed.includes(stack)));
  }
  const recent = body.split("## Recently deployed")[1]?.split("\n---")[0] ?? "";
  for (const stack of expected.recentlyDeployed) {
    // Each line starts with the dot of its result (slice 4.5): green went
    // out, white had nothing to deploy.
    const listed = ["🟢", "⚪"].map((dot) => `- ${dot}&nbsp;${stack} · `);
    if (!recent.split("\n").some((line) => listed.some((start) => line.startsWith(start)))) {
      problems.push(`Recently deployed does not list ${stack}.`);
    }
  }
  return problems;
}

// No value leaves the job log's groups (records 0021 and 0022): not on the
// dashboard, in a comment, an annotation, the summary or an output.
export function checkNothingLeaks(step: LoopStep, secrets: string[]): string[] {
  const annotations = step.log
    .split("\n")
    .filter((line) => /^::(warning|error|notice)/.test(line))
    .join("\n");
  const problems: string[] = [];
  for (const secret of secrets) {
    if (step.body.includes(secret)) problems.push(`The dashboard holds ${secret}.`);
    if (step.newComments.some((comment) => comment.includes(secret))) {
      problems.push(`A comment holds ${secret}.`);
    }
    if (annotations.includes(secret)) problems.push(`An annotation holds ${secret}.`);
    if (step.summary.includes(secret)) problems.push(`The summary holds ${secret}.`);
    for (const [name, value] of Object.entries(step.outputs)) {
      if (value.includes(secret)) problems.push(`The output ${name} holds ${secret}.`);
    }
  }
  return problems;
}

// The stacks of a chain that wait (record 0056): the newest record of each is
// queued, not handed on, and waits behind the stacks given, and its row is
// queued.
export function checkQueued(
  step: LoopStep,
  expected: { stack: string; behind: string[] }[],
): string[] {
  return expected.flatMap(({ stack, behind }) => {
    const record = step.records.findLast(({ task }) => task === `sluiceway:${stack}`);
    if (!record) return [`${stack} has no deployment record.`];
    const found = payloadField(record.payload, "behind");
    const waits = Array.isArray(found) ? found.join(", ") : "";
    return [
      ...(waits === behind.join(", ")
        ? []
        : [
            `The newest record of ${stack} waits behind ${waits || "nothing"}, expected ${behind.join(", ")}.`,
          ]),
      ...statuses(record, ["queued"]),
      ...rowState(step.body, stack, "queued"),
    ];
  });
}

// Merge and deploy (record 0054). The rows of the updates waiting to merge,
// read the plain way: the pull request and the stack of each marker.
export function mergeRows(body: string): { pr: string; stack: string; ticked: boolean }[] {
  return body.split("\n").flatMap((line) => {
    const marker = /<!-- sluiceway:merge pr="(\d+)" stack="([^"]*)"/.exec(line);
    return marker
      ? [{ pr: marker[1] ?? "", stack: marker[2] ?? "", ticked: line.startsWith("- [x] ") }]
      : [];
  });
}

// What a person does in GitHub's interface: check the box of one pull request.
export function tickMerge(body: string, pr: number): string {
  const lines = body.split("\n");
  const index = lines.findIndex((line) => line.includes(`<!-- sluiceway:merge pr="${pr}"`));
  const line = lines[index];
  if (line === undefined) throw new Error(`The dashboard lists no #${pr} to merge.`);
  if (!line.startsWith("- [ ] ")) throw new Error(`The row of #${pr} has no box to tick.`);
  lines[index] = `- [x] ${line.slice("- [ ] ".length)}`;
  return lines.join("\n");
}

// `resolve` after a tick on an update: the pull request is merged, one merge
// record waits for the scan, nothing is handed to apply, a scan is started,
// the row of the pull request is gone and the stack is deploying.
export function checkMergeTick(
  step: LoopStep,
  expected: { pr: number; stack: string; ticker: string; runId: string },
): string[] {
  const { pr, stack, ticker, runId } = expected;
  const problems = exitCode(step, true);
  if (step.outputs.matrix !== "[]") {
    problems.push(`The matrix output is ${step.outputs.matrix}, expected [].`);
  }
  if (step.newDispatches !== 1) {
    problems.push(`The step started ${step.newDispatches} runs, expected 1 scan.`);
  }
  const record = step.records.find(({ payload }) => payloadField(payload, "merge") === pr);
  if (!record) return [...problems, `No deployment record carries the merge of #${pr}.`];
  if (record.task !== `sluiceway:${stack}`) {
    problems.push(`Deployment record ${record.id} has the task ${record.task}.`);
  }
  if (payloadField(record.payload, "ticker") !== ticker) {
    problems.push(`Deployment record ${record.id} does not name ${ticker} as the ticker.`);
  }
  if (payloadField(record.payload, "run") !== runId) {
    problems.push(`Deployment record ${record.id} does not belong to run ${runId}.`);
  }
  if (mergeRows(step.body).some((row) => row.pr === String(pr))) {
    problems.push(`The dashboard still lists #${pr} to merge.`);
  }
  problems.push(...statuses(record, ["queued"]), ...rowState(step.body, stack, "deploying"));
  return problems;
}

// The scan after the merge: the merge record is handed on, and a new record
// with the fresh diff hash, the same ticker and the scan's run is in its
// matrix output.
export function checkHandOff(
  step: LoopStep,
  expected: { stack: string; merge: number; ticker: string; runId: string },
): string[] {
  const { stack, merge, ticker, runId } = expected;
  const problems = exitCode(step, true);
  const was = step.records.find(({ id }) => id === merge);
  if (!was) problems.push(`Deployment record ${merge} does not exist.`);
  else {
    problems.push(
      ...statuses(was, ["queued", "inactive"], "merged, the deploy follows in a record of its own"),
    );
  }
  const matrix = matrixEntries(step.outputs.matrix ?? "");
  const [entry] = matrix;
  if (matrix.length !== 1 || entry?.stack !== stack) {
    return [
      ...problems,
      `The matrix output is ${step.outputs.matrix}, expected one entry for ${stack}.`,
    ];
  }
  const record = step.records.find(({ id }) => id === entry.deployment);
  if (!record) return [...problems, `Deployment record ${entry.deployment} does not exist.`];
  const hash = payloadField(record.payload, "hash");
  if (typeof hash !== "string" || !/^[0-9a-f]{16}$/.test(hash)) {
    problems.push(`Deployment record ${record.id} carries no diff hash.`);
  }
  if (payloadField(record.payload, "ticker") !== ticker) {
    problems.push(`Deployment record ${record.id} does not name ${ticker} as the ticker.`);
  }
  if (payloadField(record.payload, "run") !== runId) {
    problems.push(`Deployment record ${record.id} does not belong to run ${runId}.`);
  }
  problems.push(...statuses(record, ["queued"]), ...rowState(step.body, stack, "deploying"));
  return problems;
}
