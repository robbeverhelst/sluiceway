// Record 0052: the scan and `apply` hand `dashboard.showValues` to the
// adapter, and `dashboard.redact` turns it off, so no value is even read.

import { describe, expect, test } from "bun:test";
import type { PreviewOptions, PreviewResult } from "../../src/adapters/adapter.ts";
import { scan } from "../../src/modes/scan.ts";
import { handedOn, runApply } from "./apply-harness.ts";
import { dashboardBody, harness, tableAdapter } from "./harness.ts";

const LIST = "dashboard:\n  showValues:\n    - version\n    - values.image.tag\n";

// A preview that remembers the list it was handed and gives a Helm release
// with a value at `version` when that path is listed, as the adapter does.
function release(asked: (readonly string[] | undefined)[]) {
  return async (options: PreviewOptions): Promise<PreviewResult> => {
    asked.push(options.showValues);
    const listed = options.showValues?.includes("version") === true;
    return {
      ok: true,
      toolLog: "",
      diff: {
        stackId: "apps:prod",
        changes: [
          {
            address: "urn:odoo",
            type: "kubernetes:helm.sh/v3:Release",
            name: "odoo-release",
            op: "update",
            changedKeys: ["version"],
            replaceKeys: [],
            ...(listed ? { values: [{ path: "version", old: "17.0.3", new: "17.0.4" }] } : {}),
          },
        ],
      },
    };
  };
}

describe("the scan", () => {
  test("hands the adapter an empty list when the file sets none", async () => {
    const asked: (readonly string[] | undefined)[] = [];
    const { context, github } = harness(tableAdapter({ "apps:prod": release(asked) }));
    await scan(context);

    expect(asked).toEqual([[]]);
    expect(dashboardBody(github)).not.toContain("17.0.");
  });

  test("hands the adapter the list, and the row shows the version bump", async () => {
    const asked: (readonly string[] | undefined)[] = [];
    const { context, github } = harness(tableAdapter({ "apps:prod": release(asked) }), {
      config: LIST,
    });
    await scan(context);

    expect(asked).toEqual([["version", "values.image.tag"]]);
    expect(dashboardBody(github)).toContain(
      "<code>version</code> <code>17.0.3</code> → <code>17.0.4</code>",
    );
  });

  test("with redact on hands the adapter an empty list, so no value is read at all", async () => {
    const asked: (readonly string[] | undefined)[] = [];
    const { context, github, log } = harness(tableAdapter({ "apps:prod": release(asked) }), {
      config: `${LIST}  redact: true\n`,
    });
    await scan(context);

    expect(asked).toEqual([[]]);
    expect(dashboardBody(github)).not.toContain("17.0.");
    expect(log.summaries.join("\n")).not.toContain("17.0.");
  });
});

describe("apply", () => {
  // The fresh preview is the scan's call, with the same list, so the row it
  // writes after a moved change shows what the scan's row showed.
  test("hands its fresh preview the same list", async () => {
    const asked: (readonly string[] | undefined)[] = [];
    const answer = release(asked);
    const table = { "apps:prod": answer } as unknown as Record<string, PreviewResult>;
    const h = await handedOn(table, ["apps:prod"], {
      config: LIST,
    });
    asked.length = 0;
    await runApply(h);

    expect(asked[0]).toEqual(["version", "values.image.tag"]);
  });
});

// Records 0008 and 0052: a value the row showed is part of what the tick
// approved. A merge that moves it after the tick stops the deploy, and the
// row comes back with the value the code has now.
describe("a listed value that moved since the tick", () => {
  function bump(to: string): PreviewResult {
    return {
      ok: true,
      toolLog: "",
      diff: {
        stackId: "apps:prod",
        changes: [
          {
            address: "urn:odoo",
            type: "kubernetes:helm.sh/v3:Release",
            name: "odoo-release",
            op: "update",
            changedKeys: ["version"],
            replaceKeys: [],
            values: [{ path: "version", old: "17.0.3", new: to }],
          },
        ],
      },
    };
  }

  test("deploys nothing, and the row shows the new value", async () => {
    const h = await handedOn({ "apps:prod": bump("17.0.4") }, ["apps:prod"], { config: LIST });
    h.table["apps:prod"] = bump("17.0.5");

    await expect(runApply(h)).rejects.toThrow("the change moved since the tick");
    expect(h.adapter.applied).toEqual([]);
    expect(dashboardBody(h.github, h.number)).toContain(
      "<code>version</code> <code>17.0.3</code> → <code>17.0.5</code>",
    );
  });

  test("the same value deploys", async () => {
    const h = await handedOn({ "apps:prod": bump("17.0.4") }, ["apps:prod"], { config: LIST });

    await runApply(h);
    expect(h.adapter.applied).toEqual(["apps:prod"]);
  });
});
