import { describe, expect, test } from "bun:test";
import { ToolVersionError } from "../../../src/adapters/adapter.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import { answering, type Replay, ROOT, replay, VERSIONS } from "./replay.ts";

// The version check of record 0001: one clear error that names the found
// version, the required version and the fix. No warn-and-continue.

function check({ run }: Replay, env = {}): Promise<void> {
  return pulumi.checkVersion({ root: ROOT, env, run }, []);
}

function printing(stdout: string): Replay {
  return answering({ status: "exited", exitCode: 0, stdout, stderr: "" });
}

async function refusal(runner: Replay): Promise<string> {
  const error = await check(runner).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ToolVersionError);
  return (error as ToolVersionError).message;
}

describe("the version check", () => {
  for (const version of VERSIONS) {
    test(`passes on the recorded output of pulumi ${version}`, async () => {
      const runner = replay(version, "version");

      await check(runner, { PATH: "/usr/bin", INPUT_MODE: "scan" });

      expect(runner.runs).toHaveLength(1);
      expect(runner.runs[0]?.env).toEqual({ PATH: "/usr/bin", PULUMI_SKIP_UPDATE_CHECK: "true" });
    });
  }

  for (const newer of ["v3.229.1", "v3.230.0", "v4.0.0", "v3.229.0-alpha.1+dirty", "3.229.0"]) {
    test(`passes on ${newer}`, async () => {
      await check(printing(`${newer}\n`));
    });
  }

  for (const older of ["v3.228.9", "v3.198.0", "v2.999.999"]) {
    test(`refuses ${older}, and names it, the floor and the fix`, async () => {
      expect(await refusal(printing(`${older}\n`))).toBe(
        `Found pulumi ${older}. Sluiceway needs pulumi v3.229.0 or newer. Change the workflow step that installs pulumi so it installs a newer version.`,
      );
    });
  }

  test("a CLI that is not there says that Sluiceway does not install it", async () => {
    expect(await refusal(answering({ status: "not-started" }))).toBe(
      "Could not start pulumi. Sluiceway needs pulumi v3.229.0 or newer on PATH and does not install it. Add a workflow step that installs pulumi before the step that runs Sluiceway.",
    );
  });

  test("output that is no version is not quoted", async () => {
    const message =
      '"pulumi version" did not print a version Sluiceway can read. Sluiceway needs pulumi v3.229.0 or newer. The job log holds what the tool printed.';

    expect(await refusal(printing("warning: something else\n"))).toBe(message);
    expect(
      await refusal(answering({ status: "exited", exitCode: 1, stdout: "v3.263.0\n", stderr: "" })),
    ).toBe(message);
    expect(await refusal(answering({ status: "timed-out", stdout: "", stderr: "" }))).toBe(message);
  });
});
