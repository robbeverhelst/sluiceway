import { expect, test } from "bun:test";
import { pulumi } from "../../src/adapters/pulumi/index.ts";
import type { Diff } from "../../src/core/diff.ts";
import { diffHash } from "../../src/core/diff-hash.ts";
import { diffLogLines } from "../../src/render/log-text.ts";
import { renderRow } from "../../src/render/row.ts";
import { renderSummary } from "../../src/render/summary.ts";
import { ROOT, replay, VERSIONS } from "../adapters/pulumi/replay.ts";

// Record 0045, end to end on what the real CLI printed: changes deep inside
// properties reach the row, the summary and the job log as paths, the same
// from both CLI versions, and never with a value.

async function recorded(version: string): Promise<Diff> {
  const result = await pulumi.preview(
    { path: "generated/nested", name: "dev", options: {} },
    { root: ROOT, env: {}, run: replay(version, "nested-paths").run, timeoutMinutes: 10 },
  );
  if (!result.ok) throw new Error(`expected a diff, got the failure ${result.reason.kind}`);
  return result.diff;
}

function shown(diff: Diff): string {
  const row = renderRow({ state: "pending", diff, hash: diffHash(diff), runUrl: "run-url" });
  const { text } = renderSummary([{ kind: "diff", diff }]);
  return [row, text, ...diffLogLines(diff)].join("\n");
}

test("the recorded nested changes read the same from both CLI versions", async () => {
  const [first, ...rest] = await Promise.all(VERSIONS.map(recorded));
  for (const other of rest) expect(shown(other)).toBe(shown(first as Diff));
  expect(shown(first as Diff)).toMatchSnapshot();
});

test("the row names the paths, and the replace says which key forced it", async () => {
  const lines = renderRow({
    state: "pending",
    diff: await recorded(VERSIONS[0] ?? ""),
    hash: "00000000000000aa",
    runUrl: "run-url",
  }).split("\n");

  expect(lines[1]).toBe(
    "  :warning: <kbd>REPLACE</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>settings</b> · forced by <code>data&#91;&quot;app.properties&quot;&#93;</code>",
  );
  expect(lines[3]).toBe(
    "  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>web</b> · <code>metadata.annotations&#91;&quot;example.com/revision&quot;&#93;</code>, <code>spec.template.spec.containers&#91;0&#93;.env&#91;0&#93;.value</code>, <code>spec.template.spec.containers&#91;0&#93;.image</code><br>",
  );
});
