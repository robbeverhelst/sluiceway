import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { HELP, runCli } from "../../src/cli/run.ts";
import { runInit } from "../../src/modes/init-job.ts";
import { ROOT } from "../docs/docs.ts";

// Slice 5.30 (record 0094): `npx sluiceway init` and `npx sluiceway check`,
// and nothing else outside a runner.

type Files = Record<string, string>;

const WORKFLOW = ".github/workflows/deploy-dashboard.yml";

function repo(files: Files = {}, example?: string): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-cli-"));
  mkdirSync(join(root, ".git"));
  if (example !== undefined) cpSync(join(ROOT, "examples", example), root, { recursive: true });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const PULUMI: Files = {
  "network/Pulumi.yaml": "name: network\nruntime: yaml\n",
  "network/Pulumi.prod.yaml": "",
};

async function cli(argv: string[], cwd: string, nodeVersion = "24.15.0") {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, {
    cwd,
    version: "0.27.0",
    nodeVersion,
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    // init and the check reach none of what the app's commands use.
    fetch: globalThis.fetch,
    tokens: {
      read: () => Promise.reject(new Error("init and the check read no token.")),
      write: () => Promise.reject(new Error("init and the check keep no token.")),
      remove: () => Promise.reject(new Error("init and the check keep no token.")),
    },
    readToken: () => Promise.reject(new Error("init and the check ask for no token.")),
    sleep: () => Promise.reject(new Error("init and the check never wait.")),
  });
  return { code, out, err, text: out.join("\n") };
}

// Every file under a directory, relative to it, with its text.
function tree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of new Bun.Glob("**/*").scanSync({ cwd: dir, dot: true })) {
      if (entry.startsWith(".git/")) continue;
      files[entry] = readFileSync(join(dir, entry), "utf8");
    }
  };
  walk(root);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
}

// Nothing here may reach the network, and the runner's variables must not
// matter.
const realFetch = globalThis.fetch;
const saved = { ...process.env };
const calls: unknown[] = [];
beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = Object.assign(
    async (...args: unknown[]) => {
      calls.push(args);
      throw new Error("The command line makes no network call.");
    },
    { preconnect: () => {} },
  ) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...saved };
  expect(calls).toEqual([]);
});

describe("help and version", () => {
  test("--help prints the commands and ends well", async () => {
    const { code, out, err } = await cli(["--help"], tmpdir());
    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out).toEqual([HELP]);
    expect(HELP).toMatchSnapshot();
  });

  test("every line of the help fits a narrow terminal", () => {
    for (const line of HELP.split("\n")) expect(line.length).toBeLessThanOrEqual(80);
  });

  test("the help names both commands, the flags and where to read more", () => {
    expect(HELP).toContain("sluiceway init [--force] [path]");
    expect(HELP).toContain("sluiceway check [path]");
    expect(HELP).toContain("--version");
    expect(HELP).toContain("https://docs.sluiceway.dev/guides/init/");
  });

  test("--version prints the version of the package alone", async () => {
    const { code, out } = await cli(["--version"], tmpdir());
    expect(code).toBe(0);
    expect(out).toEqual(["0.27.0"]);
  });

  test("no command prints the help to stderr and is a usage error", async () => {
    const { code, out, err } = await cli([], tmpdir());
    expect(code).toBe(2);
    expect(out).toEqual([]);
    expect(err).toEqual(["Name a command.", "", HELP]);
  });

  test("a usage error says so in one line and points at --help", async () => {
    const { code, err } = await cli(["init", "--yes"], tmpdir());
    expect(code).toBe(2);
    expect(err).toEqual([
      'Unknown option "--yes" for init. Run sluiceway --help to see the commands.',
    ]);
  });
});

describe("a mode that needs a runner", () => {
  test.each(["scan", "resolve", "apply", "settle"])(
    "%s is refused in one sentence, and nothing runs",
    async (mode) => {
      const root = repo(PULUMI);
      const before = tree(root);
      // A laptop with a token in reach is still no runner.
      process.env = { ...saved, GITHUB_TOKEN: "ghs_not_a_token", INPUT_MODE: mode };
      const { code, out, err } = await cli([mode], root);
      expect(code).toBe(2);
      expect(out).toEqual([]);
      expect(err).toEqual([
        `sluiceway ${mode} needs the run's identity and the workflow token, so it runs only in the workflow: https://docs.sluiceway.dev/guides/workflow/`,
      ]);
      expect(tree(root)).toEqual(before);
    },
  );
});

describe("init", () => {
  test("writes the files init writes today, byte for byte", async () => {
    for (const example of ["pulumi-basic", "opentofu-basic", "helm-basic"]) {
      // The action's own door, as record 0065 had a person start it.
      const before = repo({}, example);
      process.env = { ...saved, GITHUB_WORKSPACE: before, GITHUB_ACTIONS: "" };
      const realLog = console.log;
      console.log = () => {};
      try {
        await runInit();
      } finally {
        console.log = realLog;
        process.env = { ...saved };
      }

      const after = repo({}, example);
      const { code } = await cli(["init"], after);
      expect(code).toBe(0);
      expect(tree(after)).toEqual(tree(before));
    }
  });

  test("works on the directory it is given, relative to where the person stands", async () => {
    const root = repo(PULUMI);
    const { code, text } = await cli(["init", relative(dirname(root), root)], dirname(root));
    expect(code).toBe(0);
    expect(existsSync(join(root, WORKFLOW))).toBe(true);
    expect(text).toContain("Found 1 stack.");
    expect(text).toContain("  network:prod");
    expect(text).not.toContain("::");
  });

  test("tells the person to run the check through the command line", async () => {
    const { text } = await cli(["init"], repo(PULUMI));
    expect(text).toContain("- Review the files, run npx sluiceway check, and commit them.");
  });

  test("a workflow that is there stops it, and the message names --force", async () => {
    const root = repo({ ...PULUMI, [WORKFLOW]: "name: mine\n" });
    const { code, err } = await cli(["init"], root);
    expect(code).toBe(1);
    expect(err).toEqual([
      `A workflow runs Sluiceway already: ${WORKFLOW}. init never overwrites one, and wrote nothing. Run npx sluiceway check to see what it lacks, or npx sluiceway init --force to write ${WORKFLOW} again.`,
    ]);
    expect(readFileSync(join(root, WORKFLOW), "utf8")).toBe("name: mine\n");
  });

  test("--force writes the workflow again and says it replaced it", async () => {
    const fresh = repo(PULUMI);
    await cli(["init"], fresh);
    const root = repo({ ...PULUMI, [WORKFLOW]: "name: mine\n" });
    const { code, text } = await cli(["init", "--force"], root);
    expect(code).toBe(0);
    expect(text).toContain(`Replaced ${WORKFLOW}.`);
    expect(readFileSync(join(root, WORKFLOW), "utf8")).toBe(
      readFileSync(join(fresh, WORKFLOW), "utf8"),
    );
  });

  test("--force replaces that one file, never another workflow that runs Sluiceway", async () => {
    const other = ".github/workflows/infra.yml";
    const root = repo({
      ...PULUMI,
      [other]:
        "on: push\njobs:\n  scan:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: sluiceway/sluiceway@v0\n",
    });
    const { code, err } = await cli(["init", "--force"], root);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain(`A workflow runs Sluiceway already: ${other}.`);
    expect(existsSync(join(root, WORKFLOW))).toBe(false);
  });

  test("a directory that is not there", async () => {
    const { code, err } = await cli(["init", "nowhere"], tmpdir());
    expect(code).toBe(1);
    expect(err).toEqual([`There is no directory at ${join(tmpdir(), "nowhere")}.`]);
  });

  test("Node 20 is refused with words", async () => {
    const { code, err } = await cli(["init"], repo(PULUMI), "20.18.1");
    expect(code).toBe(1);
    expect(err).toEqual(["sluiceway needs Node 22 or newer, and this is Node 20.18.1."]);
  });
});

describe("check", () => {
  test("says which stacks it found and what the workflow lacks, and ends well", async () => {
    const root = repo({ ...PULUMI, "README.md": "" });
    const { code, text } = await cli(["check"], root);
    expect(code).toBe(0);
    expect(text).toContain("Found 1 stack.");
    expect(text).toContain("network:prod");
    expect(text).toContain("The setup is valid.");
    // What each stack needs, names only (slice 5.34).
    expect(text).toContain("Credentials each stack needs");
    expect(text).toContain(
      "network:prod needs the Pulumi backend: PULUMI_ACCESS_TOKEN or PULUMI_BACKEND_URL.",
    );
    expect(text).not.toContain("::");
  });

  test("after init, finds nothing missing", async () => {
    const root = repo({}, "pulumi-basic");
    await cli(["init"], root);
    const { code, text } = await cli(["check"], root);
    expect(code).toBe(0);
    expect(text).toContain("Nothing is missing from the workflows.");
  });

  test("lists the root modules discovery found and left out", async () => {
    const root = repo({
      "infra/main.tf": 'terraform {\n  backend "s3" {}\n}\n',
      "infra/.terraform.lock.hcl": 'provider "registry.opentofu.org/hashicorp/null" {}\n',
    });
    const { text } = await cli(["check"], root);
    expect(text).toContain("infra");
    expect(text).toContain("Root modules found from their files");
  });

  test("a config that is not valid fails with the message a scan gives", async () => {
    const root = repo({ ...PULUMI, "sluiceway.yaml": "tickers: [someone/team]\n" });
    const { code, err } = await cli(["check"], root);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("Teams are not supported yet");
  });

  test("needs no git repo, only a directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "sluiceway-cli-plain-"));
    for (const [file, text] of Object.entries(PULUMI)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    const { code } = await cli(["check", root], tmpdir());
    expect(code).toBe(0);
  });
});
