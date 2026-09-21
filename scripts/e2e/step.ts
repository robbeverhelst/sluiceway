// The environment a runner hands a step of `uses: sluiceway/sluiceway`, built
// here because a real step cannot be pointed at the fake GitHub: a runner sets
// GITHUB_API_URL, GITHUB_WORKSPACE, GITHUB_SHA and GITHUB_EVENT_NAME itself,
// and neither a step nor a job can take their place. So the e2e starts the
// committed bundle the way a runner does, with these variables, and everything
// it knows about the inputs comes from action.yml.

export interface ActionMetadata {
  inputs: Record<string, { required?: boolean; default?: string }>;
  runs: { using: string; main: string };
}

export interface StepFacts {
  // The checked-out repo the step works in.
  workspace: string;
  // How the step names the action. Absent for `uses: ./`, which has no ref.
  // The runner never says where the action sits: it sets GITHUB_ACTION_PATH
  // for composite actions only (seen in the lab, hotfix 0.1.1), so the bundle
  // finds its own files.
  action?: { ref: string; repository: string };
  // `owner/repo`.
  repository: string;
  // The fake GitHub server.
  apiUrl: string;
  runId: string;
  // What `${{ job.check_run_id }}` gives: the id of the job (record 0044).
  jobId: string;
  sha: string;
  event: string;
  // What `${{ github.token }}` gives. The fake asks for none, so it is no token.
  token: string;
  summaryFile: string;
  temp: string;
  // The payload of the event, which a runner writes for every run. Only the
  // modes that read it are handed one here.
  eventPath?: string;
  // The file a step writes its outputs to.
  outputFile?: string;
  // "2" and up for a re-run of the same run. The run id stays.
  runAttempt?: string;
}

const EXPRESSION = "$".concat("{{");
const TOKEN_EXPRESSION = `${EXPRESSION} github.token }}`;
const JOB_ID_EXPRESSION = `${EXPRESSION} job.check_run_id }}`;

// A runner names the variable of an input like this: spaces become
// underscores, upper case, and a dash stays a dash.
function inputVariable(name: string): string {
  return `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
}

export function stepEnvironment(
  action: ActionMetadata,
  inputs: Record<string, string>,
  facts: StepFacts,
  jobEnvironment: Record<string, string>,
): Record<string, string> {
  for (const name of Object.keys(inputs)) {
    if (!(name in action.inputs)) throw new Error(`action.yml has no input "${name}".`);
  }

  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(jobEnvironment)) {
    if (!name.startsWith("INPUT_") && !name.startsWith("GITHUB_")) env[name] = value;
  }

  for (const [name, input] of Object.entries(action.inputs)) {
    let value = inputs[name] ?? input.default;
    if (value === TOKEN_EXPRESSION) value = facts.token;
    if (value === JOB_ID_EXPRESSION) value = facts.jobId;
    if (value?.includes(EXPRESSION)) {
      throw new Error(
        `The default of the input "${name}" is ${value}, and only a runner can work that out.`,
      );
    }
    if (value === undefined) {
      if (input.required) throw new Error(`The input "${name}" is required.`);
      continue;
    }
    env[inputVariable(name)] = value;
  }

  return {
    ...env,
    GITHUB_ACTIONS: "true",
    GITHUB_WORKSPACE: facts.workspace,
    GITHUB_REPOSITORY: facts.repository,
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_API_URL: facts.apiUrl,
    GITHUB_GRAPHQL_URL: `${facts.apiUrl}/graphql`,
    GITHUB_RUN_ID: facts.runId,
    GITHUB_RUN_ATTEMPT: facts.runAttempt ?? "1",
    GITHUB_SHA: facts.sha,
    GITHUB_EVENT_NAME: facts.event,
    // The workflow file of the README. The orphan tick sweep asks for its runs.
    GITHUB_WORKFLOW_REF: `${facts.repository}/.github/workflows/sluiceway.yml@refs/heads/main`,
    // A local action (`uses: ./`) has no ref and no repository.
    GITHUB_ACTION_REF: facts.action?.ref ?? "",
    GITHUB_ACTION_REPOSITORY: facts.action?.repository ?? "",
    GITHUB_STEP_SUMMARY: facts.summaryFile,
    RUNNER_TEMP: facts.temp,
    ...(facts.eventPath === undefined ? {} : { GITHUB_EVENT_PATH: facts.eventPath }),
    ...(facts.outputFile === undefined ? {} : { GITHUB_OUTPUT: facts.outputFile }),
  };
}

// The outputs a step wrote to its output file, the way the runner reads them:
// `name=value` on one line, or `name<<delimiter`, the lines of the value and
// the delimiter again, which is how @actions/core writes every output.
export function readStepOutputs(file: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = file.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line === "") continue;
    const heredoc = /^([^=<]+)<<(.+)$/.exec(line);
    if (heredoc) {
      const [, name = "", delimiter = ""] = heredoc;
      const end = lines.indexOf(delimiter, i + 1);
      if (end < 0) throw new Error(`The output "${name}" has no closing delimiter.`);
      outputs[name] = lines.slice(i + 1, end).join("\n");
      i = end;
      continue;
    }
    const plain = /^([^=]+)=(.*)$/.exec(line);
    if (!plain) throw new Error(`The output file has a line that is no output: "${line}".`);
    const [, name = "", value = ""] = plain;
    outputs[name] = value;
  }
  return outputs;
}
