import { describe, expect, test } from "bun:test";
import { change, inSync, pending } from "./harness.ts";
import { ALICE, matrix, rowsOf, scanned, tick, wake } from "./resolve-harness.ts";

// `resolve` and phases (slice 4.16, record 0067): a tick on a stack in a later
// phase is refused while an earlier phase has a change waiting that nobody
// ticked, and the note names the phase, not every stack in it.

const TABLE = {
  "network:prod": pending("network:prod", change("vpc")),
  "dns:prod": inSync("dns:prod"),
  "app:prod": pending("app:prod", change("web")),
  "site:prod": pending("site:prod", change("cdn")),
  "tools:prod": pending("tools:prod", change("cli")),
};

const PHASES = `phases: [infrastructure, monitoring, applications]
stacks:
  - path: network
    phase: infrastructure
  - path: dns
    phase: infrastructure
  - path: app
    phase: monitoring
  - path: site
    phase: applications
`;

const secondLine = (h: Awaited<ReturnType<typeof scanned>>, id: string) =>
  (rowsOf(h)[id] ?? "").split("\n")[1];

describe("a tick on a stack in a later phase", () => {
  test("is refused while an earlier phase has a change waiting, and the note names each phase", async () => {
    const h = await scanned(TABLE, { config: PHASES });
    tick(h, ALICE, ["site:prod"]);

    await wake(h);

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).not.toContain("createDeployment");
    expect(secondLine(h, "site:prod")).toBe(
      "  :information_source: this tick started nothing: it waits on the **infrastructure** phase: **network:prod** has a change waiting, and it waits on the **monitoring** phase: **app:prod** has a change waiting. Tick them all to deploy them in order, or deploy the **infrastructure** phase and the **monitoring** phase first.",
    );
    expect(h.log.lines).toContain(
      "site:prod is ticked, and it depends on network:prod of the infrastructure phase and app:prod of the monitoring phase, which have changes waiting and are not ticked. The box is cleared.",
    );
  });

  test("goes out with the earlier phase ticked in the same edit, which deploys first", async () => {
    const h = await scanned(TABLE, { config: PHASES });
    tick(h, ALICE, ["app:prod", "network:prod"]);

    await wake(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["network:prod"]);
    expect((rowsOf(h)["app:prod"] ?? "").split("\n")[0]).toContain(
      "queued behind **network:prod**",
    );
  });

  test("goes out when every earlier phase is in sync", async () => {
    const h = await scanned(
      { ...TABLE, "network:prod": inSync("network:prod") },
      { config: PHASES },
    );
    tick(h, ALICE, ["app:prod"]);

    await wake(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["app:prod"]);
  });

  test("a stack without a phase waits on none", async () => {
    const h = await scanned(TABLE, { config: PHASES });
    tick(h, ALICE, ["tools:prod"]);

    await wake(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["tools:prod"]);
  });
});
