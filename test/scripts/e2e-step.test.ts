import { describe, expect, test } from "bun:test";
import {
  type ActionMetadata,
  readStepOutputs,
  type StepFacts,
  stepEnvironment,
} from "../../scripts/e2e/step.ts";

// Escaped, so that nothing reads it as the placeholder of a template string.
const expression = (name: string): string => `$\{{ ${name} }}`;

const ACTION: ActionMetadata = {
  inputs: {
    mode: { required: true },
    concurrency: { default: "4" },
    "preview-timeout": { default: "10" },
    "github-token": { default: expression("github.token") },
    "no default": {},
  },
  runs: { using: "node24", main: "dist/index.js" },
};

const FACTS: StepFacts = {
  workspace: "/work/repo",
  actionPath: "/work/action",
  repository: "acme/infra",
  apiUrl: "http://127.0.0.1:4000",
  runId: "4242",
  sha: "0123456789abcdef0123456789abcdef01234567",
  event: "push",
  token: "not-a-real-token",
  summaryFile: "/work/summary.md",
  temp: "/work/temp",
};

describe("the environment of a step", () => {
  test("an input arrives the way the runner hands it over, with the default of action.yml", () => {
    const env = stepEnvironment(ACTION, { mode: "scan", concurrency: "2" }, FACTS, {});
    expect(env.INPUT_MODE).toBe("scan");
    expect(env.INPUT_CONCURRENCY).toBe("2");
    expect(env["INPUT_PREVIEW-TIMEOUT"]).toBe("10");
    // Spaces become underscores, dashes stay.
    expect("INPUT_NO_DEFAULT" in env).toBe(false);
  });

  test("the token default is the token of the run", () => {
    const env = stepEnvironment(ACTION, { mode: "scan" }, FACTS, {});
    expect(env["INPUT_GITHUB-TOKEN"]).toBe("not-a-real-token");
  });

  test("a default with any other expression is refused, because only a runner can work it out", () => {
    const action = { ...ACTION, inputs: { mode: { default: expression("github.actor") } } };
    expect(() => stepEnvironment(action, {}, FACTS, {})).toThrow(
      `The default of the input "mode" is ${expression("github.actor")}`,
    );
  });

  test("an input that action.yml does not have is refused", () => {
    expect(() => stepEnvironment(ACTION, { mode: "scan", stack: "a" }, FACTS, {})).toThrow(
      'action.yml has no input "stack"',
    );
  });

  test("a required input without a value is refused", () => {
    expect(() => stepEnvironment(ACTION, {}, FACTS, {})).toThrow('The input "mode" is required');
  });

  test("the facts of the job are the variables a runner sets, and GitHub is the fake", () => {
    const env = stepEnvironment(ACTION, { mode: "scan" }, FACTS, {});
    expect(env).toMatchObject({
      GITHUB_ACTIONS: "true",
      GITHUB_WORKSPACE: "/work/repo",
      GITHUB_REPOSITORY: "acme/infra",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_API_URL: "http://127.0.0.1:4000",
      GITHUB_GRAPHQL_URL: "http://127.0.0.1:4000/graphql",
      GITHUB_RUN_ID: "4242",
      GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
      GITHUB_EVENT_NAME: "push",
      GITHUB_WORKFLOW_REF: "acme/infra/.github/workflows/sluiceway.yml@refs/heads/main",
      GITHUB_ACTION_PATH: "/work/action",
      GITHUB_STEP_SUMMARY: "/work/summary.md",
      RUNNER_TEMP: "/work/temp",
    });
    // A local action has no ref (build plan, section 3).
    expect(env.GITHUB_ACTION_REF).toBe("");
  });

  test("the job environment comes through, and nothing of it can take the place of a fact", () => {
    const env = stepEnvironment(ACTION, { mode: "scan" }, FACTS, {
      PATH: "/bin",
      PULUMI_BACKEND_URL: "file:///work/backend",
      GITHUB_API_URL: "https://api.github.com",
      INPUT_MODE: "apply",
    });
    expect(env.PATH).toBe("/bin");
    expect(env.PULUMI_BACKEND_URL).toBe("file:///work/backend");
    expect(env.GITHUB_API_URL).toBe("http://127.0.0.1:4000");
    expect(env.INPUT_MODE).toBe("scan");
  });

  test("an issues run is handed its event, a file for its outputs and its attempt", () => {
    const env = stepEnvironment(
      ACTION,
      { mode: "resolve" },
      {
        ...FACTS,
        event: "issues",
        eventPath: "/work/event.json",
        outputFile: "/work/output",
        runAttempt: "2",
      },
      {},
    );
    expect(env).toMatchObject({
      GITHUB_EVENT_NAME: "issues",
      GITHUB_EVENT_PATH: "/work/event.json",
      GITHUB_OUTPUT: "/work/output",
      GITHUB_RUN_ATTEMPT: "2",
    });
  });

  test("a run is on its first attempt when nothing says otherwise", () => {
    const env = stepEnvironment(ACTION, { mode: "scan" }, FACTS, {});
    expect(env.GITHUB_RUN_ATTEMPT).toBe("1");
    expect("GITHUB_EVENT_PATH" in env).toBe(false);
    expect("GITHUB_OUTPUT" in env).toBe(false);
  });
});

describe("the outputs of a step", () => {
  test("are read the way the runner reads the output file", () => {
    const file = [
      "matrix<<ghadelimiter_7c1e",
      '[{"stack":"network:dev","environment":"network","deployment":1}]',
      "ghadelimiter_7c1e",
      "outcome<<ghadelimiter_99",
      "two",
      "lines",
      "ghadelimiter_99",
      "plain=value",
      "",
    ].join("\n");
    expect(readStepOutputs(file)).toEqual({
      matrix: '[{"stack":"network:dev","environment":"network","deployment":1}]',
      outcome: "two\nlines",
      plain: "value",
    });
  });

  test("a later value of the same output wins", () => {
    expect(readStepOutputs("matrix=[]\nmatrix<<d\n[1]\nd\n")).toEqual({ matrix: "[1]" });
  });

  test("an empty file has no outputs", () => {
    expect(readStepOutputs("")).toEqual({});
  });

  test("a value whose delimiter never comes is refused", () => {
    expect(() => readStepOutputs("matrix<<d\n[]\n")).toThrow(
      'The output "matrix" has no closing delimiter',
    );
  });

  test("a line that is no output is refused", () => {
    expect(() => readStepOutputs("not an output\n")).toThrow(
      'The output file has a line that is no output: "not an output"',
    );
  });
});
