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

export function readScanInputs(getInput: GetInput): ScanInputs {
  const concurrency = wholeNumber(getInput, "concurrency");
  const previewTimeoutMinutes = wholeNumber(
    getInput,
    "preview-timeout",
    " It is a number of whole minutes.",
  );
  const token = getInput("github-token");
  if (token === "") {
    throw new Error(
      'The "github-token" input is empty. Leave it out of the workflow, so it takes the GITHUB_TOKEN of the run.',
    );
  }
  return { concurrency, previewTimeoutMinutes, token };
}
