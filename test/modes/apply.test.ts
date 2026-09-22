import { describe, expect, test } from "bun:test";
import { handedOn, rows, runApply, states } from "./apply-harness.ts";
import { change, pending } from "./harness.ts";
import { RESOLVE_RUN_URL } from "./resolve-harness.ts";

// The apply mode (records 0008, 0019, 0021 and 0035): the job that deploys one
// stack from the deployment record `resolve` handed on. Only what the row
// showed goes out, and a re-run deploys nothing.

describe("a deploy that goes out", () => {
  test("the record ends as success, the stack deployed once, and its row is in sync", async () => {
    const h = await handedOn(
      { "a:prod": pending("a:prod", change("bucket")), "b:prod": pending("b:prod", change("x")) },
      ["a:prod"],
    );
    const before = rows(h)["b:prod"];

    await runApply(h);

    expect(h.adapter.applied).toEqual(["a:prod"]);
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
    expect(rows(h)["a:prod"]).toBe(
      '- a:prod <!-- sluiceway:row stack="a:prod" state="in-sync" -->\n  <!-- /sluiceway:row -->',
    );
    // Every other row is carried byte for byte (record 0004).
    expect(rows(h)["b:prod"]).toBe(before);
    // Recently deployed names the deploy and the run that made it.
    const recently = h.github.issue(h.number).body.split("## Recently deployed\n\n")[1] ?? "";
    expect(recently.split("\n")[0]).toStartWith("- 🟢&nbsp;a:prod · ticked by alice · ");
    expect(recently.split("\n")[0]).toEndWith(` · [run](${RESOLVE_RUN_URL})`);
  });
});

describe("while the deploy runs", () => {
  test("the row says deploying, no longer waiting to start, with the fresh diff's destroys", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket", "delete")) }, [
      "a:prod",
    ]);
    const deploy = h.adapter.apply;
    let during = "";
    h.adapter.apply = async (stack, context) => {
      during = rows(h)["a:prod"] ?? "";
      return deploy(stack, context);
    };

    await runApply(h);

    expect(during).toBe(
      `- **a:prod** · deploying · ticked by alice · [run](${RESOLVE_RUN_URL}) <!-- sluiceway:row stack="a:prod" state="deploying" destroys="1" -->\n  not deployed from this dashboard yet\n  <!-- /sluiceway:row -->`,
    );
  });

  test("every status carries the run, and the success has no reason", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"]);
    await runApply(h);
    expect(
      h.github
        .deploymentStatuses(h.deployment)
        .map(({ state, description }) => [state, description]),
    ).toEqual([
      ["queued", ""],
      ["in_progress", ""],
      ["success", ""],
    ]);
  });

  test("the fresh preview has the stack's own time limit, else the input's", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"], {
      config: "stacks:\n  - path: a\n    previewTimeout: 3\n",
    });
    h.context.previewTimeoutMinutes = 20;
    await runApply(h);
    expect(h.adapter.timeouts["a:prod"]).toBe(3);
  });
});

describe("another stack's deploys", () => {
  // Every status is sent with auto_inactive false (record 0003, issue 27). The
  // fake flips earlier successes in the environment a request later when a
  // writer leaves it out.
  test("another stack's success in the same environment stays a success", async () => {
    const h = await handedOn(
      { "a:prod": pending("a:prod", change("bucket")), "b:prod": pending("b:prod", change("x")) },
      ["a:prod"],
    );
    const other = h.github.seedDeployment({
      task: "sluiceway:b:prod",
      payload: { v: 1, hash: "0000000000000000", ticker: "bob", run: "1" },
      status: { state: "success" },
    });

    await runApply(h);
    await h.github.listNewestDeployments("sluiceway");
    await h.github.listNewestDeployments("sluiceway");

    expect(h.github.deployment(other.id).status?.state).toBe("success");
    expect(h.github.deployment(h.deployment).status?.state).toBe("success");
  });
});

describe("the change moved since the tick (record 0008)", () => {
  test("nothing goes out, the record ends as error, and the row shows the fresh diff", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"]);
    // A merge after the tick adds a change.
    h.table["a:prod"] = pending("a:prod", change("bucket"), change("queue", "create"));

    await expect(runApply(h)).rejects.toThrow(
      "a:prod was not deployed: the change moved since the tick.",
    );

    expect(h.adapter.applied).toEqual([]);
    expect(states(h)).toEqual(["queued", "in_progress", "error"]);
    expect(h.github.deployment(h.deployment).status?.description).toBe(
      "the change moved since the tick",
    );
    const row = rows(h)["a:prod"] ?? "";
    // The preview link lands on the summary of this attempt (record 0044).
    expect(row).toStartWith(
      `- [ ] **a:prod** · 1 create, 1 update · [preview](${RESOLVE_RUN_URL}/attempts/1)`,
    );
    expect(row).toContain(
      "  :x: last deploy failed: the change moved since the tick · ticked by alice · ",
    );
    expect(row).toContain("<b>queue</b>");
    // The summary shows the fresh diff, which the row's preview link points at.
    expect(h.log.summaries.at(-1)).toContain(
      "**a:prod** · not deployed: the change moved since the tick · ticked by alice",
    );
    expect(h.log.summaries.at(-1)).toContain("<b>queue</b>");
  });

  // Record 0051 changed this: an empty fresh preview is the outside deploy
  // that record 0016 calls legal, not a moved change. Nothing to deploy, a
  // success, a green job and no failure line.
  test("a stack that was deployed outside Sluiceway comes back in sync, and nothing goes out", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"]);
    h.table["a:prod"] = pending("a:prod");

    await runApply(h);

    expect(h.adapter.applied).toEqual([]);
    expect(states(h)).toEqual(["queued", "in_progress", "success"]);
    expect(rows(h)["a:prod"]).toStartWith(
      '- a:prod <!-- sluiceway:row stack="a:prod" state="in-sync" -->',
    );
  });

  test("a change to a value alone is the blind spot of the hash and still goes out", async () => {
    // Same address, op and keys (record 0008): the hash is the same.
    const h = await handedOn({ "a:prod": pending("a:prod", change("bucket")) }, ["a:prod"]);
    h.table["a:prod"] = pending("a:prod", change("bucket"));
    await runApply(h);
    expect(h.adapter.applied).toEqual(["a:prod"]);
  });
});
