import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Adapter, BackendAnswer } from "../../src/adapters/adapter.ts";
import { discoverAll } from "../../src/adapters/discover-all.ts";
import { type Stack, stackId } from "../../src/core/stack.ts";
import { check } from "../../src/modes/check.ts";
import { rememberingLog } from "./harness.ts";

// Slice 5.7, record 0074: with backend: true the check asks the backend which
// of the discovered stacks it holds, with the credentials of its job, and
// gives one ready-to-paste ignore block for the stacks it does not hold. Off
// by default. What it finds is a warning, never a red job.

type Files = Record<string, string>;

function repo(files: Files): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-check-backend-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const project = (name: string) => `name: ${name}\nruntime: yaml\n`;

const FILES: Files = {
  "sluiceway.yaml": [
    "ignore:",
    '  - "playground:*"',
    "  - glob: legacy:*",
    "    reason: kept by hand",
    "stacks:",
    "  - path: web",
    "    tool: helm",
    "    options:",
    "      release: web",
    "      namespace: shop",
    "      chart: oci://example.com/charts/web",
    "      version: 1.0.0",
    "",
  ].join("\n"),
  "network/Pulumi.yaml": project("network"),
  "network/Pulumi.dev.yaml": "",
  "network/Pulumi.prod.yaml": "",
  "apps/Pulumi.yaml": project("apps"),
  "apps/Pulumi.qa.yaml": "",
  "site/Pulumi.yaml": project("site"),
  "site/Pulumi.prod.yaml": "",
  "playground/Pulumi.yaml": project("playground"),
  "playground/Pulumi.dev.yaml": "",
  "legacy/Pulumi.yaml": project("legacy"),
  "legacy/Pulumi.old.yaml": "",
  "web/.keep": "",
};

// The backend as a table: a stack id and what the backend says about it.
// Stacks it leaves out are the ones whose tool cannot list stacks.
function backend(table: Record<string, BackendAnswer["found"]>, toolLog = "") {
  const asked: Stack[][] = [];
  const adapter: Pick<Adapter, "findInBackend"> = {
    async findInBackend(stacks) {
      asked.push(stacks);
      return {
        answers: stacks.flatMap((stack): BackendAnswer[] => {
          const found = table[stackId(stack)];
          if (found === undefined) return [];
          return found === "unknown"
            ? [{ stack, found, reason: { kind: "tool-error", exitCode: 255 } }]
            : [{ stack, found }];
        }),
        toolLog,
      };
    },
  };
  return { adapter, asked };
}

async function run(options: { backend?: ReturnType<typeof backend> } = {}) {
  const log = rememberingLog();
  await check({
    root: repo(FILES),
    adapter: { discover: discoverAll },
    log,
    ...(options.backend === undefined
      ? {}
      : {
          backend: {
            adapter: options.backend.adapter,
            env: { PATH: "/usr/bin" },
            stackEnvs: (stacks) =>
              new Map(stacks.map(({ id }) => [id, { ok: true, env: { PATH: "/usr/bin" } }])),
            run: async () => {
              throw new Error("The adapter answers from a table.");
            },
          },
        }),
  });
  return {
    log,
    summary: log.summaries.at(-1) ?? "",
    group: (title: string) => log.groups.find((group) => group.title === title)?.lines,
  };
}

const TABLE = {
  "apps:qa": "unknown",
  "network:dev": true,
  "network:prod": false,
  "site:prod": false,
} as const;

describe("the check with backend: true", () => {
  test("asks about every stack that has a row, never an ignored one", async () => {
    const answers = backend(TABLE);
    await run({ backend: answers });
    expect(answers.asked.map((stacks) => stacks.map(stackId))).toEqual([
      ["apps:qa", "network:dev", "network:prod", "site:prod", "web"],
    ]);
  });

  test("lists what the backend holds, and what it could not tell", async () => {
    const { group } = await run({ backend: backend(TABLE) });
    expect(group("Stacks in the backend")).toEqual([
      "apps:qa: could not ask the backend, the tool exited with an error (exit code 255).",
      "network:dev is in the backend.",
      "network:prod is not in the backend.",
      "site:prod is not in the backend.",
      "web: not checked, its tool has no list of stacks to ask.",
    ]);
  });

  test("a warning for each stack the backend does not hold, and for each it could not ask about", async () => {
    const { log } = await run({ backend: backend(TABLE) });
    expect(log.warnings).toEqual([
      {
        title: "Could not ask the backend",
        message:
          "apps:qa: could not ask the backend, the tool exited with an error (exit code 255). The tool's own words are in the job log.",
      },
      {
        title: "A stack is not in the backend",
        message:
          "network:prod has files in the repo and no stack in the backend, so a scan gives its row a preview failure. Create the stack, or leave it out with the ignore block of this check.",
      },
      {
        title: "A stack is not in the backend",
        message:
          "site:prod has files in the repo and no stack in the backend, so a scan gives its row a preview failure. Create the stack, or leave it out with the ignore block of this check.",
      },
    ]);
  });

  test("one ignore block that keeps what ignore has", async () => {
    const { group, summary } = await run({ backend: backend(TABLE) });
    const block = [
      "ignore:",
      '  - "playground:*"',
      '  - glob: "legacy:*"',
      '    reason: "kept by hand"',
      '  - "network:prod"',
      '  - "site:prod"',
    ];
    expect(group("Ready to paste into sluiceway.yaml, over ignore")).toEqual(block);
    expect(summary).toContain(["```yaml", ...block, "```"].join("\n"));
  });

  test("the summary has a section for the backend", async () => {
    const { summary } = await run({ backend: backend(TABLE) });
    expect(summary).toContain(
      [
        "### The backend",
        "",
        "| Stack | In the backend |",
        "|---|---|",
        "| apps:qa | Could not ask: the tool exited with an error (exit code 255) |",
        "| network:dev | Yes |",
        "| network:prod | No |",
        "| site:prod | No |",
        "| web | Not checked |",
      ].join("\n"),
    );
    expect(summary).not.toContain("a stack that does not exist in the backend");
  });

  test("the tool's own words go to the job log and nowhere else", async () => {
    const words = "error: PULUMI_ACCESS_TOKEN must be set\n";
    const { group, summary, log } = await run({ backend: backend(TABLE, words) });
    expect(group("The tool's own words")).toEqual(["error: PULUMI_ACCESS_TOKEN must be set"]);
    expect(summary).not.toContain("PULUMI_ACCESS_TOKEN");
    expect(JSON.stringify(log.warnings)).not.toContain("PULUMI_ACCESS_TOKEN");
  });

  test("every stack in the backend: no block, no warning", async () => {
    const all = Object.fromEntries(Object.keys(TABLE).map((id) => [id, true]));
    const { group, log } = await run({ backend: backend(all) });
    expect(group("Ready to paste into sluiceway.yaml, over ignore")).toBeUndefined();
    expect(log.warnings).toEqual([]);
    expect(log.lines).toContain("Every stack the backend was asked about is in it.");
  });
});

describe("the check without backend", () => {
  test("asks no backend, and says the option exists", async () => {
    const { group, summary, log } = await run();
    expect(group("Stacks in the backend")).toBeUndefined();
    expect(summary).not.toContain("### The backend");
    expect(summary).toContain(
      "With backend: true the check also asks the backend which stacks it holds, with the credentials of its job.",
    );
    expect(log.lines).toContain(
      "With backend: true the check also asks the backend which stacks it holds, with the credentials of its job.",
    );
  });
});
