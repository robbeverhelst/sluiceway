import { join } from "node:path";
import { type Stack, stackId } from "../../core/stack.ts";
import type { PrepareOptions, Preparation, PrepareResult, ToolContext } from "../adapter.ts";
import { runTool, stripAnsi } from "../tool-run.ts";
import { listStacks } from "./backend.ts";
import { pulumiEnvironment } from "./environment.ts";
import { PULUMI_EXIT_CODES } from "./exit-codes.ts";

// A Pulumi stack needs nothing before its preview, except when its entry
// asks that a scan create it in the backend when the backend lacks it
// (record 0107): a stack file for a stack still to be made is otherwise a
// preview failure until a person runs the tool by hand. One preparation per
// such stack: the list of the project's stacks, which reads the backend and
// changes nothing, then `pulumi stack init` when the list lacks the stack,
// with the name alone, so the tool's default secrets provider stands and the
// passphrase is the one the job already has. A stack the list holds is left
// alone. The init writes an encryption salt into the stack file of the
// checkout, which Sluiceway never commits.
//
// Only a scan hands stacks in to create; a deploy never creates a stack. Each
// stack is its own preparation, so a list or an init the tool refuses fails
// that stack's preview and no other.
export function prepare(stacks: Stack[], options?: PrepareOptions): Preparation[] {
  const asked = new Set((options?.createInBackend ?? []).map(stackId));
  return stacks
    .filter((stack) => asked.has(stackId(stack)))
    .sort((a, b) => byCodeUnit(stackId(a), stackId(b)))
    .map((stack) => ({
      title: `the stack ${stackId(stack)} in the backend`,
      stacks: [stack],
      run: (context) => createIfMissing(stack, context),
    }));
}

function initCommand(name: string): string[] {
  return ["pulumi", "stack", "init", name, "--non-interactive", "--color", "never"];
}

async function createIfMissing(
  stack: Stack,
  context: ToolContext & { timeoutMinutes: number },
): Promise<PrepareResult> {
  if (stack.name === undefined) throw new Error("A Pulumi stack always has a name.");
  const id = stackId(stack);
  const listed = await listStacks(context, stack.path, context.timeoutMinutes, PULUMI_EXIT_CODES);
  if (!listed.ok) return { ok: false, reason: listed.reason, toolLog: listed.toolLog };
  if (listed.names.has(stack.name)) {
    return {
      ok: true,
      toolLog: listed.toolLog,
      detail: [`The backend already holds ${id}. Nothing was created.`],
    };
  }
  const init = await runTool(context.run, {
    argv: initCommand(stack.name),
    cwd: join(context.root, stack.path),
    env: pulumiEnvironment(context.env),
    timeoutMinutes: context.timeoutMinutes,
    exitCodes: PULUMI_EXIT_CODES,
  });
  // What init prints names the stack, and no value.
  const toolLog = listed.toolLog + stripAnsi(init.stdout + init.stderr);
  if (!init.ok) return { ok: false, reason: init.reason, toolLog };
  return {
    ok: true,
    toolLog,
    detail: [
      `The backend did not hold ${id}, so the stack was created. Its preview shows every resource as a create.`,
    ],
  };
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
