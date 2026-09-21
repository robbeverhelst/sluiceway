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
  // The directory that holds action.yml.
  actionPath: string;
  // `owner/repo`.
  repository: string;
  // The fake GitHub server.
  apiUrl: string;
  runId: string;
  sha: string;
  event: string;
  // What `${{ github.token }}` gives. The fake asks for none, so it is no token.
  token: string;
  summaryFile: string;
  temp: string;
}

const EXPRESSION = "$".concat("{{");
const TOKEN_EXPRESSION = `${EXPRESSION} github.token }}`;

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
    GITHUB_SHA: facts.sha,
    GITHUB_EVENT_NAME: facts.event,
    // A local action (`uses: ./`) has no ref.
    GITHUB_ACTION_REF: "",
    GITHUB_ACTION_PATH: facts.actionPath,
    GITHUB_STEP_SUMMARY: facts.summaryFile,
    RUNNER_TEMP: facts.temp,
  };
}
