import { describe, expect, test } from "bun:test";
import { clearTick } from "../../src/render/clear-tick.ts";
import { parseDashboard } from "../../src/render/marker.ts";
import { dependencyNote } from "../../src/render/row.ts";

// A tick refused for a phase (slice 4.16, record 0067): the note names the
// phase and the stacks in it that have a change waiting, not every stack the
// tick depends on.

describe("the note on a tick refused for a phase", () => {
  test("names the phase and the one stack in it that has a change waiting", () => {
    expect(dependencyNote([], [{ phase: "infrastructure", stackIds: ["metallb:prod"] }])).toBe(
      ":information_source: this tick started nothing: it waits on the **infrastructure** phase: **metallb:prod** has a change waiting. Tick both to deploy them in order, or deploy the **infrastructure** phase first.",
    );
  });

  test("names at most five stacks of a phase and counts the rest", () => {
    const stackIds = ["a", "b", "c", "d", "e", "f", "g"].map((one) => `${one}:prod`);
    expect(dependencyNote([], [{ phase: "infrastructure", stackIds }])).toBe(
      ":information_source: this tick started nothing: it waits on the **infrastructure** phase: **a:prod**, **b:prod**, **c:prod**, **d:prod**, **e:prod** and 2 more have changes waiting. Tick them all to deploy them in order, or deploy the **infrastructure** phase first.",
    );
  });

  test("names each phase, and a stack named in dependsOn by itself", () => {
    expect(
      dependencyNote(
        ["db:prod"],
        [
          { phase: "infrastructure", stackIds: ["metallb:prod"] },
          { phase: "monitoring", stackIds: ["grafana:prod", "loki:prod"] },
        ],
      ),
    ).toBe(
      ":information_source: this tick started nothing: it depends on **db:prod**, which has a change waiting, and it waits on the **infrastructure** phase: **metallb:prod** has a change waiting, and it waits on the **monitoring** phase: **grafana:prod** and **loki:prod** have changes waiting. Tick them all to deploy them in order, or deploy **db:prod**, the **infrastructure** phase and the **monitoring** phase first.",
    );
  });

  test("without a phase the note is what it was", () => {
    expect(dependencyNote(["network:prod"], [])).toBe(dependencyNote(["network:prod"]));
    expect(dependencyNote(["network:prod"])).toBe(
      ":information_source: this tick started nothing: it depends on **network:prod**, which has a change waiting. Tick both to deploy them in order, or deploy **network:prod** first.",
    );
  });

  test("goes under the row when the box is cleared, once", () => {
    const [ticked] = parseDashboard(
      '- [x] **site:prod** · 1 update · [preview](url) <!-- sluiceway:row stack="site:prod" state="pending" hash="aaaaaaaaaaaaaaaa" -->\n  <!-- /sluiceway:row -->',
    ).rows;
    if (!ticked) throw new Error("no row");
    const phases = [{ phase: "infrastructure", stackIds: ["network:prod"] }];
    const cleared = clearTick(ticked, { note: { dependsOn: [], phases } });
    expect(cleared.text).toBe(
      [
        '- [ ] **site:prod** · 1 update · [preview](url) <!-- sluiceway:row stack="site:prod" state="pending" hash="aaaaaaaaaaaaaaaa" -->',
        "  :information_source: this tick started nothing: it waits on the **infrastructure** phase: **network:prod** has a change waiting. Tick both to deploy them in order, or deploy the **infrastructure** phase first.",
        "  <!-- /sluiceway:row -->",
      ].join("\n"),
    );
  });
});
