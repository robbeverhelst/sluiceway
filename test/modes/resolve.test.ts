import { describe, expect, test } from "bun:test";
import { change, pending } from "./harness.ts";
import { ALICE, matrix, scanned, tick, wake } from "./resolve-harness.ts";

// The cheap payload check of record 0017. `issues.edited` fires for every
// issue of the repo, so the common case costs nothing.

const TABLE = { "a:prod": pending("a:prod", change("logs")) };

function ordinaryIssue(issue: Record<string, unknown> = {}): unknown {
  return {
    action: "edited",
    issue: {
      number: 9,
      state: "open",
      body: "Something is broken.",
      labels: [],
      user: { login: "carol", type: "User" },
      ...issue,
    },
    sender: { login: "carol", type: "User" },
  };
}

describe("an edit of an issue that is not the dashboard", () => {
  test("costs no API call, sets an empty matrix and leaves the job green", async () => {
    const h = await scanned(TABLE);

    await wake(h, ordinaryIssue());

    expect(h.github.requests).toEqual([]);
    expect(matrix(h)).toEqual([]);
  });

  test.each([
    [
      "a person's issue with the label and a pasted root marker",
      { labels: [{ name: "sluiceway" }], body: '<!-- sluiceway:dashboard v="1" -->\n- [x] x' },
    ],
    [
      "a bot's issue with the label and no root marker",
      { labels: [{ name: "sluiceway" }], user: { login: "github-actions[bot]", type: "Bot" } },
    ],
    [
      "a bot's issue with a root marker and no label",
      {
        body: '<!-- sluiceway:dashboard v="1" -->',
        user: { login: "github-actions[bot]", type: "Bot" },
      },
    ],
  ])("%s costs no API call", async (_name, issue) => {
    const h = await scanned(TABLE);

    await wake(h, ordinaryIssue(issue));

    expect(h.github.requests).toEqual([]);
    expect(matrix(h)).toEqual([]);
  });

  test("a closed dashboard costs no API call, even with a ticked row", async () => {
    const h = await scanned(TABLE);
    tick(h, ALICE, ["a:prod"]);
    const payload = h.github.deliverEvent() as { issue: { state: string } };
    payload.issue.state = "closed";

    await wake(h, payload);

    expect(h.github.requests).toEqual([]);
    expect(matrix(h)).toEqual([]);
  });

  test("an event that is not about an issue costs no API call", async () => {
    const h = await scanned(TABLE);

    await wake(h, { ref: "refs/heads/main" });

    expect(h.github.requests).toEqual([]);
    expect(matrix(h)).toEqual([]);
  });

  test("a broken sluiceway.yaml does not turn an edit of an ordinary issue red", async () => {
    const h = await scanned(TABLE);
    await Bun.write(`${h.context.root}/sluiceway.yaml`, "tickerz: admin\n");

    await wake(h, ordinaryIssue());

    expect(matrix(h)).toEqual([]);
  });

  test("the label is the configured one", async () => {
    const h = await scanned(TABLE, { config: "dashboard:\n  label: infra-dashboard\n" });
    tick(h, ALICE, ["a:prod"]);
    const payload = h.github.deliverEvent() as { issue: { labels: { name: string }[] } };
    expect(payload.issue.labels).toEqual([{ name: "infra-dashboard" }]);
    payload.issue.labels = [{ name: "sluiceway" }];

    await wake(h, payload);

    expect(h.github.requests).toEqual([]);
  });
});
