import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import { handedOn, runApply } from "./apply-harness.ts";
import { change, dashboardBody, harness, inSync, pending, tableAdapter } from "./harness.ts";

// Slice 2.20 (record 0051): a stack left out by an `ignore` entry with a
// reason is listed with it under In sync by every writer, and never previewed.

const CONFIG = `
ignore:
  - glob: "legacy:*"
    reason: Deployed by the platform team
`;

const TABLE = {
  "a:prod": pending("a:prod", change("logs")),
  "b:prod": inSync("b:prod"),
  "legacy:prod": pending("legacy:prod", change("never")),
};

const FOLD =
  "<details><summary>1 stack left out by ignore</summary>\n\n- legacy:prod · Deployed by the platform team\n\n</details>";

describe("stacks left out with a reason", () => {
  test("a scan lists them under In sync and does not preview them", async () => {
    const adapter = tableAdapter(TABLE);
    const { context, github } = harness(adapter, { config: CONFIG });

    await scan(context);

    expect(adapter.previewed).not.toContain("legacy:prod");
    const body = dashboardBody(github);
    expect(body).toContain(FOLD);
    expect(body).not.toContain('sluiceway:row stack="legacy:prod"');
  });

  test("resolve and apply list them too, from their own config", async () => {
    const h = await handedOn(TABLE, ["a:prod"], { config: CONFIG });
    // resolve wrote the deploying row.
    expect(dashboardBody(h.github)).toContain(FOLD);

    await runApply(h);

    expect(dashboardBody(h.github)).toContain(FOLD);
  });
});
