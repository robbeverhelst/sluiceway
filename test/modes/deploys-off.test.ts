import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEPLOYS_OFF_NOTE } from "../../src/render/row.ts";
import { handedOn, runApply, states } from "./apply-harness.ts";
import { change, inSync, pending } from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";
import { ALICE, matrix, rowsOf, scanned, tick, wake } from "./resolve-harness.ts";

// Slice 2.20 (record 0051): `deploys: false` in sluiceway.yaml is one
// reviewed line that stops every deploy.

const TABLE = {
  "a:prod": pending("a:prod", change("logs")),
  "b:prod": pending("b:prod", change("logs")),
  "c:prod": inSync("c:prod"),
};

const OFF = "deploys: false\n";

describe("resolve with deploys: false", () => {
  test("clears every ticked box with a note, and creates no record", async () => {
    const h = await scanned(TABLE, { config: OFF });
    tick(h, ALICE, ["a:prod", "b:prod"]);

    await wake(h);

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).not.toContain("createDeployment");
    // Nobody is checked: nothing could deploy whoever ticked.
    expect(h.github.requests).not.toContain("getPermission");
    expect(h.github.comments(h.number)).toEqual([]);
    for (const id of ["a:prod", "b:prod"]) {
      const row = rowsOf(h)[id] ?? "";
      expect(row).toStartWith(`- [ ] **${id}**`);
      expect(row).toContain(`  ${DEPLOYS_OFF_NOTE}`);
    }
    expect(h.log.lines).toContain(
      "a:prod is ticked, and deploys are turned off in sluiceway.yaml (deploys: false). The box is cleared.",
    );
  });

  test("still starts a scan for the rescan box, which deploys nothing", async () => {
    const h = await scanned(TABLE, { config: OFF });
    tick(h, ALICE, [], { rescan: true });

    await wake(h);

    expect(h.github.dispatches).toHaveLength(1);
    expect(matrix(h)).toEqual([]);
  });
});

describe("apply with deploys: false", () => {
  // The tick came before the switch was merged, and apply starts after it.
  test("ends the record before the tool runs, and the job is red", async () => {
    const h = await handedOn(TABLE, ["a:prod"]);
    const outputs = rememberingOutputs();
    h.context.outputs = outputs;
    writeFileSync(join(h.context.root, "sluiceway.yaml"), OFF);

    await expect(runApply(h)).rejects.toThrow(
      "a:prod was not deployed: deploys are turned off in sluiceway.yaml.",
    );

    expect(h.adapter.versionChecks).toBe(0);
    expect(h.adapter.previewed).toEqual([]);
    expect(h.adapter.applied).toEqual([]);
    expect(states(h)).toEqual(["queued", "in_progress", "failure"]);
    expect(h.github.deploymentStatuses(h.deployment).at(-1)?.description).toBe(
      "deploys are turned off in sluiceway.yaml",
    );
    expect(outputs.values.outcome).toBe("refused");
  });
});
