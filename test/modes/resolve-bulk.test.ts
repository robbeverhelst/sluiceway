import { describe, expect, test } from "bun:test";
import { parseDashboard } from "../../src/render/marker.ts";
import { change, drifted, inSync, pending, repoRoot } from "./harness.ts";
import {
  ALICE,
  BOB,
  matrix,
  type ResolveHarness,
  rowsOf,
  scanned,
  tick,
  WRITE,
  wake,
} from "./resolve-harness.ts";

// Slice 5.18, record 0083: a tick on the bulk box deploys nothing and asks for
// a confirmation. A tick on the confirm box deploys every stack it names,
// each as its own tick.

const TABLE = {
  "a:prod": pending("a:prod", change("logs")),
  "b:prod": pending("b:prod", change("disk")),
  "c:prod": pending("c:prod", change("dns")),
  "d:prod": inSync("d:prod"),
};

const CAROL = { login: "carol", type: "User" };

function bulkOf(h: ResolveHarness) {
  return parseDashboard(h.github.issue(h.number).body).bulk;
}

// A person ticks the first box whose line starts with these words.
function tickLine(h: ResolveHarness, who: typeof ALICE, starts: string): void {
  const body = h.github.issue(h.number).body;
  const box = `- [ ] ${starts}`;
  if (!body.includes(box)) throw new Error(`The dashboard has no box "${starts}".`);
  h.github.editBody(h.number, body.replace(box, `- [x] ${starts}`), who);
}

const tickBulk = (h: ResolveHarness, who = ALICE) => tickLine(h, who, "Deploy all");
const tickConfirm = (h: ResolveHarness, who = ALICE) => tickLine(h, who, "**Confirm:**");

async function confirmed(h: ResolveHarness, who = ALICE): Promise<void> {
  tickBulk(h, ALICE);
  await wake(h);
  tickConfirm(h, who);
  await wake(h);
}

function hashOf(row: string | undefined): string {
  return /hash="([^"]+)"/.exec(row ?? "")?.[1] ?? "";
}

describe("a tick on the bulk box", () => {
  test("deploys nothing and puts a confirm box in its place that names the stacks and who asked", async () => {
    const h = await scanned(TABLE);
    tickBulk(h);

    await wake(h);

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).not.toContain("createDeployment");
    const [line] = bulkOf(h);
    const rows = rowsOf(h);
    expect(line).toMatchObject({
      kind: "confirm",
      section: "pending",
      by: "alice",
      ticked: false,
      stacks: ["a:prod", "b:prod", "c:prod"].map((stackId) => ({
        stackId,
        hash: hashOf(rows[stackId]),
      })),
    });
    expect(line?.text).toStartWith(
      "- [ ] **Confirm:** deploy all 3 pending stacks: **a:prod**, **b:prod**, **c:prod** · asked by alice",
    );
    expect(h.log.lines).toContain(
      "The box that deploys all pending stacks was ticked by alice. Its confirm box names 3 stacks: a:prod, b:prod and c:prod.",
    );
  });

  test("by a person without write access is refused and cleared, with a comment", async () => {
    const h = await scanned(TABLE);
    h.github.seedPermission(BOB.login, { push: false, maintain: false, admin: false });
    tickBulk(h, BOB);

    await wake(h);

    expect(bulkOf(h)).toMatchObject([{ kind: "box", ticked: false }]);
    expect(h.github.comments(h.number)).toEqual([
      "@bob ticked the box that deploys all pending stacks. The tick was refused: ticking needs write access to this repository. Nothing was started and the box is cleared.",
    ]);
  });
});

describe("a tick on the confirm box", () => {
  test("deploys every stack it names, each with its own record, all attributed to the confirm ticker", async () => {
    const h = await scanned(TABLE);
    h.github.seedPermission(BOB.login, WRITE);
    const rows = rowsOf(h);

    await confirmed(h, BOB);

    const entries = matrix(h) as { stack: string; deployment: number }[];
    expect(entries.map(({ stack }) => stack)).toEqual(["a:prod", "b:prod", "c:prod"]);
    for (const { stack, deployment } of entries) {
      expect(h.github.deployment(deployment)).toMatchObject({
        task: `sluiceway:${stack}`,
        payload: { hash: hashOf(rows[stack]), ticker: "bob" },
        status: { state: "queued" },
      });
    }
    const after = parseDashboard(h.github.issue(h.number).body);
    expect(
      after.rows.filter((row) => row.state === "deploying").map(({ stackId }) => stackId),
    ).toEqual(["a:prod", "b:prod", "c:prod"]);
    // The section is empty, so there is no bulk box any more.
    expect(after.bulk).toEqual([]);
  });

  test("a stack whose tick rule refuses the ticker is refused with its own item, and the rest still go", async () => {
    const h = await scanned(TABLE, {
      config: "stacks:\n  - path: b\n    tickers: [carol]\n",
    });

    await confirmed(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual([
      "a:prod",
      "c:prod",
    ]);
    const [comment] = h.github.comments(h.number);
    expect(comment).toBe(
      "@alice ticked **b:prod** through the confirm box of the pending stacks. The tick was refused: the tick rule of this stack names who can tick it: carol. Nothing was started and the box is cleared.",
    );
    expect(parseDashboard(h.github.issue(h.number).body).rows).toContainEqual(
      expect.objectContaining({ stackId: "b:prod", state: "pending", ticked: false }),
    );
  });

  test("dependsOn still decides the order: a stack waits behind the one it depends on", async () => {
    const h = await scanned(TABLE, {
      config: "stacks:\n  - path: a\n    dependsOn: [b:prod]\n",
    });

    await confirmed(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual([
      "b:prod",
      "c:prod",
    ]);
    expect(parseDashboard(h.github.issue(h.number).body).rows).toContainEqual(
      expect.objectContaining({ stackId: "a:prod", state: "queued" }),
    );
  });

  test("a confirm box whose rows changed before the tick deploys nothing and says what changed", async () => {
    const h = await scanned(TABLE);
    tickBulk(h);
    await wake(h);
    // The row of c:prod gets a new diff between the confirm box and its tick.
    const body = h.github.issue(h.number).body;
    const hash = hashOf(rowsOf(h)["c:prod"]);
    h.github.editBody(h.number, body.replace(`hash="${hash}"`, 'hash="0000000000000000"'), CAROL);
    tickConfirm(h);

    await wake(h);

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).not.toContain("createDeployment");
    expect(bulkOf(h)).toMatchObject([
      {
        kind: "box",
        ticked: false,
        note: { kind: "changed", added: [], gone: [], moved: ["c:prod"] },
      },
    ]);
    expect(h.log.lines).toContain(
      "The confirm box of the pending stacks was ticked, and its rows changed since it was drawn (c:prod has a new diff). Nothing is deployed and the bulk box asks for a fresh tick.",
    );
  });

  test("a row ticked on its own in the same edit deploys once, under its own tick", async () => {
    const h = await scanned(TABLE);
    h.github.seedPermission(BOB.login, WRITE);
    tickBulk(h);
    await wake(h);
    tick(h, BOB, ["a:prod"]);
    tickConfirm(h, ALICE);

    await wake(h);

    const entries = matrix(h) as { stack: string; deployment: number }[];
    expect(entries.map(({ stack }) => stack)).toEqual(["a:prod", "b:prod", "c:prod"]);
    expect(h.github.deployment(entries[0]?.deployment ?? 0)).toMatchObject({
      payload: { ticker: "bob" },
    });
  });

  test("while deploys are off nothing deploys and the box goes", async () => {
    const h = await scanned(TABLE);
    tickBulk(h);
    await wake(h);
    tickConfirm(h);
    h.context.root = repoRoot("deploys: false\n");

    await wake(h);

    expect(matrix(h)).toEqual([]);
    expect(h.github.requests).not.toContain("createDeployment");
    expect(bulkOf(h)).toEqual([]);
  });

  test("twelve stacks are twelve deploys, and the confirm box names ten and counts two", async () => {
    const table = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => {
        const id = `s${String(i).padStart(2, "0")}:prod`;
        return [id, pending(id, change("x"))];
      }),
    );
    const h = await scanned(table);
    tickBulk(h);
    await wake(h);
    expect(bulkOf(h)[0]?.text).toContain("**s09:prod** and 2 more · asked by alice");

    tickConfirm(h);
    await wake(h);

    expect(matrix(h)).toHaveLength(12);
  });
});

describe("the drifted section", () => {
  test("a confirmed repair deploys each drifted stack with the drift in its record", async () => {
    const h = await scanned(
      { "a:prod": inSync("a:prod"), "b:prod": inSync("b:prod") },
      {
        config: "drift:\n  enabled: true\n",
        event: "schedule",
        drifts: {
          "a:prod": drifted("a:prod", change("notes", "delete")),
          "b:prod": drifted("b:prod", change("assets")),
        },
      },
    );
    tickLine(h, ALICE, "Repair all");
    await wake(h);
    expect(bulkOf(h)).toMatchObject([{ kind: "confirm", section: "drift" }]);
    tickConfirm(h);

    await wake(h);

    const entries = matrix(h) as { stack: string; deployment: number }[];
    expect(entries.map(({ stack }) => stack)).toEqual(["a:prod", "b:prod"]);
    for (const { deployment } of entries) {
      expect(h.github.deployment(deployment)).toMatchObject({ payload: { drift: true } });
    }
  });

  test("a drifted stack whose dependency has a change waiting that nobody ticked waits, with the note on its own row", async () => {
    const h = await scanned(
      {
        "a:prod": inSync("a:prod"),
        "b:prod": inSync("b:prod"),
        "p:prod": pending("p:prod", change("x")),
      },
      {
        config: "drift:\n  enabled: true\nstacks:\n  - path: a\n    dependsOn: [p:prod]\n",
        event: "schedule",
        drifts: {
          "a:prod": drifted("a:prod", change("notes")),
          "b:prod": drifted("b:prod", change("assets")),
        },
      },
    );
    tickLine(h, ALICE, "Repair all");
    await wake(h);
    tickConfirm(h);

    await wake(h);

    expect((matrix(h) as { stack: string }[]).map(({ stack }) => stack)).toEqual(["b:prod"]);
    const a = rowsOf(h)["a:prod"] ?? "";
    expect(a).toContain("this tick started nothing: it depends on **p:prod**");
    expect(parseDashboard(a).rows[0]).toMatchObject({ state: "drift", ticked: false });
  });
});
