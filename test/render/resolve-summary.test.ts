import { describe, expect, test } from "bun:test";
import { resolveSummary } from "../../src/render/resolve-summary.ts";

// Slice 5.9: the job summary of `resolve`. It holds what the job log says
// about every tick, in Sluiceway's own words, and a link to the scan it
// started. `resolve` runs no tool, so no tool's words can reach it.
describe("the job summary of resolve", () => {
  test("lists what happened to every tick, and links the scan it started", () => {
    expect(
      resolveSummary({
        lines: [
          "network:prod was ticked by alice.",
          "network:prod: deployment record 7 is queued.",
          "The rescan box was ticked by bob.",
        ],
        scanUrl: "https://github.com/acme/infra/actions/runs/99",
      }),
    ).toBe(
      [
        "### Sluiceway resolve",
        "",
        "- network:prod was ticked by alice.",
        "- network:prod: deployment record 7 is queued.",
        "- The rescan box was ticked by bob.",
        "",
        "It started [a scan](https://github.com/acme/infra/actions/runs/99).",
        "",
      ].join("\n"),
    );
  });

  test("a line is never markup", () => {
    expect(resolveSummary({ lines: ["apps/<b>_x_:prod was ticked by alice."] })).toContain(
      "- apps/&lt;b&gt;&#95;x&#95;:prod was ticked by alice.",
    );
  });

  test("a scan that GitHub started without naming its run is said without a link", () => {
    expect(resolveSummary({ lines: [], scanStarted: true })).toBe(
      "### Sluiceway resolve\n\nNothing to report.\n\nIt started a scan.\n",
    );
  });
});
