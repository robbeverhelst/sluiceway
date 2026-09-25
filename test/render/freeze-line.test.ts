import { describe, expect, test } from "bun:test";
import { type BodyInput, renderBody } from "../../src/render/body.ts";
import { freezeLine } from "../../src/render/freeze-line.ts";

// The freeze line (record 0115): a deploy freeze named once on the
// dashboard, under the scan line, with its reason and its end, while it
// holds and for the week before it starts. Drawn from the config by every
// writer, never from a marker.

const REPO_URL = "https://github.com/example-org/infra";
const STARTS = new Date("2026-12-19T23:00:00Z");
const ENDS = new Date("2027-01-04T23:00:00Z");

describe("freezeLine", () => {
  test("a freeze that holds says until when, why, and that every deploy waits", () => {
    expect(
      freezeLine(
        { reason: "Year-end freeze", starts: STARTS, ends: ENDS, holds: true },
        "Europe/Brussels",
      ),
    ).toBe(
      "Deploy freeze until 2027-01-05 00:00 UTC+1 (Year-end freeze): every deploy waits for it to end.",
    );
  });

  test("a freeze to come says from and until, and names no reason it has not got", () => {
    expect(freezeLine({ starts: STARTS, ends: ENDS, holds: false })).toBe(
      "Deploy freeze from 2026-12-19 23:00 UTC until 2027-01-04 23:00 UTC: every deploy waits while it holds.",
    );
  });

  test("the reason is plain text", () => {
    expect(
      freezeLine({ reason: "@alice's #1 sale", starts: STARTS, ends: ENDS, holds: true }),
    ).toContain("(<span>@</span>alice's <span>#</span>1 sale)");
  });
});

describe("the body", () => {
  const base: BodyInput = {
    root: {
      scanSha: "8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c",
      scanRun: "17034455121",
      scanAt: "2026-12-24T12:00:00Z",
      scanRunning: { run: "17034455999", since: "2026-12-24T12:05:00Z" },
    },
    rows: [],
    recentlyDeployed: [],
    repoUrl: REPO_URL,
    actionRef: "v0.1.0",
    personality: false,
  };
  const freeze = { reason: "Year end", starts: STARTS, ends: ENDS, holds: true };

  test("puts each freeze on a line of its own under the scan line and the scan-running line", () => {
    const lines = renderBody({ ...base, freezes: [freeze, { ...freeze, holds: false }] }).split(
      "\n\n",
    );
    const scan = lines.findIndex((line) => line.startsWith("Scanned"));
    expect(lines[scan + 1]).toStartWith("A scan is running since");
    expect(lines[scan + 2]).toStartWith("Deploy freeze until");
    expect(lines[scan + 3]).toStartWith("Deploy freeze from");
  });

  test("under a header it sits in the centered block with the scan line", () => {
    const body = renderBody({ ...base, personality: true, freezes: [freeze] });
    expect(body).toContain(": every deploy waits for it to end.\n\n</div>");
  });

  test("no freeze, or an empty list, is the body as it was", () => {
    expect(renderBody({ ...base, freezes: [] })).toBe(renderBody(base));
  });
});
