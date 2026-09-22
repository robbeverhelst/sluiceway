import { join } from "node:path";
import { z } from "zod";
import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import type { Stack } from "../../core/stack.ts";
import type { BackendAnswer, BackendResult, ToolContext } from "../adapter.ts";
import { pulumiEnvironment } from "./environment.ts";
import { stripAnsi } from "./tool-log.ts";

// Which stacks the backend holds (record 0074), for the check with
// backend: true: one `pulumi stack ls` per project directory, which lists the
// stacks of that project. It reads the backend and changes nothing, takes no
// lock and needs no passphrase (recorded on v3.229.0 and v3.263.0).
const LIST = ["pulumi", "stack", "ls", "--json", "--non-interactive", "--color", "never"];

// The check takes no preview-timeout input, so a question gets the default of
// that input. Listing stacks is far quicker than a preview.
export const BACKEND_TIMEOUT_MINUTES = 10;

// Only the name is read. The entries also hold times, counts and a web
// address, which the check has no use for.
const listed = z.array(z.object({ name: z.string() }));

export async function findInBackend(stacks: Stack[], context: ToolContext): Promise<BackendResult> {
  const answers: BackendAnswer[] = [];
  const logs: string[] = [];
  for (const [path, inPath] of Map.groupBy(stacks, (stack) => stack.path)) {
    const result = await context.run({
      argv: LIST,
      cwd: join(context.root, path),
      env: pulumiEnvironment(context.env),
      timeoutMs: BACKEND_TIMEOUT_MINUTES * 60_000,
    });
    const unknown = (reason: PreviewFailureReason) =>
      answers.push(...inPath.map((stack) => ({ stack, found: "unknown" as const, reason })));
    if (result.status === "not-started") {
      unknown({ kind: "tool-error", exitCode: null });
      continue;
    }
    if (result.stderr !== "") logs.push(stripAnsi(result.stderr));
    if (result.status === "timed-out") {
      unknown({ kind: "timed-out", minutes: BACKEND_TIMEOUT_MINUTES });
      continue;
    }
    if (result.exitCode !== 0) {
      unknown({ kind: "tool-error", exitCode: result.exitCode });
      continue;
    }
    const parsed = parseList(result.stdout);
    if (parsed === undefined) {
      unknown({ kind: "unreadable-output" });
      continue;
    }
    // A backend may name a stack with its organization and project in front,
    // as organization/project/stack. The list is of this project alone, so
    // the last part is the stack's name.
    const names = new Set(parsed.map(({ name }) => name.split("/").at(-1)));
    answers.push(...inPath.map((stack) => ({ stack, found: names.has(stack.name) })));
  }
  return { answers, toolLog: logs.join("") };
}

function parseList(stdout: string): z.output<typeof listed> | undefined {
  try {
    const parsed = listed.safeParse(JSON.parse(stdout));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
