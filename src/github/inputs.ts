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

export interface ApplyInputs {
  // The deployment record to deploy (record 0035).
  deploymentId: number;
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
  return { deploymentId: Number(text), previewTimeoutMinutes, token: readToken(getInput) };
}

// `deployment-id` is an error in every mode but apply (record 0035), so a
// workflow that hands it to the wrong step hears about it.
export function refuseDeploymentId(mode: string, getInput: GetInput): void {
  if (mode === "apply" || getInput("deployment-id").trim() === "") return;
  throw new Error(
    `The "deployment-id" input is only for apply mode, and this step runs ${mode} mode. Take it out of this step.`,
  );
}
