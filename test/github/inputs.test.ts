import { describe, expect, test } from "bun:test";
import {
  readApplyInputs,
  readBackend,
  readJobId,
  readScanInputs,
  readToken,
  refuseDeploymentId,
} from "../../src/github/inputs.ts";

// The inputs of scan mode (build plan, section 3). GitHub hands every input
// over as text, and an input that action.yml gives a default is never empty
// unless the workflow made it so.
function inputs(values: Record<string, string>) {
  return readScanInputs((name) => values[name] ?? "");
}

const GOOD = { concurrency: "4", "preview-timeout": "10", "github-token": "ghs_token" };

describe("the inputs of a scan", () => {
  test("reads the pool size, the time limit and the token", () => {
    expect(inputs(GOOD)).toEqual({
      concurrency: 4,
      previewTimeoutMinutes: 10,
      token: "ghs_token",
      strict: false,
    });
  });

  // Slice 5.9: the strict input, true or false and nothing else, as dry-run.
  test("strict is true or false, and nothing else", () => {
    expect(inputs({ ...GOOD, strict: "true" }).strict).toBe(true);
    expect(inputs({ ...GOOD, strict: "false" }).strict).toBe(false);
    expect(() => inputs({ ...GOOD, strict: "yes" })).toThrow(
      'The "strict" input is true or false, and it is "yes".',
    );
  });

  test("any other mode refuses strict: true", () => {
    expect(() => refuseDeploymentId("apply", (name) => (name === "strict" ? "true" : ""))).toThrow(
      'The "strict" input is only for scan mode, and this step runs apply mode. Take it out of this step.',
    );
    expect(() =>
      refuseDeploymentId("resolve", (name) => (name === "strict" ? "false" : "")),
    ).not.toThrow();
  });

  test("takes white space around a number", () => {
    expect(inputs({ ...GOOD, concurrency: " 8\n" }).concurrency).toBe(8);
  });

  test.each(["0", "-2", "1.5", "four", "4 stacks", "1e2", "0x10"])(
    "refuses a concurrency of %p",
    (value) => {
      expect(() => inputs({ ...GOOD, concurrency: value })).toThrow(
        `The "concurrency" input must be a whole number of 1 or more, and it is ${JSON.stringify(value.trim())}.`,
      );
    },
  );

  test.each(["0", "2.5", "ten"])("refuses a preview-timeout of %p", (value) => {
    expect(() => inputs({ ...GOOD, "preview-timeout": value })).toThrow(
      `The "preview-timeout" input must be a whole number of 1 or more, and it is ${JSON.stringify(value)}. It is a number of whole minutes.`,
    );
  });

  test("refuses an empty token, and says which token it wants", () => {
    expect(() => inputs({ ...GOOD, "github-token": "" })).toThrow(
      'The "github-token" input is empty. Leave it out of the workflow, so it takes the GITHUB_TOKEN of the run.',
    );
  });
});

// `resolve` reads one input, the token. It has no pool and starts no preview.
describe("the token, for a mode that reads nothing else", () => {
  test("is read without the inputs of a scan", () => {
    expect(readToken((name) => (name === "github-token" ? "ghs_token" : ""))).toBe("ghs_token");
  });

  test("an empty token is refused with the same words", () => {
    expect(() => readToken(() => "")).toThrow(
      'The "github-token" input is empty. Leave it out of the workflow, so it takes the GITHUB_TOKEN of the run.',
    );
  });
});

// Record 0035: `deployment-id` is required in apply mode and an error in every
// other mode.
describe("the inputs of apply", () => {
  const APPLY = { "deployment-id": "6575759143", "preview-timeout": "10", "github-token": "t" };
  const read = (values: Record<string, string>) => readApplyInputs((name) => values[name] ?? "");

  test("reads the record, the time limit of the fresh preview and the token", () => {
    expect(read(APPLY)).toEqual({
      deploymentId: 6575759143,
      previewTimeoutMinutes: 10,
      token: "t",
      dryRun: false,
      deployTimeoutMinutes: undefined,
    });
  });

  // Slice 5.9: a time limit on the deploy, none unless it is set.
  test("deploy-timeout is a number of whole minutes, or nothing", () => {
    expect(read({ ...APPLY, "deploy-timeout": "45" }).deployTimeoutMinutes).toBe(45);
    expect(read({ ...APPLY, "deploy-timeout": "" }).deployTimeoutMinutes).toBeUndefined();
    expect(() => read({ ...APPLY, "deploy-timeout": "0" })).toThrow(
      'The "deploy-timeout" input must be a whole number of 1 or more, and it is "0". It is a number of whole minutes.',
    );
  });

  test("any other mode refuses deploy-timeout", () => {
    expect(() =>
      refuseDeploymentId("scan", (name) => (name === "deploy-timeout" ? "30" : "")),
    ).toThrow(
      'The "deploy-timeout" input is only for apply mode, and this step runs scan mode. Take it out of this step.',
    );
  });

  // Record 0051: a rehearsal. Only the two words GitHub's own boolean
  // inputs use, so a typo never deploys and never rehearses by accident.
  test("dry-run is true or false, and nothing else", () => {
    expect(read({ ...APPLY, "dry-run": "true" }).dryRun).toBe(true);
    expect(read({ ...APPLY, "dry-run": "false" }).dryRun).toBe(false);
    expect(read({ ...APPLY, "dry-run": "" }).dryRun).toBe(false);
    expect(() => read({ ...APPLY, "dry-run": "yes" })).toThrow(
      'The "dry-run" input is true or false, and it is "yes".',
    );
  });

  test("any other mode refuses dry-run: true", () => {
    expect(() => refuseDeploymentId("scan", (name) => (name === "dry-run" ? "true" : ""))).toThrow(
      'The "dry-run" input is only for apply mode, and this step runs scan mode. Take it out of this step.',
    );
    expect(() =>
      refuseDeploymentId("scan", (name) => (name === "dry-run" ? "false" : "")),
    ).not.toThrow();
  });

  // Record 0074.
  test("any mode but check refuses backend: true", () => {
    expect(() => refuseDeploymentId("scan", (name) => (name === "backend" ? "true" : ""))).toThrow(
      'The "backend" input is only for check mode, and this step runs scan mode. Take it out of this step.',
    );
    expect(() =>
      refuseDeploymentId("check", (name) => (name === "backend" ? "true" : "")),
    ).not.toThrow();
    expect(() =>
      refuseDeploymentId("apply", (name) => (name === "backend" ? "false" : "")),
    ).not.toThrow();
  });

  test("backend is true or false", () => {
    expect(readBackend(() => "")).toBe(false);
    expect(readBackend(() => "false")).toBe(false);
    expect(readBackend(() => " true ")).toBe(true);
    expect(() => readBackend(() => "yes")).toThrow(
      'The "backend" input is true or false, and it is "yes".',
    );
  });

  test("a missing deployment-id says where it comes from", () => {
    expect(() => read({ ...APPLY, "deployment-id": "" })).toThrow(
      'The "deployment-id" input is required in apply mode. Set it to the deployment of the matrix entry: deployment-id: ${{ matrix.deployment }}.',
    );
  });

  test.each(["abc", "0", "12.5", "-3"])("refuses a deployment-id of %p", (value) => {
    expect(() => read({ ...APPLY, "deployment-id": value })).toThrow(
      `The "deployment-id" input must be the id of a deployment record, a whole number, and it is ${JSON.stringify(value)}.`,
    );
  });

  test("any other mode refuses a deployment-id", () => {
    expect(() => refuseDeploymentId("scan", () => "12")).toThrow(
      'The "deployment-id" input is only for apply mode, and this step runs scan mode. Take it out of this step.',
    );
    expect(() => refuseDeploymentId("apply", () => "12")).not.toThrow();
    expect(() => refuseDeploymentId("resolve", () => " ")).not.toThrow();
  });
});

// Record 0044: GitHub puts the id of a job in no variable of its environment.
// The action takes it from `job.check_run_id` as the default of an input,
// which needs no permission.
describe("the id of the running job", () => {
  test("is the job-id input", () => {
    expect(readJobId((name) => (name === "job-id" ? " 106502264185 " : ""))).toBe("106502264185");
  });

  test("is unknown where the runner has no job.check_run_id, and links fall back", () => {
    expect(readJobId(() => "")).toBeUndefined();
  });

  test("anything but a whole number is refused", () => {
    expect(() => readJobId(() => "abc")).toThrow(
      'The "job-id" input must be the id of the running job, a whole number, and it is "abc". Leave it out of the workflow, so it takes the id GitHub gives the job.',
    );
  });
});

// Record 0084 (issue 184): GitHub applies an action's default only when the
// input is absent. A workflow that passes one through, `concurrency: ${{
// inputs.concurrency }}`, sends "" on every trigger that has no such input,
// so an empty optional input means its default. A value that is set and
// wrong still fails.
describe("an empty optional input", () => {
  const scan = (values: Record<string, string>) =>
    readScanInputs((name) => ({ "github-token": "t", ...values })[name] ?? "");
  const apply = (values: Record<string, string>) =>
    readApplyInputs((name) => ({ "github-token": "t", "deployment-id": "12", ...values })[name] ?? "");

  test.each(["", "  ", "\n"])("concurrency %p is the default, 4", (value) => {
    expect(scan({ concurrency: value }).concurrency).toBe(4);
  });

  test.each(["", " \t"])("preview-timeout %p is the default, 10 minutes, in scan and apply", (value) => {
    expect(scan({ "preview-timeout": value }).previewTimeoutMinutes).toBe(10);
    expect(apply({ "preview-timeout": value }).previewTimeoutMinutes).toBe(10);
  });

  test.each(["", "  "])("deploy-timeout %p is no limit", (value) => {
    expect(apply({ "deploy-timeout": value }).deployTimeoutMinutes).toBeUndefined();
  });

  test.each(["", "  "])("strict, dry-run and backend %p are false", (value) => {
    expect(scan({ strict: value }).strict).toBe(false);
    expect(apply({ "dry-run": value }).dryRun).toBe(false);
    expect(readBackend(() => value)).toBe(false);
  });

  test("a good value is read as before", () => {
    expect(scan({ concurrency: "8", "preview-timeout": " 20 " })).toEqual({
      concurrency: 8,
      previewTimeoutMinutes: 20,
      token: "t",
      strict: false,
    });
    expect(apply({ "preview-timeout": "5", "deploy-timeout": "30", "dry-run": "true" })).toEqual({
      deploymentId: 12,
      previewTimeoutMinutes: 5,
      token: "t",
      dryRun: true,
      deployTimeoutMinutes: 30,
    });
  });

  test("a value that is set and wrong still fails", () => {
    expect(() => scan({ concurrency: "four" })).toThrow(
      'The "concurrency" input must be a whole number of 1 or more, and it is "four".',
    );
    expect(() => apply({ "preview-timeout": "0" })).toThrow(
      'The "preview-timeout" input must be a whole number of 1 or more, and it is "0". It is a number of whole minutes.',
    );
    expect(() => apply({ "deploy-timeout": "soon" })).toThrow(
      'The "deploy-timeout" input must be a whole number of 1 or more, and it is "soon". It is a number of whole minutes.',
    );
    expect(() => scan({ strict: "yes" })).toThrow('The "strict" input is true or false, and it is "yes".');
    expect(() => apply({ "dry-run": "1" })).toThrow('The "dry-run" input is true or false, and it is "1".');
    expect(() => readBackend(() => "on")).toThrow('The "backend" input is true or false, and it is "on".');
  });

  // The two inputs that have no default to fall back to still fail when empty.
  test("github-token and, in apply, deployment-id still fail when empty", () => {
    expect(() => scan({ "github-token": " " })).toThrow('The "github-token" input is empty.');
    expect(() => apply({ "deployment-id": " " })).toThrow(
      'The "deployment-id" input is required in apply mode.',
    );
  });
});
