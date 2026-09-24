import { describe, expect, test } from "bun:test";
import { type CostResult, costFailureText, costSettings, costWait } from "../../src/core/cost.ts";

// Record 0105: what a change costs a month rides on the row as a delta, and a
// threshold turns a stack set to on-merge back to a tick. The gate is decided
// here, from the estimate and the threshold alone, and never from the words
// of the estimator.

const estimated = (monthly: number, currency = "USD"): CostResult => ({
  ok: true,
  estimate: { monthly, currency },
});

const failed: CostResult = {
  ok: false,
  reason: { kind: "exited", exitCode: 1 },
  detail: [],
};

describe("costSettings", () => {
  test("the top level decides when no entry sets anything", () => {
    expect(costSettings({ enabled: false })).toEqual({ enabled: false });
    expect(costSettings({ enabled: true, threshold: 50 })).toEqual({
      enabled: true,
      threshold: 50,
    });
  });

  test("an entry turns it on or off and sets its own threshold, key by key", () => {
    expect(costSettings({ enabled: true, threshold: 50 }, { enabled: false })).toEqual({
      enabled: false,
      threshold: 50,
    });
    expect(costSettings({ enabled: false }, { enabled: true, threshold: 10 })).toEqual({
      enabled: true,
      threshold: 10,
    });
    expect(costSettings({ enabled: true, threshold: 50 }, { threshold: 200 })).toEqual({
      enabled: true,
      threshold: 200,
    });
  });
});

describe("costWait", () => {
  test("without a threshold nothing waits, whatever the estimate", () => {
    expect(costWait(estimated(10_000), undefined)).toBeUndefined();
    expect(costWait(failed, undefined)).toBeUndefined();
    expect(costWait(undefined, undefined)).toBeUndefined();
  });

  test("a change that costs more than the threshold a month waits, and the wait names both", () => {
    expect(costWait(estimated(120.5), 100)).toEqual({
      kind: "cost",
      monthly: 120.5,
      currency: "USD",
      threshold: 100,
    });
  });

  test("a change at or under the threshold goes, and so does one that saves money", () => {
    expect(costWait(estimated(100), 100)).toBeUndefined();
    expect(costWait(estimated(99.99), 100)).toBeUndefined();
    expect(costWait(estimated(-500), 100)).toBeUndefined();
    expect(costWait(estimated(0), 0)).toBeUndefined();
    expect(costWait(estimated(0.01), 0)).toEqual({
      kind: "cost",
      monthly: 0.01,
      currency: "USD",
      threshold: 0,
    });
  });

  test("an estimate that failed waits when a threshold is set: the gate fails closed", () => {
    expect(costWait(failed, 100)).toEqual({ kind: "cost-unknown", threshold: 100 });
  });

  test("a stack whose tool has no estimate is not gated: the threshold means nothing to it", () => {
    expect(costWait(undefined, 100)).toBeUndefined();
  });
});

describe("costFailureText", () => {
  test("says why in Sluiceway's own words, never the estimator's", () => {
    expect(costFailureText({ kind: "not-started" })).toBe("the Infracost CLI could not be started");
    expect(costFailureText({ kind: "exited", exitCode: 1 })).toBe(
      "the Infracost CLI exited with an error (exit code 1)",
    );
    expect(costFailureText({ kind: "exited", exitCode: null })).toBe(
      "the Infracost CLI exited with an error",
    );
    expect(costFailureText({ kind: "timed-out", minutes: 10 })).toBe(
      "the estimate timed out after 10 minutes",
    );
    expect(costFailureText({ kind: "timed-out", minutes: 1 })).toBe(
      "the estimate timed out after 1 minute",
    );
    expect(costFailureText({ kind: "unreadable-output" })).toBe(
      "the Infracost CLI's output could not be read",
    );
    expect(costFailureText({ kind: "reported-error" })).toBe(
      "the Infracost CLI reported that it could not price the plan",
    );
  });
});
