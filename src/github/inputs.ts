// The inputs of the action (build plan, section 3). GitHub hands each one over
// as text. They are read once, here, and passed on as data.

// `core.getInput`, or a table in a test. It gives "" for an input that is not
// set.
export type GetInput = (name: string) => string;

export interface ScanInputs {
  // The size of the preview pool (record 0012).
  concurrency: number;
  previewTimeoutMinutes: number;
  // The workflow's own token (record 0017).
  token: string;
}

function wholeNumber(getInput: GetInput, name: string, hint = ""): number {
  const text = getInput(name).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(
      `The "${name}" input must be a whole number of 1 or more, and it is ${JSON.stringify(text)}.${hint}`,
    );
  }
  return Number(text);
}

// The one input every mode reads: the workflow's own token (record 0017).
export function readToken(getInput: GetInput): string {
  const token = getInput("github-token");
  if (token === "") {
    throw new Error(
      'The "github-token" input is empty. Leave it out of the workflow, so it takes the GITHUB_TOKEN of the run.',
    );
  }
  return token;
}

export function readScanInputs(getInput: GetInput): ScanInputs {
  const concurrency = wholeNumber(getInput, "concurrency");
  const previewTimeoutMinutes = wholeNumber(
    getInput,
    "preview-timeout",
    " It is a number of whole minutes.",
  );
  return { concurrency, previewTimeoutMinutes, token: readToken(getInput) };
}

// The id of the running job (record 0044). GitHub puts it in no variable of
// the job's environment, so action.yml takes it from `job.check_run_id` as the
// default of the `job-id` input, which needs no permission. A runner that
// does not know it gives "", and the links then fall back to the summary.
export function readJobId(getInput: GetInput): string | undefined {
  const text = getInput("job-id").trim();
  if (text === "") return undefined;
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(
      `The "job-id" input must be the id of the running job, a whole number, and it is ${JSON.stringify(text)}. Leave it out of the workflow, so it takes the id GitHub gives the job.`,
    );
  }
  return text;
}

export interface ApplyInputs {
  // The deployment record to deploy (record 0035).
  deploymentId: number;
  // A rehearsal: everything up to the hash check, and no deploy (record 0051).
  dryRun: boolean;
  // The time limit of the fresh preview, in whole minutes.
  previewTimeoutMinutes: number;
  token: string;
}

export function readApplyInputs(getInput: GetInput): ApplyInputs {
  const text = getInput("deployment-id").trim();
  if (text === "") {
    throw new Error(
      'The "deployment-id" input is required in apply mode. Set it to the deployment of the matrix entry: deployment-id: ${{ matrix.deployment }}.',
    );
  }
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(
      `The "deployment-id" input must be the id of a deployment record, a whole number, and it is ${JSON.stringify(text)}.`,
    );
  }
  const previewTimeoutMinutes = wholeNumber(
    getInput,
    "preview-timeout",
    " It is a number of whole minutes.",
  );
  return {
    deploymentId: Number(text),
    previewTimeoutMinutes,
    token: readToken(getInput),
    dryRun: readDryRun(getInput),
  };
}

// The words GitHub's own boolean inputs use. Anything else is refused, so a
// typo never deploys when a rehearsal was meant (record 0051).
function readDryRun(getInput: GetInput): boolean {
  const text = getInput("dry-run").trim();
  if (text === "" || text === "false") return false;
  if (text === "true") return true;
  throw new Error(`The "dry-run" input is true or false, and it is ${JSON.stringify(text)}.`);
}

// `backend: true` makes the check ask the backend which stacks it holds, with
// the credentials of its job (record 0074). Off by default, and read the way
// dry-run is, so a typo never starts a tool.
export function readBackend(getInput: GetInput): boolean {
  const text = getInput("backend").trim();
  if (text === "" || text === "false") return false;
  if (text === "true") return true;
  throw new Error(`The "backend" input is true or false, and it is ${JSON.stringify(text)}.`);
}

// `deployment-id` is an error in every mode but apply (record 0035), so a
// workflow that hands it to the wrong step hears about it.
// `dry-run: true` is refused the same way (record 0051). Its default, false,
// reaches every mode and says nothing.
// `backend: true` is refused in every mode but check (record 0074).
export function refuseDeploymentId(mode: string, getInput: GetInput): void {
  if (mode !== "check" && getInput("backend").trim() === "true") {
    throw new Error(
      `The "backend" input is only for check mode, and this step runs ${mode} mode. Take it out of this step.`,
    );
  }
  if (mode === "apply") return;
  const only = (name: string) =>
    new Error(
      `The "${name}" input is only for apply mode, and this step runs ${mode} mode. Take it out of this step.`,
    );
  if (getInput("deployment-id").trim() !== "") throw only("deployment-id");
  if (getInput("dry-run").trim() === "true") throw only("dry-run");
}
