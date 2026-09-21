import { describe, expect, test } from "bun:test";
import { resolveOnItsWay, tickAtLateRead } from "../../src/core/orphan-tick.ts";

describe("whether a run that an issue edit started is still on its way (record 0025)", () => {
  test("no runs at all: nothing is on its way", () => {
    expect(resolveOnItsWay([], "4242")).toBe(false);
  });

  test("runs that are over do not count", () => {
    expect(
      resolveOnItsWay(
        [
          { id: "9", completed: true },
          { id: "8", completed: true },
        ],
        "4242",
      ),
    ).toBe(false);
  });

  test("one run that is not over is enough, however old", () => {
    expect(
      resolveOnItsWay(
        [
          { id: "9", completed: true },
          { id: "8", completed: true },
          { id: "7", completed: false },
        ],
        "4242",
      ),
    ).toBe(true);
  });

  test("the scan's own run is never the run it waits for", () => {
    expect(resolveOnItsWay([{ id: "4242", completed: false }], "4242")).toBe(false);
  });
});

describe("what a scan does with a ticked row whose stack has no open deployment", () => {
  const HASH = "0123456789abcdef";
  const OTHER = "fedcba9876543210";

  describe("with a run on its way: hands off", () => {
    test("a row the scan keeps as it is keeps its tick", () => {
      expect(
        tickAtLateRead({
          liveHash: HASH,
          writes: { row: "live", previewed: false },
          resolveOnItsWay: true,
        }),
      ).toBe("carry");
    });

    test("a fresh row of the same diff hash carries the tick", () => {
      expect(
        tickAtLateRead({
          liveHash: HASH,
          writes: { row: "fresh", hash: HASH },
          resolveOnItsWay: true,
        }),
      ).toBe("carry");
    });

    test("a fresh row of another diff hash cannot: the tick approved what the row no longer shows", () => {
      expect(
        tickAtLateRead({
          liveHash: HASH,
          writes: { row: "fresh", hash: OTHER },
          resolveOnItsWay: true,
        }),
      ).toBe("sweep");
    });

    test("a fresh row without a box has nothing to carry a tick on", () => {
      expect(
        tickAtLateRead({
          liveHash: HASH,
          writes: { row: "fresh", hash: undefined },
          resolveOnItsWay: true,
        }),
      ).toBe("sweep");
    });

    test("a ticked row without a diff hash is no tick `resolve` would act on", () => {
      expect(
        tickAtLateRead({
          liveHash: undefined,
          writes: { row: "fresh", hash: undefined },
          resolveOnItsWay: true,
        }),
      ).toBe("sweep");
    });
  });

  describe("with no run on its way: an orphan tick", () => {
    test("a fresh row sweeps it, also at the same diff hash", () => {
      expect(
        tickAtLateRead({
          liveHash: HASH,
          writes: { row: "fresh", hash: HASH },
          resolveOnItsWay: false,
        }),
      ).toBe("sweep");
    });

    test("a row the scan has no preview for is previewed first, because only a fresh row can carry the note", () => {
      expect(
        tickAtLateRead({
          liveHash: HASH,
          writes: { row: "live", previewed: false },
          resolveOnItsWay: false,
        }),
      ).toBe("preview-first");
    });

    test("a live row the scan keeps although it previewed the stack is left to the next scan", () => {
      expect(
        tickAtLateRead({
          liveHash: HASH,
          writes: { row: "live", previewed: true },
          resolveOnItsWay: false,
        }),
      ).toBe("next-scan");
    });
  });
});
