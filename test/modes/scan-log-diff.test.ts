// Record 0048: with `scan.logDiff` on, a scan runs the tool a second time for
// every pending stack and prints the tool's own diff, values included, in that
// stack's group of the job log. Nowhere else. Off by default, and then there
// is no second run at all.

import { describe, expect, test } from "bun:test";
import type { GitHubPort } from "../../src/github/port.ts";
import { scan } from "../../src/modes/scan.ts";
import type { FakeGitHub } from "../fake-github/fake-github.ts";
import {
  change,
  dashboardBody,
  failing,
  harness,
  inSync,
  JOB_URL,
  pending,
  SUMMARY_URL,
  tableAdapter,
  toolDiffText,
} from "./harness.ts";
import { rememberingOutputs } from "./outputs-harness.ts";

const ON = "scan:\n  logDiff: true\n";

const TABLE = () => ({
  "network:dev": pending("network:dev", change("logs")),
  "network:prod": failing(),
  "site:prod": inSync("site:prod"),
  "zone:dev": pending("zone:dev", change("records"), change("old", "delete")),
});

// Every argument of every call the scan makes to GitHub: the dashboard body,
// comments, deployment records and their statuses.
function spied(github: FakeGitHub): { port: GitHubPort; sent: string[] } {
  const sent: string[] = [];
  const port = new Proxy(github, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        sent.push(`${String(key)} ${JSON.stringify(args)}`);
        return value.apply(target, args);
      };
    },
  });
  return { port, sent };
}

describe("scan.logDiff off, the default", () => {
  test("no second run of the tool at all, and no group holds a tool diff", async () => {
    const adapter = tableAdapter(TABLE());
    const { context, log } = harness(adapter);
    await scan(context);

    expect(adapter.toolDiffs).toEqual([]);
    expect(log.groups.filter((group) => group.verbatim !== undefined)).toEqual([]);
  });

  test("a pending row's preview link lands on the summary, as record 0044 has it", async () => {
    const { context, github } = harness(tableAdapter(TABLE()));
    await scan(context);
    expect(dashboardBody(github)).toContain(`· 1 update · [preview](${SUMMARY_URL})`);
  });
});

describe("scan.logDiff on", () => {
  test("one run per pending stack, with the stack's time limit, and none for a stack in sync or a failed preview", async () => {
    const adapter = tableAdapter(TABLE());
    const config = `${ON}stacks:\n  - path: zone\n    previewTimeout: 3\n`;
    const { context } = harness(adapter, { config });
    await scan(context);

    expect([...adapter.toolDiffs].sort()).toEqual(["network:dev", "zone:dev"]);
    expect(adapter.toolDiffTimeouts).toEqual({ "network:dev": 10, "zone:dev": 3 });
  });

  test("runs through the same pool: the tool never runs for more stacks at once than the pool holds", async () => {
    let running = 0;
    let most = 0;
    const busy = async <T>(answer: T): Promise<T> => {
      running++;
      most = Math.max(most, running);
      await new Promise((done) => setTimeout(done, 5));
      running--;
      return answer;
    };
    const ids = ["a:1", "b:1", "c:1", "d:1", "e:1"];
    const adapter = tableAdapter(
      Object.fromEntries(ids.map((id) => [id, () => busy(pending(id, change("x")))])),
      {},
      Object.fromEntries(
        ids.map((id) => [id, () => busy({ ok: true, text: toolDiffText(id), toolLog: "" })]),
      ),
    );
    const { context } = harness(adapter, { config: ON, concurrency: 2 });
    await scan(context);

    expect(adapter.toolDiffs).toHaveLength(5);
    expect(most).toBe(2);
  });

  test("the tool's diff is printed in its stack's group, after Sluiceway's own lines", async () => {
    const { context, log } = harness(tableAdapter(TABLE()), { config: ON });
    await scan(context);

    expect(log.groups.find((group) => group.title === "network:dev")).toEqual({
      title: "network:dev",
      lines: [
        "1 update",
        "update aws:s3/bucket:Bucket logs · tags",
        "The tool's own diff follows, values included, because scan.logDiff is on in sluiceway.yaml:",
      ],
      verbatim: [toolDiffText("network:dev").trimEnd()],
    });
  });

  test("the value reaches that stack's group of the job log and nothing else", async () => {
    const { context, github, log } = harness(tableAdapter(TABLE()), { config: ON });
    const { port, sent } = spied(github);
    const outputs = rememberingOutputs();
    await scan({ ...context, github: port, outputs });

    const value = "VALUE-OF-network:dev";
    const [inGroup, ...elsewhere] = log.groups.filter((group) =>
      JSON.stringify(group).includes(value),
    );
    expect(inGroup?.title).toBe("network:dev");
    expect(elsewhere).toEqual([]);
    expect(inGroup?.lines.join("\n")).not.toContain(value);

    const everythingElse = [
      ...sent,
      dashboardBody(github),
      ...log.lines,
      ...log.summaries,
      ...log.warnings.map(({ title, message }) => `${title} ${message}`),
      JSON.stringify(outputs.calls),
      JSON.stringify(outputs.resultFile("scan")),
    ].join("\n");
    expect(everythingElse).toContain("network:dev");
    expect(everythingElse).not.toContain("VALUE-OF");
  });

  test("a pending row's preview link lands on the job log, where the diff is", async () => {
    const { context, github } = harness(tableAdapter(TABLE()), { config: ON });
    await scan(context);

    const body = dashboardBody(github);
    expect(body).toContain(`- [ ] **network:dev** · 1 update · [preview](${JOB_URL})`);
    // A preview failure already links there (record 0044).
    expect(body).toContain(`· [run](${JOB_URL})`);
  });

  test("without the job's id the link falls back to the summary", async () => {
    const { context, github } = harness(tableAdapter(TABLE()), { config: ON, jobId: undefined });
    await scan(context);
    expect(dashboardBody(github)).toContain(`· 1 update · [preview](${SUMMARY_URL})`);
  });

  test("the summary says where the tool's diff is, one click away", async () => {
    const { context, log } = harness(tableAdapter(TABLE()), { config: ON });
    await scan(context);
    expect(log.summaries.at(-1)).toContain(
      `The tool's own diff of every pending stack, values included, is in the [job log](${JOB_URL}), in the stack's group.`,
    );
  });

  test("a second run that fails never changes the row, and its group says why", async () => {
    const good = harness(tableAdapter(TABLE()), { config: ON });
    await scan(good.context);

    const adapter = tableAdapter(
      TABLE(),
      {},
      {
        "network:dev": {
          ok: false,
          reason: { kind: "tool-error", exitCode: 1 },
          toolLog: "error: something broke\n",
        },
        "zone:dev": { ok: false, reason: { kind: "timed-out", minutes: 10 }, toolLog: "" },
      },
    );
    const bad = harness(adapter, { config: ON });
    await scan(bad.context);

    expect(dashboardBody(bad.github)).toBe(dashboardBody(good.github));
    expect(bad.log.summaries).toEqual(good.log.summaries);
    expect(bad.log.warnings).toEqual(good.log.warnings);
    expect(bad.log.groups.find((group) => group.title === "network:dev")).toEqual({
      title: "network:dev",
      lines: [
        "1 update",
        "update aws:s3/bucket:Bucket logs · tags",
        "The tool's own diff could not be shown: the tool exited with an error (exit code 1). The row and the diff hash come from the preview above and do not depend on it.",
        "The tool's own words:",
        "error: something broke",
      ],
    });
    expect(bad.log.groups.find((group) => group.title === "zone:dev")?.lines).toContain(
      "The tool's own diff could not be shown: the preview timed out after 10 minutes. The row and the diff hash come from the preview above and do not depend on it.",
    );
  });

  test("in a public repo the run gets a warning that anyone can read the values", async () => {
    const { context, log } = harness(tableAdapter(TABLE()), { config: ON, publicRepo: true });
    await scan(context);
    expect(log.warnings).toContainEqual({
      title: "Values in the job log of a public repo",
      message:
        "scan.logDiff is on and this repository is public, so anyone can read the values in the tool's own diff in this job log. Turn it off in sluiceway.yaml unless that is what you want.",
    });
  });

  test("a private repo, or one whose visibility is not known, gets no such warning", async () => {
    for (const publicRepo of [false, undefined]) {
      const { context, log } = harness(tableAdapter(TABLE()), { config: ON, publicRepo });
      await scan(context);
      expect(log.warnings.map(({ title }) => title)).not.toContain(
        "Values in the job log of a public repo",
      );
    }
  });
});
