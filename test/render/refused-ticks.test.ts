import { describe, expect, test } from "bun:test";
import type { TickRule } from "../../src/core/config.ts";
import { type RefusedTick, refusedTicksComment } from "../../src/render/refused-ticks.ts";

function refused(over: Partial<RefusedTick> = {}): RefusedTick {
  return {
    target: { kind: "stack", stackId: "network:prod", rule: "admin" },
    login: "alice",
    reason: "below-level",
    ...over,
  };
}

describe("one refused tick", () => {
  test("mentions the ticker, names the stack and states the level", () => {
    expect(refusedTicksComment([refused()])).toBe(
      "@alice ticked **network:prod**. The tick was refused: the tick rule of this stack is `admin`, which takes admin access to this repository. Nothing was started and the box is cleared.",
    );
  });

  test("states the level that the rule names", () => {
    const comment = refusedTicksComment([
      refused({ target: { kind: "stack", stackId: "app:prod", rule: "maintain" } }),
    ]);
    expect(comment).toContain(
      "the tick rule of this stack is `maintain`, which takes maintain access to this repository.",
    );
  });

  test("states a list by naming the people on it, in plain logins that notify no one", () => {
    const comment = refusedTicksComment([
      refused({
        target: { kind: "stack", stackId: "network:prod", rule: ["bob", "carol_corp"] },
        reason: "not-on-list",
      }),
    ]);
    expect(comment).toBe(
      "@alice ticked **network:prod**. The tick was refused: the tick rule of this stack names who can tick it: bob, carol&#95;corp. Nothing was started and the box is cleared.",
    );
  });

  test("says that ticking needs write access, whatever the rule is", () => {
    const rules: TickRule[] = ["write", "admin", ["alice"]];
    for (const rule of rules) {
      expect(
        refusedTicksComment([
          refused({
            target: { kind: "stack", stackId: "site", rule },
            reason: "no-write-access",
          }),
        ]),
      ).toBe(
        "@alice ticked **site**. The tick was refused: ticking needs write access to this repository. Nothing was started and the box is cleared.",
      );
    }
  });

  test("names the rescan box", () => {
    expect(
      refusedTicksComment([refused({ target: { kind: "rescan" }, reason: "no-write-access" })]),
    ).toBe(
      "@alice ticked the rescan box. The tick was refused: ticking needs write access to this repository. Nothing was started and the box is cleared.",
    );
  });

  test("a stack id is never markup", () => {
    const comment = refusedTicksComment([
      refused({ target: { kind: "stack", stackId: "apps/<b>_x_:prod", rule: "admin" } }),
    ]);
    expect(comment).toContain("ticked **apps/&lt;b&gt;&#95;x&#95;:prod**.");
  });
});

describe("a tick that could not be verified", () => {
  test("says so and asks for a fresh tick", () => {
    expect(refusedTicksComment([refused({ reason: "unverified" })])).toBe(
      "@alice ticked **network:prod**. The tick could not be verified, because the permission lookup failed. Tick the box again for a fresh try. Nothing was started and the box is cleared.",
    );
  });
});

describe("several refusals", () => {
  test("share one comment, one line each, in the order they came", () => {
    expect(
      refusedTicksComment([
        refused(),
        refused({
          target: { kind: "stack", stackId: "app:prod", rule: ["bob"] },
          reason: "not-on-list",
        }),
        refused({ login: "dave", reason: "unverified" }),
      ]),
    ).toBe(
      [
        "Nothing was started for these ticks and their boxes are cleared.",
        "",
        "- @alice ticked **network:prod**. The tick was refused: the tick rule of this stack is `admin`, which takes admin access to this repository.",
        "- @alice ticked **app:prod**. The tick was refused: the tick rule of this stack names who can tick it: bob.",
        "- @dave ticked **network:prod**. The tick could not be verified, because the permission lookup failed. Tick the box again for a fresh try.",
      ].join("\n"),
    );
  });
});

describe("no refusals", () => {
  test("is a mistake of the caller, and never an empty comment", () => {
    expect(() => refusedTicksComment([])).toThrow("no refused tick");
  });
});
