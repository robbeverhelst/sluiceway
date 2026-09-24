// What a change costs (record 0105): the change to the monthly bill that a
// preview of an OpenTofu or Terraform stack can carry, estimated by the
// Infracost CLI from the saved plan, and the threshold that turns a stack set
// to on-merge back to a tick. The estimate is never part of the diff hash: it
// is derived from the plan, and the hash already covers what changes. It
// reads nothing and decides from the numbers alone, never from the
// estimator's words (record 0022).

// The change to the monthly bill, as a delta and never the bill itself: more
// than 0 costs more, less than 0 saves. `currency` is the estimator's
// (ISO 4217, USD unless the workflow sets another).
export interface CostEstimate {
  monthly: number;
  currency: string;
}

// Why no estimate came back. Only facts Sluiceway produced itself: an exit
// code, a time limit, a shape it could not read, an error the tool reported
// as data. Never a word the tool wrote.
export type CostFailure =
  // The CLI is not on PATH: the workflow did not install it.
  | { kind: "not-started" }
  | { kind: "exited"; exitCode: number | null }
  | { kind: "timed-out"; minutes: number }
  | { kind: "unreadable-output" }
  // The CLI ended well and its output says, as data, that it could not
  // price the plan: a pricing API it could not reach, for one.
  | { kind: "reported-error" };

export type CostResult =
  | { ok: true; estimate: CostEstimate }
  // `detail` is Sluiceway's own words on what went wrong, for the job log.
  | { ok: false; reason: CostFailure; detail: string[] };

export function costFailureText(reason: CostFailure): string {
  switch (reason.kind) {
    case "not-started":
      return "the Infracost CLI could not be started";
    case "exited":
      return reason.exitCode === null
        ? "the Infracost CLI exited with an error"
        : `the Infracost CLI exited with an error (exit code ${reason.exitCode})`;
    case "timed-out":
      return `the estimate timed out after ${reason.minutes} ${reason.minutes === 1 ? "minute" : "minutes"}`;
    case "unreadable-output":
      return "the Infracost CLI's output could not be read";
    case "reported-error":
      return "the Infracost CLI reported that it could not price the plan";
  }
}

// `cost` of sluiceway.yaml, resolved for one stack: the top level, with what
// the stack's entry sets on top, key by key.
export interface CostSettings {
  enabled: boolean;
  // The monthly delta above which a stack set to on-merge waits for a tick,
  // in the estimate's currency. Absent, no threshold gates anything.
  threshold?: number | undefined;
}

export function costSettings(
  top: { enabled: boolean; threshold?: number | undefined },
  entry?: { enabled?: boolean | undefined; threshold?: number | undefined },
): CostSettings {
  const threshold = entry?.threshold ?? top.threshold;
  return {
    enabled: entry?.enabled ?? top.enabled,
    ...(threshold === undefined ? {} : { threshold }),
  };
}

// Why the threshold holds a stack set to on-merge back. Its row says so.
export type CostWait =
  | { kind: "cost"; monthly: number; currency: string; threshold: number }
  // The threshold is set and the estimate failed, so nobody knows what the
  // change costs. The gate fails closed: a person decides (record 0105).
  | { kind: "cost-unknown"; threshold: number };

// `cost` is absent for a stack whose tool has no estimate, such as a Pulumi
// stack, and for a preview that was not asked for one. A threshold means
// nothing to such a stack, and the docs say which tools get an estimate.
export function costWait(
  cost: CostResult | undefined,
  threshold: number | undefined,
): CostWait | undefined {
  if (threshold === undefined || cost === undefined) return undefined;
  if (!cost.ok) return { kind: "cost-unknown", threshold };
  const { monthly, currency } = cost.estimate;
  return monthly > threshold ? { kind: "cost", monthly, currency, threshold } : undefined;
}
