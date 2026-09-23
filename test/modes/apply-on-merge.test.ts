import { describe, expect, test } from "bun:test";
import type { PreviewResult } from "../../src/adapters/adapter.ts";
import { type ApplyContext, apply } from "../../src/modes/apply.ts";
import { scan } from "../../src/modes/scan.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import {
  ACTION_REF,
  change,
  dashboardBody,
  harness,
  pending,
  RUN_ID,
  SHA,
  steppingClock,
  tableAdapter,
} from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";

// Slice 5.31 (record 0094): the record the scan of a merge opens for a stack
// set to on-merge is deployed by `apply` exactly as a tick's record is: the
// same fresh preview, the same hash check, the same refusal when the change
// moved. Only the words differ: whoever merged, never a ticker.

const CONFIG = "stacks:\n  - path: app\n    deploy: on-merge\n";

async function merged(table: Record<string, PreviewResult>) {
  const outputs = rememberingOutputs();
  const adapter = tableAdapter(table);
  const { context, github, log } = harness(adapter, {
    config: CONFIG,
    event: "push",
    mergedBy: "alice",
    outputs,
  });
  github.seedRun(RUN_ID, { completed: false });
  await scan(context);
  const [entry] = JSON.parse(outputs.values.matrix ?? "[]") as { deployment: number }[];
  if (!entry) throw new Error("the scan handed nothing on");
  log.lines.length = 0;
  adapter.previewed.length = 0;
  const applyContext: ApplyContext = {
    root: context.root,
    env: { PATH: "/usr/bin" },
    adapter,
    run: async () => {
      throw new Error("No process here.");
    },
    github,
    log,
    previewTimeoutMinutes: 10,
    now: steppingClock(),
    repoUrl: context.repoUrl,
    // `apply` runs in the run of the scan that handed it on.
    runId: RUN_ID,
    runAttempt: "1",
    sha: SHA,
    actionRef: ACTION_REF,
    deploymentId: entry.deployment,
    event: "push",
  };
  return { github, log, adapter, applyContext, deployment: entry.deployment };
}

describe("apply of a record opened on merge", () => {
  test("previews again, deploys on the same hash, and says merged by, on the row, the trail and the summary", async () => {
    const h = await merged({ "app:prod": pending("app:prod", change("motd")) });
    // The fresh preview gives the scan's diff, and after the deploy nothing.
    let previews = 0;
    h.adapter.preview = async () => {
      h.adapter.previewed.push("app:prod");
      return previews++ === 0 ? pending("app:prod", change("motd")) : pending("app:prod");
    };

    await apply(h.applyContext);

    expect(h.adapter.applied).toEqual(["app:prod"]);
    expect(h.github.deploymentStatuses(h.deployment).at(-1)?.state).toBe("success");
    expect(h.log.lines).toContain(
      `Deployment record ${h.deployment}: app:prod, merged by alice, approved diff hash ${
        (h.github.deployment(h.deployment).payload as { hash: string }).hash
      }. It is in progress.`,
    );
    expect(h.log.summaries.at(-1)).toContain("· deployed · merged by alice ·");
    const body = dashboardBody(h.github);
    expect(body).toContain("- 🟢&nbsp;app:prod · merged by alice ·");
    expect(parseDashboard(body).rows.find((row) => row.stackId === "app:prod")?.state).toBe(
      "in-sync",
    );
  });

  test("a change that moved is refused, and whoever merged is told", async () => {
    const h = await merged({ "app:prod": pending("app:prod", change("motd")) });
    h.adapter.preview = async () => pending("app:prod", change("motd"), change("queue", "create"));

    await expect(apply(h.applyContext)).rejects.toThrow("the change moved since the tick");

    expect(h.adapter.applied).toEqual([]);
    expect(h.github.comments(1)).toEqual([
      "@alice merged a change that **app:prod** deploys on merge, and the change moved before the deploy, so nothing was deployed. The row on the dashboard shows the change as it is now. Tick it to deploy that.",
    ]);
  });
});
