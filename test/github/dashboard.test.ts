import { describe, expect, test } from "bun:test";
import {
  type DashboardSettings,
  findDashboard,
  writeDashboard,
} from "../../src/github/dashboard.ts";
import { FakeGitHub } from "../fake-github/fake-github.ts";

const SETTINGS: DashboardSettings = { label: "sluiceway", title: "Sluiceway dashboard", pin: true };

const ROOT =
  '<!-- sluiceway:dashboard v="1" scan-sha="294bbc0" scan-run="1" scan-at="2026-09-20T06:00:12Z" -->';
const body = (rest: string) => `${ROOT}\n\n${rest}\n`;

describe("a repo with no dashboard", () => {
  test("the dashboard is created with the title, the label and the body built from nothing", async () => {
    const github = new FakeGitHub();
    const seen: string[] = [];

    const result = await writeDashboard(github, SETTINGS, (live) => {
      seen.push(live);
      return body("rows");
    });

    expect(github.issue(result.number)).toMatchObject({
      state: "open",
      title: "Sluiceway dashboard",
      labels: ["sluiceway"],
      body: body("rows"),
      author: { login: "github-actions[bot]", type: "Bot" },
    });
    expect(seen[0]).toBe("");
    expect(result).toMatchObject({ found: "created", closedDuplicates: [], body: body("rows") });
  });
});

describe("a repo with a dashboard", () => {
  test("it is found by label, root marker and author together, and its body is written", async () => {
    const github = new FakeGitHub();
    const { number } = github.seedIssue({ labels: ["sluiceway"], body: body("old rows") });

    const result = await writeDashboard(github, { ...SETTINGS, pin: false }, (live) =>
      live.replace("old", "new"),
    );

    expect(result).toEqual({
      number,
      found: "open",
      closedDuplicates: [],
      pin: "not-tried",
      written: true,
      tries: 1,
      body: body("new rows"),
    });
    expect(github.issue(number).body).toBe(body("new rows"));
    expect(github.requests).toEqual(["listIssues", "getIssue", "updateIssueBody", "getIssue"]);
  });

  test("a scan that changes nothing writes nothing", async () => {
    const github = new FakeGitHub();
    github.seedIssue({ labels: ["sluiceway"], body: body("rows") });

    const result = await writeDashboard(github, { ...SETTINGS, pin: false }, (live) => live);

    expect(result.written).toBe(false);
    expect(github.requests).toEqual(["listIssues", "getIssue"]);
  });

  test("a root marker of another version is still the dashboard, and so is one with \\r\\n", async () => {
    const github = new FakeGitHub();
    const { number } = github.seedIssue({
      labels: ["sluiceway"],
      body: '<!-- sluiceway:dashboard v="2" later-key="x" -->\r\nrows',
    });

    expect((await findDashboard(github, "sluiceway"))?.number).toBe(number);
  });

  test.each([
    ["has the label and no root marker", { body: "Please add a sluiceway stack for DNS" }],
    ["has the root marker below the first line", { body: `Look at this:\n${ROOT}` }],
    ["quotes the marker inside its first line", { body: `> ${ROOT}` }],
    ["was opened by a person", { body: body("rows"), author: { login: "mallory", type: "User" } }],
    [
      "was opened by a user who is named like the bot",
      { body: body("rows"), author: { login: "github-actions[bot]", type: "User" } },
    ],
    [
      "was opened by another bot",
      { body: body("rows"), author: { login: "renovate[bot]", type: "Bot" } },
    ],
    ["carries another label", { body: body("rows"), labels: ["infra"] }],
  ])("an issue that %s is not the dashboard and is left alone", async (_, issue) => {
    const github = new FakeGitHub();
    const other = github.seedIssue({ labels: ["sluiceway"], ...issue });

    expect(await findDashboard(github, "sluiceway")).toBeUndefined();
    const result = await writeDashboard(github, SETTINGS, () => body("fresh"));

    expect(result.found).toBe("created");
    expect(result.number).not.toBe(other.number);
    expect(github.issue(other.number)).toEqual(other);
    expect(github.comments(other.number)).toEqual([]);
  });

  test("the label is the configured one", async () => {
    const github = new FakeGitHub();
    const { number } = github.seedIssue({ labels: ["infra-dashboard"], body: body("rows") });

    expect(await findDashboard(github, "sluiceway")).toBeUndefined();
    expect((await findDashboard(github, "infra-dashboard"))?.number).toBe(number);
  });

  test("finding is one request and changes nothing", async () => {
    const github = new FakeGitHub();
    github.seedIssue({ labels: ["sluiceway"], body: body("a") });
    github.seedIssue({ labels: ["sluiceway"], body: body("b") });

    const found = await findDashboard(github, "sluiceway");

    expect(found?.number).toBe(1);
    expect(github.requests).toEqual(["listIssues"]);
    expect(github.issue(2).state).toBe("open");
  });
});

describe("more than one open dashboard", () => {
  test("the lowest number is the dashboard, and the others are closed with a comment that links to it", async () => {
    const github = new FakeGitHub();
    github.seedIssue({ labels: ["bug"] });
    const first = github.seedIssue({ labels: ["sluiceway"], body: body("first") });
    const second = github.seedIssue({ labels: ["sluiceway"], body: body("second") });
    const third = github.seedIssue({ labels: ["sluiceway"], body: body("third") });

    const result = await writeDashboard(github, SETTINGS, () => body("fresh"));

    expect(result).toMatchObject({ number: first.number, found: "open", closedDuplicates: [3, 4] });
    expect(github.issue(first.number)).toMatchObject({ state: "open", body: body("fresh") });
    for (const duplicate of [second, third]) {
      expect(github.issue(duplicate.number)).toMatchObject({
        state: "closed",
        body: duplicate.body,
      });
      expect(github.comments(duplicate.number)).toEqual([
        "Sluiceway found more than one dashboard in this repo. The dashboard is #2, the one with the lowest number, so this one was closed.",
      ]);
    }
    expect(github.comments(first.number)).toEqual([]);
  });

  test("an open issue that only looks like a dashboard is never closed", async () => {
    const github = new FakeGitHub();
    github.seedIssue({ labels: ["sluiceway"], body: body("rows") });
    const person = github.seedIssue({
      labels: ["sluiceway"],
      body: body("rows"),
      author: { login: "mallory", type: "User" },
    });

    const result = await writeDashboard(github, SETTINGS, (live) => live);

    expect(result.closedDuplicates).toEqual([]);
    expect(github.issue(person.number).state).toBe("open");
  });
});

describe("no open dashboard, and a closed one", () => {
  test("the closed dashboard is reopened and written, so the number and every link stay", async () => {
    const github = new FakeGitHub();
    const closed = github.seedIssue({ labels: ["sluiceway"], body: body("old"), state: "closed" });

    const result = await writeDashboard(github, SETTINGS, () => body("fresh"));

    expect(result).toMatchObject({ number: closed.number, found: "reopened", written: true });
    expect(github.issue(closed.number)).toMatchObject({ state: "open", body: body("fresh") });
    expect(github.requests).not.toContain("createIssue");
  });

  test("of several, the one closed last is reopened, not the one with the highest number", async () => {
    const github = new FakeGitHub();
    const dashboard = github.seedIssue({ labels: ["sluiceway"], body: body("the dashboard") });
    const duplicate = github.seedIssue({ labels: ["sluiceway"], body: body("a duplicate") });
    await github.closeIssue(duplicate.number);
    await github.closeIssue(dashboard.number);

    const result = await writeDashboard(github, SETTINGS, (live) => live);

    expect(result).toMatchObject({ number: dashboard.number, found: "reopened" });
    expect(github.issue(duplicate.number).state).toBe("closed");
  });

  test("two closed in the same second: the higher number", async () => {
    const github = new FakeGitHub();
    const closedAt = "2026-09-20T06:00:12Z";
    github.seedIssue({ labels: ["sluiceway"], body: body("a"), state: "closed", closedAt });
    const higher = github.seedIssue({
      labels: ["sluiceway"],
      body: body("b"),
      state: "closed",
      closedAt,
    });

    expect((await writeDashboard(github, SETTINGS, (live) => live)).number).toBe(higher.number);
  });

  test("a closed issue that only looks like a dashboard is not reopened", async () => {
    const github = new FakeGitHub();
    const person = github.seedIssue({
      labels: ["sluiceway"],
      body: body("rows"),
      state: "closed",
      author: { login: "mallory", type: "User" },
    });

    const result = await writeDashboard(github, SETTINGS, () => body("fresh"));

    expect(result.found).toBe("created");
    expect(github.issue(person.number).state).toBe("closed");
  });

  test("closed issues are only listed when no open dashboard exists", async () => {
    const github = new FakeGitHub();
    github.seedIssue({ labels: ["sluiceway"], body: body("rows") });
    github.seedIssue({ labels: ["sluiceway"], body: body("rows"), state: "closed" });

    await writeDashboard(github, SETTINGS, (live) => live);

    expect(github.requests).toEqual(["listIssues", "getIssue", "listPinnedIssues", "pinIssue"]);
  });
});

describe("pinning", () => {
  test("a new dashboard is pinned, and the result says the body was written", async () => {
    const github = new FakeGitHub();

    const result = await writeDashboard(github, SETTINGS, () => body("rows"));

    expect(github.pinned).toEqual([result.number]);
    expect(result).toMatchObject({ found: "created", pin: "pinned", written: true, tries: 1 });
    expect(github.requests).toEqual([
      "listIssues",
      "listRecentlyClosedIssues",
      "createIssue",
      "pinIssue",
      "getIssue",
    ]);
  });

  test("pin: false pins nothing", async () => {
    const github = new FakeGitHub();

    const result = await writeDashboard(github, { ...SETTINGS, pin: false }, () => body("rows"));

    expect(github.pinned).toEqual([]);
    expect(result.pin).toBe("not-tried");
  });

  test("a pin that fails is best effort: the dashboard is still written and the result says so", async () => {
    const github = new FakeGitHub();
    for (let i = 0; i < 3; i++) await github.pinIssue(github.seedIssue().nodeId);

    const result = await writeDashboard(github, SETTINGS, () => body("rows"));

    expect(result).toMatchObject({ found: "created", pin: "failed", written: true });
    expect(github.issue(result.number).body).toBe(body("rows"));
    expect(github.pinned).toEqual([1, 2, 3]);
  });

  // Slice 5.9: a dashboard that exists is pinned on every scan, when it is not
  // pinned already. One request reads the pinned issues, and a second pins.
  // A person who wants it unpinned for good sets dashboard.pin: false.
  test("a dashboard that exists and is not pinned is pinned", async () => {
    const github = new FakeGitHub();
    const { number } = github.seedIssue({ labels: ["sluiceway"], body: body("rows") });

    const result = await writeDashboard(github, SETTINGS, () => body("fresh"));

    expect(result.pin).toBe("pinned");
    expect(github.pinned).toEqual([number]);
    expect(github.requests).toEqual([
      "listIssues",
      "getIssue",
      "updateIssueBody",
      "getIssue",
      "listPinnedIssues",
      "pinIssue",
    ]);
  });

  test("a dashboard that is pinned already costs one read and no pin", async () => {
    const github = new FakeGitHub();
    const { number, nodeId } = github.seedIssue({ labels: ["sluiceway"], body: body("rows") });
    await github.pinIssue(nodeId);
    github.requests.length = 0;

    const result = await writeDashboard(github, SETTINGS, (live) => live);

    expect(result.pin).toBe("already");
    expect(github.pinned).toEqual([number]);
    expect(github.requests).toEqual(["listIssues", "getIssue", "listPinnedIssues"]);
  });

  test("a dashboard that exists is left alone with pin: false", async () => {
    const github = new FakeGitHub();
    github.seedIssue({ labels: ["sluiceway"], body: body("rows") });

    const result = await writeDashboard(github, { ...SETTINGS, pin: false }, () => body("fresh"));

    expect(result.pin).toBe("not-tried");
    expect(github.pinned).toEqual([]);
    expect(github.requests).not.toContain("listPinnedIssues");
  });

  test("a reopened dashboard is pinned too", async () => {
    const github = new FakeGitHub();
    const closed = github.seedIssue({ labels: ["sluiceway"], body: body("old"), state: "closed" });

    const result = await writeDashboard(github, SETTINGS, () => body("fresh"));

    expect(result).toMatchObject({ found: "reopened", pin: "pinned" });
    expect(github.pinned).toEqual([closed.number]);
  });
});

// Slice 5.9: the title of sluiceway.yaml is the title of the dashboard, also
// after it changed. A title a person changed by hand is put back.
describe("the title", () => {
  test("a dashboard whose title is not dashboard.title gets it", async () => {
    const github = new FakeGitHub();
    const { number } = github.seedIssue({
      labels: ["sluiceway"],
      body: body("rows"),
      title: "Old title",
    });

    const result = await writeDashboard(github, { ...SETTINGS, pin: false }, (live) => live);

    expect(result.renamed).toEqual({ from: "Old title" });
    expect(github.issue(number).title).toBe("Sluiceway dashboard");
    expect(github.requests).toEqual(["listIssues", "updateIssueTitle", "getIssue"]);
  });

  test("a dashboard with the right title is not touched", async () => {
    const github = new FakeGitHub();
    github.seedIssue({ labels: ["sluiceway"], body: body("rows"), title: "Sluiceway dashboard" });

    const result = await writeDashboard(github, { ...SETTINGS, pin: false }, (live) => live);

    expect(result.renamed).toBeUndefined();
    expect(github.requests).toEqual(["listIssues", "getIssue"]);
  });

  test("a reopened dashboard gets the title too", async () => {
    const github = new FakeGitHub();
    const closed = github.seedIssue({
      labels: ["sluiceway"],
      body: body("old"),
      state: "closed",
      title: "Old title",
    });

    await writeDashboard(github, { ...SETTINGS, pin: false }, () => body("fresh"));

    expect(github.issue(closed.number).title).toBe("Sluiceway dashboard");
  });
});

// Slice 5.9: looking for a closed dashboard reads one page, the 100 issues
// with the label that changed last, however many closed issues the label has.
describe("the closed issues read", () => {
  test("are one request, the ones that changed last", async () => {
    const github = new FakeGitHub();
    for (let i = 0; i < 250; i++) {
      github.seedIssue({ labels: ["sluiceway"], body: "not a dashboard", state: "closed" });
    }
    const dashboard = github.seedIssue({ labels: ["sluiceway"], body: body("old") });
    await github.closeIssue(dashboard.number);
    github.requests.length = 0;

    const result = await writeDashboard(github, { ...SETTINGS, pin: false }, () => body("fresh"));

    expect(result).toMatchObject({ number: dashboard.number, found: "reopened" });
    expect(github.requests.filter((request) => request.startsWith("list"))).toEqual([
      "listIssues",
      "listRecentlyClosedIssues",
    ]);
  });
});

describe("a first body that is too large", () => {
  test("nothing is created", async () => {
    const github = new FakeGitHub();

    const failed = writeDashboard(github, SETTINGS, () => "a".repeat(65_537));

    await expect(failed).rejects.toThrow("came out at 65,537 characters");
    expect(github.requests).not.toContain("createIssue");
  });
});
