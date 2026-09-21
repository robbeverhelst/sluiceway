// Record 0048: with `scan.logDiff` on, `apply` prints the tool's own diff of
// its fresh preview, values included, in that preview's group of the job log.
// It never decides anything: the diff hash comes from the preview alone.

import { describe, expect, test } from "bun:test";
import { APPLY_JOB_ID, handedOn, rows, runApply, states } from "./apply-harness.ts";
import { change, failing, pending, toolDiffText } from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";
import { RESOLVE_RUN_URL } from "./resolve-harness.ts";

const ON = "scan:\n  logDiff: true\n";
const APPLY_JOB_URL = `${RESOLVE_RUN_URL}/job/${APPLY_JOB_ID}`;

describe("apply with scan.logDiff off", () => {
  test("runs the tool's own diff not at all", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"]);
    await runApply(h);
    expect(h.adapter.toolDiffs).toEqual([]);
  });
});

describe("apply with scan.logDiff on", () => {
  test("prints the tool's own diff of the fresh preview in its group, before the deploy", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
      config: ON,
    });
    const order: string[] = [];
    const { toolDiff, apply } = h.adapter;
    h.adapter.toolDiff = async (stack, options) => {
      order.push("tool diff");
      return toolDiff(stack, options);
    };
    h.adapter.apply = async (stack, context) => {
      order.push("deploy");
      return apply(stack, context);
    };

    await runApply(h);

    expect(order).toEqual(["tool diff", "deploy"]);
    expect(h.adapter.toolDiffTimeouts).toEqual({ "a:prod": 10 });
    expect(h.log.groups.find(({ title }) => title === "a:prod: the fresh preview")).toEqual({
      title: "a:prod: the fresh preview",
      lines: [
        "1 update",
        "update aws:s3/bucket:Bucket bucket · tags",
        "The tool's own diff follows, values included, because scan.logDiff is on in sluiceway.yaml:",
      ],
      verbatim: [toolDiffText("a:prod").trimEnd()],
    });
  });

  test("the value reaches that group and nothing else", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
      config: ON,
    });
    const outputs = rememberingOutputs();
    h.context.outputs = outputs;
    await runApply(h);

    const withValue = h.log.groups.filter((group) => JSON.stringify(group).includes("VALUE-OF"));
    expect(withValue.map(({ title }) => title)).toEqual(["a:prod: the fresh preview"]);
    const elsewhere = [
      h.github.issue(h.number).body,
      JSON.stringify(h.github.deploymentStatuses(h.deployment)),
      JSON.stringify(h.github.deployment(h.deployment)),
      ...h.log.lines,
      ...h.log.summaries,
      JSON.stringify(h.log.warnings),
      JSON.stringify(outputs.calls),
      JSON.stringify(outputs.resultFile("apply")),
    ].join("\n");
    expect(elsewhere).toContain("a:prod");
    expect(elsewhere).not.toContain("VALUE-OF");
  });

  test("a tool diff that fails changes nothing about the deploy", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
      config: ON,
    });
    h.adapter.toolDiff = async () => ({
      ok: false,
      reason: { kind: "tool-error", exitCode: 1 },
      toolLog: "",
    });

    await runApply(h);

    expect(h.adapter.applied).toEqual(["a:prod"]);
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
    expect(
      h.log.groups.find(({ title }) => title === "a:prod: the fresh preview")?.lines,
    ).toContain(
      "The tool's own diff could not be shown: the tool exited with an error (exit code 1). The row and the diff hash come from the preview above and do not depend on it.",
    );
  });

  test("a moved change: the fresh row's preview link lands on this job's log, which holds its tool diff", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
      config: ON,
    });
    h.table["a:prod"] = pending("a:prod", change("bucket"), change("queue", "create"));

    await expect(runApply(h)).rejects.toThrow("the change moved since the tick");

    expect(h.adapter.toolDiffs).toEqual(["a:prod"]);
    expect(rows(h)["a:prod"]).toContain(`· 1 create, 1 update · [preview](${APPLY_JOB_URL})`);
  });

  test("no tool diff for a fresh preview that failed or found nothing to deploy", async () => {
    const failed = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
      config: ON,
    });
    failed.table["a:prod"] = failing();
    await expect(runApply(failed)).rejects.toThrow();
    expect(failed.adapter.toolDiffs).toEqual([]);

    const empty = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
      config: ON,
    });
    empty.table["a:prod"] = pending("a:prod");
    await expect(runApply(empty)).rejects.toThrow("the change moved since the tick");
    expect(empty.adapter.toolDiffs).toEqual([]);
  });

  test("the row made from the preview after a failed deploy links to the summary: no tool diff was run for it", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
      config: ON,
      deploys: {
        "a:prod": { ok: false, reason: { kind: "tool-error", exitCode: 1 }, toolLog: "" },
      },
    });

    await expect(runApply(h)).rejects.toThrow();

    expect(h.adapter.toolDiffs).toEqual(["a:prod"]);
    expect(rows(h)["a:prod"]).toContain(`· 1 update · [preview](${RESOLVE_RUN_URL}/attempts/1)`);
  });

  test("in a public repo the run gets a warning that anyone can read the values", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
      config: ON,
    });
    const event = { ...(h.context.event as object), repository: { private: false } };
    await runApply({ ...h, context: { ...h.context, event } });
    expect(h.log.warnings).toContainEqual({
      title: "Values in the job log of a public repo",
      message:
        "scan.logDiff is on and this repository is public, so anyone can read the values in the tool's own diff in this job log. Turn it off in sluiceway.yaml unless that is what you want.",
    });
  });

  test("a private repo gets no such warning", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
      config: ON,
    });
    const event = { ...(h.context.event as object), repository: { private: true } };
    await runApply({ ...h, context: { ...h.context, event } });
    expect(h.log.warnings).toEqual([]);
  });
});
