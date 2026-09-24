import { describe, expect, test } from "bun:test";
import { ALREADY_ENDED } from "../../src/render/apply-summary.ts";
import type { SeedDeployment } from "../fake-github/deployments.ts";
import { handedOn, runApply, states } from "./apply-harness.ts";
import { change, pending } from "./harness.ts";
import { RESOLVE_RUN } from "./resolve-harness.ts";

// A deploy only ever starts from an open deployment record of Sluiceway's, in
// the run that created it (records 0019 and 0035). Everything else deploys
// nothing and turns the job red.

const TABLE = { "a:prod": pending("a:prod", change("bucket")) };

describe("a record that already ended (record 0019)", () => {
  for (const [how, end] of [
    ["deployed", "success"],
    ["failed", "failure"],
    ["was settled after a cancel", "error"],
    ["was superseded", "inactive"],
  ] as const) {
    test(`a re-run of a deploy that ${how} costs one request and no tool call`, async () => {
      const h = await handedOn(TABLE, ["a:prod"]);
      h.github.addDeploymentStatus(h.deployment, { state: end, autoInactive: false });
      h.github.requests.length = 0;

      await expect(runApply(h)).rejects.toThrow(ALREADY_ENDED);

      expect(h.github.requests).toEqual(["latestDeploymentStatus"]);
      expect(h.adapter.versionChecks).toBe(0);
      expect(h.adapter.previewed).toEqual([]);
      expect(h.adapter.applied).toEqual([]);
      expect(h.log.summaries.at(-1)).toBe(`## Sluiceway apply\n\n${ALREADY_ENDED}\n`);
    });
  }

  test("the job run again after a good deploy deploys nothing the second time", async () => {
    const h = await handedOn(TABLE, ["a:prod"]);
    await runApply(h);
    await expect(runApply(h)).rejects.toThrow(ALREADY_ENDED);
    expect(h.adapter.applied).toEqual(["a:prod"]);
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
  });
});

describe("a record that is not for this job", () => {
  async function withRecord(seed: SeedDeployment) {
    const h = await handedOn(TABLE, ["a:prod"]);
    const record = h.github.seedDeployment(seed);
    h.context.deploymentId = record.id;
    h.github.requests.length = 0;
    return { h, id: record.id };
  }

  test("a record that is not Sluiceway's is left alone", async () => {
    const { h, id } = await withRecord({ task: "deploy" });
    await expect(runApply(h)).rejects.toThrow("is not one of Sluiceway's");
    expect(h.github.requests).toEqual(["latestDeploymentStatus", "getDeployment"]);
    expect(h.github.deploymentStatuses(id)).toEqual([]);
    expect(h.adapter.previewed).toEqual([]);
  });

  test("a record with a payload of another version is left alone", async () => {
    const { h, id } = await withRecord({ task: "sluiceway:a:prod", payload: { v: 2 } });
    await expect(runApply(h)).rejects.toThrow("cannot read");
    expect(h.github.deploymentStatuses(id)).toEqual([]);
    expect(h.adapter.previewed).toEqual([]);
  });

  // A record lives as long as its run (record 0003). Deployed from another
  // run, a scan could end it while the deploy is still going.
  test("a record of another run is left alone", async () => {
    const { h, id } = await withRecord({
      task: "sluiceway:a:prod",
      payload: { v: 1, hash: "0000000000000000", ticker: "alice", run: "999" },
    });
    await expect(runApply(h)).rejects.toThrow(`belongs to run 999, and this is run ${RESOLVE_RUN}`);
    expect(h.github.deploymentStatuses(id)).toEqual([]);
    expect(h.adapter.previewed).toEqual([]);
  });

  // A queued record waits behind the stacks it depends on (record 0056). A
  // later `resolve` starts it under a record of its own run.
  test("a queued record is left alone", async () => {
    const { h, id } = await withRecord({
      task: "sluiceway:a:prod",
      payload: {
        v: 1,
        hash: "0000000000000000",
        ticker: "alice",
        run: RESOLVE_RUN,
        behind: ["b:prod"],
      },
      status: { state: "queued" },
    });
    await expect(runApply(h)).rejects.toThrow(
      "is queued behind b:prod. `apply` never deploys a queued record: a later `resolve` starts it once that stack went out. Nothing was deployed and the record was left alone.",
    );
    expect(h.github.deploymentStatuses(id)).toHaveLength(1);
    expect(h.adapter.previewed).toEqual([]);
  });

  test("a record GitHub does not have fails with the permission the job needs", async () => {
    const h = await handedOn(TABLE, ["a:prod"]);
    h.context.deploymentId = 999_999;
    await expect(runApply(h)).rejects.toThrow("`deployments: write`");
    expect(h.adapter.previewed).toEqual([]);
  });

  test("a record that cannot be marked in progress deploys nothing", async () => {
    const h = await handedOn(TABLE, ["a:prod"]);
    const write = h.github.createDeploymentStatus.bind(h.github);
    h.github.createDeploymentStatus = async () => {
      throw new Error("Resource not accessible by integration");
    };
    await expect(runApply(h)).rejects.toThrow("could not be marked in progress");
    h.github.createDeploymentStatus = write;
    expect(h.adapter.previewed).toEqual([]);
    expect(h.adapter.applied).toEqual([]);
  });

  // A record that waits for the deploy window (record 0104) is started by a
  // run inside the window, under a record of its own.
  test("a record that waits for the deploy window is left alone", async () => {
    const { h, id } = await withRecord({
      task: "sluiceway:a:prod",
      payload: {
        v: 1,
        hash: "0000000000000000",
        ticker: "alice",
        run: RESOLVE_RUN,
        window: true,
      },
      status: { state: "queued" },
    });
    await expect(runApply(h)).rejects.toThrow(
      "waits for the deploy window of a:prod. `apply` never deploys a queued record: a run inside the window starts it. Nothing was deployed and the record was left alone.",
    );
    expect(h.github.deploymentStatuses(id)).toHaveLength(1);
    expect(h.adapter.previewed).toEqual([]);
  });
});
