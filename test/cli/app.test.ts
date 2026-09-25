import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT } from "../../src/cli/exit.ts";
import { runCli } from "../../src/cli/run.ts";
import { fileStore } from "../../src/cli/token-store.ts";
import { deploy, type FakeApp, fakeApp, OPENAPI, problems, TOKEN } from "./fake-app.ts";

// Slice 5.53 (record 0116): the commands that talk to the app. They call the
// app's /api/v1 with the person's token and nothing else: no GitHub API, no
// other address. Every answer the fake gives is held to the app's OpenAPI
// document, so these tests are held to the app's contract.

interface Options {
  app?: FakeApp;
  signedIn?: boolean;
  token?: string;
}

async function setup(options: Options = {}) {
  const app = options.app ?? fakeApp();
  const configDir = mkdtempSync(join(tmpdir(), "sluiceway-config-"));
  const store = fileStore(configDir);
  const kept = new Map<string, string>();
  const tokens = {
    read: async (address: string) => kept.get(address) ?? (await store.read(address)),
    write: async (address: string, token: string) => {
      kept.set(address, token);
      return "the test keychain";
    },
    remove: async (address: string) => (kept.delete(address) ? ["the test keychain"] : []),
  };
  if (options.signedIn !== false) kept.set(app.origin, TOKEN);
  const slept: number[] = [];
  const run = async (argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, {
      cwd: tmpdir(),
      version: "0.45.0",
      nodeVersion: "24.15.0",
      out: (line) => void out.push(line),
      err: (line) => void err.push(line),
      fetch: app.fetch,
      tokens,
      readToken: async () => options.token ?? TOKEN,
      sleep: async (ms) => void slept.push(ms),
    });
    return { code, out, err, text: out.join("\n"), errText: err.join("\n") };
  };
  return { app, run, kept, slept };
}

describe("the fake app keeps to the app's contract", () => {
  test("the committed document is the app's version 1", () => {
    expect(OPENAPI.info.version).toBe("1.0.0");
    expect(Object.keys(OPENAPI.paths).sort()).toEqual([
      "/api/v1/me",
      "/api/v1/orgs/{org}",
      "/api/v1/orgs/{org}/audit",
      "/api/v1/orgs/{org}/repos/{repo}",
      "/api/v1/orgs/{org}/repos/{repo}/config",
      "/api/v1/orgs/{org}/repos/{repo}/config/pull-request",
      "/api/v1/orgs/{org}/repos/{repo}/deployments/{deployment}",
      "/api/v1/orgs/{org}/repos/{repo}/rescan",
      "/api/v1/orgs/{org}/repos/{repo}/stacks/{stack}",
      "/api/v1/orgs/{org}/repos/{repo}/stacks/{stack}/tick",
    ]);
  });

  test("the schema check finds a field too many and one missing", () => {
    const me = { $ref: "#/components/schemas/Me" };
    expect(problems({ login: "a", org: "b", token: { name: "n", expiresAt: "t" } }, me)).toEqual(
      [],
    );
    expect(problems({ login: "a", org: "b", token: { name: "n" }, extra: 1 }, me)).toEqual([
      "$.token.expiresAt: missing",
      "$.extra: not in the schema",
    ]);
  });
});

describe("login", () => {
  test("verifies the token with the app, keeps it, and says who it is for", async () => {
    const { app, run, kept } = await setup({ signedIn: false });
    const { code, out, err } = await run(["login"]);
    expect(err).toEqual([]);
    expect(code).toBe(EXIT.ok);
    expect(out).toEqual([
      "Signed in to https://app.sluiceway.dev as alice, for acme, with the token laptop, which works until 2026-12-25T00:00:00Z.",
      "The token is kept in the test keychain.",
    ]);
    expect(kept.get(app.origin)).toBe(TOKEN);
    expect(app.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET https://app.sluiceway.dev/api/v1/me",
    ]);
    expect(app.calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(app.calls[0]?.userAgent).toBe("sluiceway/0.45.0");
  });

  test("a token the app does not know is not kept", async () => {
    const { run, kept } = await setup({ signedIn: false, token: "sluiceway_nope" });
    const { code, err } = await run(["login"]);
    expect(code).toBe(EXIT.signedOut);
    expect(err).toEqual([
      "That token does not work: it was revoked, it expired, or it never was one.",
    ]);
    expect(kept.size).toBe(0);
  });

  test("what is not a Sluiceway token is never sent anywhere", async () => {
    const { app, run } = await setup({ signedIn: false, token: "ghp_aGitHubTokenPastedByMistake" });
    const { code, err } = await run(["login"]);
    expect(code).toBe(EXIT.usage);
    expect(err).toEqual([
      "That is not a Sluiceway token: one starts with sluiceway_. Make one on https://app.sluiceway.dev/settings/tokens.",
    ]);
    expect(app.calls).toEqual([]);
  });

  test("an empty answer", async () => {
    const { app, run } = await setup({ signedIn: false, token: "  \n" });
    const { code, err } = await run(["login"]);
    expect(code).toBe(EXIT.usage);
    expect(err).toEqual([
      "No token was given. Make one on https://app.sluiceway.dev/settings/tokens and paste it, or pipe it in.",
    ]);
    expect(app.calls).toEqual([]);
  });

  test("--json gives the app's answer and where the token is kept", async () => {
    const { run } = await setup({ signedIn: false });
    const { code, out } = await run(["login", "--json"]);
    expect(code).toBe(EXIT.ok);
    expect(JSON.parse(out.join("\n"))).toEqual({
      app: "https://app.sluiceway.dev",
      login: "alice",
      org: "acme",
      token: { name: "laptop", expiresAt: "2026-12-25T00:00:00Z" },
      kept: "the test keychain",
    });
  });

  test("the token never shows in what it prints", async () => {
    const { run } = await setup({ signedIn: false });
    const { text, errText } = await run(["login"]);
    expect(text + errText).not.toContain(TOKEN);
  });
});

describe("logout", () => {
  test("takes the token out, and asks the app nothing", async () => {
    const { app, run, kept } = await setup();
    const { code, out } = await run(["logout"]);
    expect(code).toBe(EXIT.ok);
    expect(out).toEqual([
      "Signed out of https://app.sluiceway.dev: the token is gone from the test keychain.",
      "It still works until it expires. Revoke it on https://app.sluiceway.dev/settings/tokens to stop it now.",
    ]);
    expect(kept.size).toBe(0);
    expect(app.calls).toEqual([]);
  });

  test("with no token, says so and ends well", async () => {
    const { run } = await setup({ signedIn: false });
    const { code, out } = await run(["logout"]);
    expect(code).toBe(EXIT.ok);
    expect(out).toEqual(["There was no token for https://app.sluiceway.dev."]);
  });
});

describe("a command with no token", () => {
  test("says how to sign in, and asks the app nothing", async () => {
    const { app, run } = await setup({ signedIn: false });
    const { code, err } = await run(["status"]);
    expect(code).toBe(EXIT.signedOut);
    expect(err).toEqual([
      "Not signed in to https://app.sluiceway.dev. Make a token on https://app.sluiceway.dev/settings/tokens, then run sluiceway login.",
    ]);
    expect(app.calls).toEqual([]);
  });

  test("--json says it as JSON on stdout, with the exit code", async () => {
    const { run } = await setup({ signedIn: false });
    const { code, out } = await run(["status", "--json"]);
    expect(code).toBe(EXIT.signedOut);
    expect(JSON.parse(out.join("\n"))).toEqual({
      error:
        "Not signed in to https://app.sluiceway.dev. Make a token on https://app.sluiceway.dev/settings/tokens, then run sluiceway login.",
      code: "not-signed-in",
      exit: EXIT.signedOut,
    });
  });
});

describe("status", () => {
  test("the org's stacks by state, as the org view groups them", async () => {
    const { app, run } = await setup();
    const { code, out } = await run(["status"]);
    expect(code).toBe(EXIT.ok);
    expect(out).toEqual([
      "acme: 2 pending, 1 deploying, 1 in sync, 4 stacks",
      "Last scan: 0a1b2c3 of acme/infra at 2026-09-26T08:00:00Z",
      "",
      "Needs you",
      "  acme/infra  apps/api:prod  pending, deletes or replaces  1 update, 1 replace · from #14 by bob",
      "  acme/infra  network:prod  pending  1 update · from #12 by alice",
      "In flight",
      "  acme/infra  db:prod  queued  ticked by carol",
      "In sync",
      "  acme/infra  site:prod",
    ]);
    expect(app.calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/api/v1/me",
      "/api/v1/orgs/acme",
    ]);
  });

  test("a repo's stacks, by its name or by org/name", async () => {
    const { app, run } = await setup();
    const { code, out } = await run(["status", "acme/infra"]);
    expect(code).toBe(EXIT.ok);
    expect(out.slice(0, 4)).toEqual([
      "acme/infra: 2 pending, 1 deploying, 1 in sync, 4 stacks",
      "Last scan: 0a1b2c3 at 2026-09-26T08:00:00Z",
      "Dashboard: https://github.com/acme/infra/issues/7",
      "",
    ]);
    expect(out).toContain(
      "  apps/api:prod  pending, deletes or replaces  1 update, 1 replace · from #14 by bob",
    );
    expect(new URL(app.calls.at(-1)?.url ?? "").pathname).toBe("/api/v1/orgs/acme/repos/infra");
  });

  test("a repo of another org than the token's is not asked for", async () => {
    const { app, run } = await setup();
    const { code, err } = await run(["status", "other/infra"]);
    expect(code).toBe(EXIT.notFound);
    expect(err).toEqual(["The token is for acme, and other/infra is not in it."]);
    expect(app.calls.map((call) => new URL(call.url).pathname)).toEqual(["/api/v1/me"]);
  });

  test("a repo the app does not show is not found, in the app's words", async () => {
    const { run } = await setup();
    const { code, err } = await run(["status", "nothing"]);
    expect(code).toBe(EXIT.notFound);
    expect(err).toEqual(["Not found."]);
  });

  test("--json is the app's answer as it came", async () => {
    const { app, run } = await setup();
    const { out } = await run(["status", "--json"]);
    expect(JSON.parse(out.join("\n"))).toEqual(app.state.org);
  });

  test("the locked repos and the allowance's sentence", async () => {
    const app = fakeApp();
    app.state.org.locked = [
      {
        name: "acme/extra",
        counts: { pending: 1, deploying: 0, drifted: 0, failed: 0, "in-sync": 2 },
        total: 3,
      },
    ];
    app.state.org.allowance = {
      plan: "free",
      limit: 3,
      sentence: "The free plan shows 3 repos. 1 more is locked.",
    };
    const { run } = await setup({ app });
    const { out } = await run(["status"]);
    expect(out.slice(-3)).toEqual([
      "",
      "Locked: acme/extra (1 pending, 2 in sync, 3 stacks)",
      "The free plan shows 3 repos. 1 more is locked.",
    ]);
  });
});

describe("stack", () => {
  test("the row: state, counts, destroy line and the preview page", async () => {
    const { app, run } = await setup();
    const { code, out } = await run(["stack", "infra", "apps/api:prod"]);
    expect(code).toBe(EXIT.ok);
    expect(out).toEqual([
      "apps/api:prod in acme/infra: pending",
      "1 update, 1 replace · from #14 by bob",
      "Changes: 1 update, 1 replace",
      "Deletes or replaces: 1 replace",
      "Preview: sluiceway / apps/api:prod, on https://github.com/acme/infra/commit/0a1b2c3d/checks",
      "Dashboard: https://github.com/acme/infra/issues/7",
    ]);
    expect(new URL(app.calls.at(-1)?.url ?? "").pathname).toBe(
      "/api/v1/orgs/acme/repos/infra/stacks/apps%2Fapi%3Aprod",
    );
  });

  test("a deploying stack names its run and its last deploy", async () => {
    const app = fakeApp();
    const stack = app.state.stacks["network:prod"];
    if (stack === undefined) throw new Error("no stack");
    stack.row = {
      ...stack.row,
      state: "deploying",
      word: "deploying",
      ticked: true,
      run: "https://github.com/acme/infra/actions/runs/99",
      lastDeploy: {
        deployment: 4200,
        who: "ticked by alice",
        via: null,
        result: "failed",
        state: "failed",
        sha: "0a1b2c3d4e5f",
        run: "https://github.com/acme/infra/actions/runs/98",
        at: "2026-09-25T20:00:00Z",
        flagged: false,
        approvedBy: null,
      },
    };
    const { out } = await run(["stack", "infra", "network:prod"], app);
    expect(out).toContain("Run: https://github.com/acme/infra/actions/runs/99");
    expect(out).toContain("Last deploy: failed, ticked by alice, at 2026-09-25T20:00:00Z");
  });

  test("a stack the app does not know", async () => {
    const { run } = await setup();
    const { code, err } = await run(["stack", "infra", "nothing:prod"]);
    expect(code).toBe(EXIT.notFound);
    expect(err).toEqual(["Not found."]);
  });
});

async function run(argv: string[], app: FakeApp) {
  return (await setup({ app })).run(argv);
}

describe("tick", () => {
  test("asks the app, prints the record, and polls until it is waiting to start", async () => {
    const { app, run, slept } = await setup();
    const { code, out } = await run(["tick", "infra", "network:prod"]);
    expect(code).toBe(EXIT.ok);
    expect(out).toEqual([
      "The tick of network:prod is asked: the deployment record is open.",
      "Deployment record 4242: waiting to start.",
      "The workflow deploys it through a fresh preview and the hash check, and the dashboard says how it went: https://github.com/acme/infra/issues/7",
    ]);
    expect(app.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "GET /api/v1/me",
      "GET /api/v1/orgs/acme/repos/infra/stacks/network%3Aprod",
      "POST /api/v1/orgs/acme/repos/infra/stacks/network%3Aprod/tick",
      "GET /api/v1/orgs/acme/repos/infra/deployments/4242",
      "GET /api/v1/orgs/acme/repos/infra/deployments/4242",
    ]);
    expect(slept).toEqual([2000]);
  });

  test("never says a deploy went out", async () => {
    const app = fakeApp();
    app.state.deployments[4242] = [deploy(4242, "network:prod", "went out")];
    const { out, code } = await run(["tick", "infra", "network:prod"], app);
    expect(code).toBe(EXIT.ok);
    expect(out[1]).toBe("Deployment record 4242: the app says went out.");
    for (const line of out.slice(2)) expect(line).not.toContain("went out");
  });

  test("a record that failed is a failure", async () => {
    const app = fakeApp();
    app.state.deployments[4242] = [deploy(4242, "network:prod", "failed", { state: "failed" })];
    const { code, out } = await run(["tick", "infra", "network:prod"], app);
    expect(code).toBe(EXIT.failed);
    expect(out[1]).toBe("Deployment record 4242: failed.");
  });

  test("a destroy asks for --yes, and nothing is ticked without it", async () => {
    const { app, run } = await setup();
    const { code, err } = await run(["tick", "infra", "apps/api:prod"]);
    expect(code).toBe(EXIT.refused);
    expect(err).toEqual([
      "apps/api:prod deletes or replaces resources (1 replace). Run the tick again with --yes to deploy that.",
    ]);
    expect(app.calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  test("with --yes a destroy is ticked", async () => {
    const { app, run } = await setup();
    const { code } = await run(["tick", "infra", "apps/api:prod", "--yes"]);
    expect(code).toBe(EXIT.ok);
    expect(app.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  test.each([
    ["refused", "alice may not tick network:prod: the tick rule is admin.", EXIT.refused],
    ["github", "The tick of network:prod happens on its dashboard on GitHub.", EXIT.refused],
    ["moved", "network:prod changed since the row was read. Read it again.", EXIT.refused],
    ["taken", "network:prod is already ticked.", EXIT.refused],
    ["failed", "The tick of network:prod could not be written.", EXIT.failed],
  ])("a tick that came to %s says the app's sentence", async (outcome, sentence, exit) => {
    const app = fakeApp();
    const stack = app.state.stacks["network:prod"];
    if (stack === undefined) throw new Error("no stack");
    stack.tick = { outcome, sentence };
    const { code, err, out } = await run(["tick", "infra", "network:prod"], app);
    expect(code).toBe(exit);
    expect([...out, ...err]).toEqual([sentence]);
    expect(app.calls.filter((call) => call.url.includes("/deployments/"))).toEqual([]);
  });

  test("a record the app does not show within a minute", async () => {
    const app = fakeApp();
    app.state.deployments[4242] = ["not-yet"];
    const { app: _, run, slept } = await setup({ app });
    const { code, err } = await run(["tick", "infra", "network:prod"]);
    expect(code).toBe(EXIT.later);
    expect(err).toEqual([
      "The app has not shown deployment record 4242 yet. See it with sluiceway stack infra network:prod.",
    ]);
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBe(60_000);
  });

  test("--json is the tick's answer and the record's", async () => {
    const { run } = await setup();
    const { out } = await run(["tick", "infra", "network:prod", "--json"]);
    const answer = JSON.parse(out.join("\n"));
    expect(answer.tick.outcome).toBe("asked");
    expect(answer.deploy).toEqual(deploy(4242, "network:prod", "waiting to start"));
  });
});

describe("rescan", () => {
  test("asks for a full scan and says what the app said", async () => {
    const { app, run } = await setup();
    const { code, out } = await run(["rescan", "infra"]);
    expect(code).toBe(EXIT.ok);
    expect(out).toEqual([
      "GitHub was asked for a full scan of acme/infra.",
      "Dashboard: https://github.com/acme/infra/issues/7",
    ]);
    expect(app.calls.at(-1)?.method).toBe("POST");
    expect(new URL(app.calls.at(-1)?.url ?? "").pathname).toBe(
      "/api/v1/orgs/acme/repos/infra/rescan",
    );
  });

  test("a refused rescan", async () => {
    const app = fakeApp();
    app.state.rescan = {
      ...app.state.rescan,
      outcome: "refused",
      sentence: "alice may not scan acme/infra.",
    };
    const { code, err } = await run(["rescan", "infra"], app);
    expect(code).toBe(EXIT.refused);
    expect(err).toEqual(["alice may not scan acme/infra."]);
  });
});

describe("settings", () => {
  test("reads the keys a pull request may change, with their values", async () => {
    const { run } = await setup();
    const { code, out } = await run(["settings", "infra"]);
    expect(code).toBe(EXIT.ok);
    expect(out).toEqual([
      "sluiceway.yaml of acme/infra at 0a1b2c3: https://github.com/acme/infra/blob/0a1b2c3d4e5f/sluiceway.yaml",
      "  dashboard.redact = false",
      '  tickers = "write"',
      "  drift.enabled = false",
    ]);
  });

  test("set opens the settings pull request through the app and prints its link", async () => {
    const { app, run } = await setup();
    const { code, out } = await run([
      "settings",
      "infra",
      "set",
      "dashboard.redact=true",
      "tickers=admin",
    ]);
    expect(code).toBe(EXIT.ok);
    expect(out).toEqual([
      "Opened pull request #31 on sluiceway.yaml.",
      "  dashboard.redact: false → true",
      "https://github.com/acme/infra/pull/31",
    ]);
    expect(app.calls.at(-1)?.body).toEqual({
      changes: [
        { key: "dashboard.redact", value: true },
        { key: "tickers", value: "admin" },
      ],
    });
  });

  test("changes the app refuses are each named, and nothing is opened", async () => {
    const app = fakeApp();
    app.state.pullRequest = {
      status: 400,
      body: {
        error: "The changes were refused.",
        code: "changes-refused",
        problems: ["dashboard.nope is not a key a pull request can change."],
      },
    };
    const { code, err } = await run(["settings", "infra", "set", "dashboard.nope=1"], app);
    expect(code).toBe(EXIT.refused);
    expect(err).toEqual([
      "The changes were refused.",
      "  dashboard.nope is not a key a pull request can change.",
    ]);
  });

  test.each([
    ["nothing-to-change", EXIT.ok],
    ["pull-request-open", EXIT.refused],
    ["config-invalid", EXIT.refused],
    ["write-failed", EXIT.failed],
  ])("a pull request that came to %s", async (outcome, exit) => {
    const app = fakeApp();
    app.state.pullRequest = {
      status: 200,
      body: {
        outcome,
        pullRequest: null,
        url: null,
        sentence: `It came to ${outcome}.`,
        changes: [],
        problems: [],
      },
    };
    const { code } = await run(["settings", "infra", "set", "tickers=admin"], app);
    expect(code).toBe(exit);
  });
});

describe("what the app says when it cannot answer", () => {
  test.each([
    [401, "token-not-working", EXIT.signedOut],
    [403, "not-a-member", EXIT.signedOut],
    [403, "org-gone", EXIT.signedOut],
    [429, "rate-limited", EXIT.later],
    [503, "github-silent", EXIT.later],
  ])("%s %s", async (status, errorCode, exit) => {
    const app = fakeApp();
    app.state.failWith = { status, error: `The app says ${errorCode}.`, code: errorCode };
    const { code, err } = await run(["status"], app);
    expect(code).toBe(exit);
    expect(err[0]).toBe(`The app says ${errorCode}.`);
  });

  test("a spent rate limit says when to try again", async () => {
    const app = fakeApp();
    // /me is answered before the failure is set, as the app counts reads.
    const { run: go } = await setup({ app });
    app.state.failWith = {
      status: 429,
      error: "Too many requests with this token.",
      code: "rate-limited",
      retryAfter: "17",
    };
    const { err } = await go(["status"]);
    expect(err).toEqual(["Too many requests with this token. Try again in 17 seconds."]);
  });

  test("an app that cannot be reached", async () => {
    const app = fakeApp();
    const { run: go } = await setup({
      app: {
        ...app,
        fetch: (async () => {
          throw new Error("connect ECONNREFUSED");
        }) as unknown as typeof fetch,
      },
    });
    const { code, err } = await go(["status"]);
    expect(code).toBe(EXIT.failed);
    expect(err).toEqual(["Could not reach https://app.sluiceway.dev: connect ECONNREFUSED"]);
  });

  test("an answer that is not the app's JSON", async () => {
    const app = fakeApp();
    const { run: go } = await setup({
      app: {
        ...app,
        fetch: (async () =>
          new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch,
      },
    });
    const { code, err } = await go(["status"]);
    expect(code).toBe(EXIT.failed);
    expect(err).toEqual(["https://app.sluiceway.dev answered 502, and not with the app's words."]);
  });
});

describe("where the command line reaches", () => {
  test("--app sends every request to that address alone", async () => {
    const app = fakeApp("http://127.0.0.1:4555");
    const { run } = await setup({ app });
    const { code } = await run(["status", "--app", "http://127.0.0.1:4555"]);
    expect(code).toBe(EXIT.ok);
    for (const call of app.calls)
      expect(call.url.startsWith("http://127.0.0.1:4555/api/v1/")).toBe(true);
  });

  test("every command asks the app alone, with the token, and never GitHub", async () => {
    const { app, run } = await setup();
    await run(["status"]);
    await run(["status", "infra"]);
    await run(["stack", "infra", "network:prod"]);
    await run(["tick", "infra", "network:prod"]);
    await run(["rescan", "infra"]);
    await run(["settings", "infra"]);
    await run(["settings", "infra", "set", "tickers=admin"]);
    expect(app.calls.length).toBeGreaterThan(10);
    for (const call of app.calls) {
      expect(new URL(call.url).origin).toBe("https://app.sluiceway.dev");
      expect(call.authorization).toBe(`Bearer ${TOKEN}`);
    }
  });
});
