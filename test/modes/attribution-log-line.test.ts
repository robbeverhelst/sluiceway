import { describe, expect, test } from "bun:test";
import { scan } from "../../src/modes/scan.ts";
import type { FakeGitHub } from "../fake-github/fake-github.ts";
import { handedOn, runApply } from "./apply-harness.ts";
import { change, harness, pending, tableAdapter } from "./harness.ts";
import { ALICE, scanned, tick, wake } from "./resolve-harness.ts";

// The line each mode logs when attribution is left off (record 0026). The
// port's own message is a sentence with its full stop, and the log line puts
// it inside a sentence of its own, so the stop must not be doubled (seen in
// the e2e of slice 2.9).

const DEPLOYED = "1111111111111111111111111111111111111111";

// A successful deploy of a commit the fake repo does not have, so the walk
// fails the way it does on GitHub.
function succeeded(github: FakeGitHub): void {
  github.seedDeployment({ task: "sluiceway:a:prod", sha: DEPLOYED, status: { state: "success" } });
}

function attributionLine(lines: string[]): string | undefined {
  return lines.find((line) => line.startsWith("Attribution was left off"));
}

describe("the log line of a failed attribution read", () => {
  test("in a scan has one full stop after GitHub's words", async () => {
    const { context, github, log } = harness(
      tableAdapter({ "a:prod": pending("a:prod", change("x")) }),
    );
    succeeded(github);

    await scan(context);

    expect(attributionLine(log.lines)).toBe(
      "Attribution was left off the rows: GitHub has no commit 0123456 to walk back from. It only explains a row, so the scan goes on without it (record 0026).",
    );
  });

  test("in resolve has one full stop after GitHub's words", async () => {
    const h = await scanned({ "a:prod": pending("a:prod", change("x")) });
    succeeded(h.github);
    tick(h, ALICE, ["a:prod"]);

    await wake(h);

    expect(attributionLine(h.log.lines)).toBe(
      "Attribution was left off the rows: GitHub has no commit 0123456 to walk back from. It only explains a row, so nothing else changes (record 0026).",
    );
  });

  test("in apply has one full stop after GitHub's words", async () => {
    const h = await handedOn({ "a:prod": pending("a:prod", change("x")) }, ["a:prod"]);
    succeeded(h.github);
    // The change moved, so `apply` writes a pending row and walks for it.
    h.table["a:prod"] = pending("a:prod", change("x"), change("y", "create"));

    await expect(runApply(h)).rejects.toThrow("the change moved since the tick");

    expect(attributionLine(h.log.lines)).toBe(
      "Attribution was left off the row: GitHub has no commit 0123456 to walk back from. It only explains a row, so nothing else changes (record 0026).",
    );
  });

  test("keeps a message that has no full stop of its own whole", async () => {
    const { context, github, log } = harness(
      tableAdapter({ "a:prod": pending("a:prod", change("x")) }),
    );
    succeeded(github);
    github.onRequest = (request) => {
      if (request === "walkCommits") throw new Error("Server Error");
    };

    await scan(context);

    expect(attributionLine(log.lines)).toStartWith(
      "Attribution was left off the rows: Server Error. It only explains a row",
    );
  });
});
