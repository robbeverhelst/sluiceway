import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ToolVersionError } from "../../src/adapters/adapter.ts";
import { handedOn, rows, runApply, states } from "./apply-harness.ts";
import { change, failing, pending } from "./harness.ts";

// The job is green only when the stack deployed (record 0035). Every other way
// out gives the record a result with a reason from the fixed list (record
// 0022), and the tool's own words stay in the job log.

// A new table for each test, because a test changes its answers.
const table = () => ({ "a:prod": pending("a:prod", change("bucket")) });

describe("a deploy that failed half way", () => {
  const broken = {
    "a:prod": {
      ok: false as const,
      reason: { kind: "tool-error" as const, exitCode: 1 },
      toolLog: "error: exit status 1: running TOKEN=hunter2\n",
    },
  };

  test("the record ends as failure, and the row comes from a preview of what is left", async () => {
    const h = await handedOn(table(), ["a:prod"], { deploys: broken });
    // Half of it went out: a preview now shows less.
    const deploy = h.adapter.apply;
    h.adapter.apply = async (stack, context) => {
      h.table["a:prod"] = pending("a:prod", change("queue", "create"));
      return deploy(stack, context);
    };

    await expect(runApply(h)).rejects.toThrow(
      "a:prod was not deployed: the tool exited with an error (exit code 1).",
    );

    expect(states(h)).toEqual(["queued", "in_progress", "failure"]);
    expect(h.github.deployment(h.deployment).status?.description).toBe(
      "the tool exited with an error (exit code 1)",
    );
    expect(h.adapter.previewed).toEqual(["a:prod", "a:prod"]);
    const row = rows(h)["a:prod"] ?? "";
    expect(row).toStartWith("- [ ] **a:prod** · 1 create · [preview]");
    expect(row).toContain("  :x: last deploy failed: the tool exited with an error (exit code 1)");
    const summary = h.log.summaries.at(-1) ?? "";
    expect(summary).toContain("### What is pending now\n\n1 create");
  });

  test("the tool's words are in the job log and nowhere else", async () => {
    const h = await handedOn(table(), ["a:prod"], { deploys: broken });
    await expect(runApply(h)).rejects.toThrow();

    const group = h.log.groups.find(({ title }) => title === "a:prod: the deploy");
    expect(group?.lines).toContain("error: exit status 1: running TOKEN=hunter2");
    const elsewhere = [
      h.github.issue(h.number).body,
      ...h.log.summaries,
      ...h.log.lines,
      ...h.log.warnings.map(({ message }) => message),
      JSON.stringify(h.github.deploymentStatuses(h.deployment)),
    ].join("\n");
    expect(elsewhere).not.toContain("hunter2");
  });
});

describe("before the tool deploys", () => {
  test("a fresh preview that fails deploys nothing and gives a preview failure row", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.table["a:prod"] = failing();

    await expect(runApply(h)).rejects.toThrow(
      "a:prod was not deployed: the preview before the deploy failed: the tool exited with an error (exit code 255).",
    );

    expect(h.adapter.applied).toEqual([]);
    expect(states(h)).toEqual(["queued", "in_progress", "failure"]);
    expect(rows(h)["a:prod"]).toStartWith(
      "- **a:prod** · preview failed: the tool exited with an error (exit code 255) · [run]",
    );
  });

  test("a tool that is missing or too old deploys nothing, and the row is left to the next scan", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    const deploying = rows(h)["a:prod"];
    h.adapter.checkVersion = async () => {
      throw new ToolVersionError(
        "Found pulumi v3.198.0. Sluiceway needs pulumi v3.229.0 or newer.",
      );
    };

    await expect(runApply(h)).rejects.toThrow("Found pulumi v3.198.0.");

    expect(h.adapter.previewed).toEqual([]);
    expect(states(h)).toEqual(["queued", "in_progress", "failure"]);
    expect(h.github.deployment(h.deployment).status?.description).toBe(
      "the tool is missing or older than Sluiceway needs",
    );
    expect(rows(h)["a:prod"]).toBe(deploying);
  });

  test("a stack that discovery no longer finds deploys nothing", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    writeFileSync(join(h.context.root, "sluiceway.yaml"), 'ignore: ["a:*"]\n');

    await expect(runApply(h)).rejects.toThrow("the stack is not in the repo any more");

    expect(h.adapter.versionChecks).toBe(0);
    expect(h.adapter.previewed).toEqual([]);
    expect(states(h)).toEqual(["queued", "in_progress", "failure"]);
  });

  test("a broken sluiceway.yaml deploys nothing and the record still gets its result", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    writeFileSync(join(h.context.root, "sluiceway.yaml"), "tickerz: write\n");

    await expect(runApply(h)).rejects.toThrow("the deploy stopped before the tool ran");

    expect(h.adapter.previewed).toEqual([]);
    expect(states(h)).toEqual(["queued", "in_progress", "failure"]);
  });
});

describe("an error nobody planned for", () => {
  // Every way out after `in_progress` gives the record a result, so a row
  // never stays deploying until `settle` comes along.
  test("before the tool deploys, the record ends as failure and nothing went out", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.adapter.preview = async () => {
      throw new Error("the runner broke");
    };
    await expect(runApply(h)).rejects.toThrow("the runner broke");
    expect(h.adapter.applied).toEqual([]);
    expect(states(h)).toEqual(["queued", "in_progress", "failure"]);
    expect(h.github.deployment(h.deployment).status?.description).toBe(
      "the deploy stopped before the tool ran",
    );
  });

  test("while the tool deploys, the record ends as failure of the tool", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.adapter.apply = async () => {
      throw new Error("the runner broke");
    };
    await expect(runApply(h)).rejects.toThrow("the runner broke");
    expect(states(h)).toEqual(["queued", "in_progress", "failure"]);
    expect(h.github.deployment(h.deployment).status?.description).toBe(
      "the tool exited with an error",
    );
  });
});

describe("after the deploy", () => {
  // The record is the truth. The dashboard is a view (record 0004).
  test("a dashboard that cannot be written leaves the success on the record and turns the job red", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.github.updateIssueBody = async () => {
      throw new Error("Server Error");
    };

    await expect(runApply(h)).rejects.toThrow("The dashboard could not be written: Server Error");

    expect(h.adapter.applied).toEqual(["a:prod"]);
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
    expect(h.log.summaries.at(-1)).toContain("**a:prod** · deployed");
  });

  test("a summary that cannot be written changes nothing about the result", async () => {
    const h = await handedOn(table(), ["a:prod"]);
    h.log.writeSummary = async () => {
      throw new Error("no summary file");
    };
    await runApply(h);
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
    expect(h.log.warnings.map(({ title }) => title)).toEqual(["Summary not written"]);
  });
});
