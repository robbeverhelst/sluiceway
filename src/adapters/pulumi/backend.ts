import { join } from "node:path";
import { z } from "zod";
import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import type { Stack } from "../../core/stack.ts";
import type { BackendAnswer, BackendResult, ToolContext } from "../adapter.ts";
import { type ExitCodes, runTool, stripAnsi } from "../tool-run.ts";
import { pulumiEnvironment } from "./environment.ts";

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
    const listed = await listStacks(context, path, BACKEND_TIMEOUT_MINUTES);
    if (listed.toolLog !== "") logs.push(listed.toolLog);
    if (!listed.ok) {
      answers.push(
        ...inPath.map((stack) => ({ stack, found: "unknown" as const, reason: listed.reason })),
      );
      continue;
    }
    answers.push(...inPath.map((stack) => ({ stack, found: listed.names.has(stack.name) })));
  }
  return { answers, toolLog: logs.join("") };
}

// The names of the stacks the backend holds for one project directory, or
// why the tool could not say. A backend may name a stack with its
// organization and project in front, as organization/project/stack. The list
// is of this project alone, so the last part is the stack's name. The tool's
// words are its stderr alone: the list itself holds no value, and nobody
// needs it in the log.
export async function listStacks(
  context: ToolContext,
  path: string,
  timeoutMinutes: number,
  exitCodes?: ExitCodes,
): Promise<
  ({ ok: true; names: Set<string | undefined> } | { ok: false; reason: PreviewFailureReason }) & {
    toolLog: string;
  }
> {
  const result = await runTool(context.run, {
    argv: LIST,
    cwd: join(context.root, path),
    env: pulumiEnvironment(context.env),
    timeoutMinutes,
    exitCodes,
  });
  const toolLog = stripAnsi(result.stderr);
  if (!result.ok) return { ok: false, reason: result.reason, toolLog };
  const parsed = parseList(result.stdout);
  if (parsed === undefined) return { ok: false, reason: { kind: "unreadable-output" }, toolLog };
  return { ok: true, names: new Set(parsed.map(({ name }) => name.split("/").at(-1))), toolLog };
}

function parseList(stdout: string): z.output<typeof listed> | undefined {
  try {
    const parsed = listed.safeParse(JSON.parse(stdout));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
