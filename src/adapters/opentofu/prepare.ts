import { join } from "node:path";
import type { Stack } from "../../core/stack.ts";
import type { Preparation, PrepareResult, ToolContext } from "../adapter.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
import { command, initArgs, synthCommand, workingDirectory } from "./commands.ts";
import { optionsOf, tofuEnvironment } from "./environment.ts";
import { CDKTF } from "./options.ts";

// `tofu init` must run in every fresh checkout before a plan (OpenTofu docs,
// "init"). One per directory: the stacks of one root module differ only in
// workspace and var files, which init does not read, and init writes the
// directory's .terraform, so two inits of one directory would share it. The
// modes run these one at a time and before any preview, because inits run
// side by side corrupted stacks in the first user's earlier dashboard (record
// 0053). Init gets the job's environment as it is, with no workspace of a
// stack: the workspace is selected on every later command instead.
//
// A Terragrunt unit is initialised the same way, through Terragrunt (record
// 0068). A CDK for Terraform app is one preparation too: cdktf synth writes
// every stack of the app, then each stack the entries name is initialised in
// its own directory, in name order. Discovery made sure that the stacks of
// one directory share a tool and a wrapper.
export function prepare(stacks: Stack[]): Preparation[] {
  const byPath = Map.groupBy(stacks, (stack) => stack.path);
  return [...byPath]
    .sort(([a], [b]) => byCodeUnit(a, b))
    .map(([path, grouped]) => ({
      title: path,
      stacks: grouped,
      run: async (context) => {
        const [first] = grouped;
        if (first === undefined || optionsOf(first).wrapper !== CDKTF) {
          return step(context, first ? command(first, initArgs()) : [], join(context.root, path));
        }
        const synth = await step(context, synthCommand(), join(context.root, path));
        if (!synth.ok) return synth;
        let toolLog = synth.toolLog;
        const named = [...grouped].sort((a, b) => byCodeUnit(a.name ?? "", b.name ?? ""));
        for (const stack of named) {
          const init = await step(
            context,
            command(stack, initArgs()),
            workingDirectory(context.root, stack),
          );
          toolLog += init.toolLog;
          if (!init.ok) return { ...init, toolLog };
        }
        return { ok: true, toolLog };
      },
    }));
}

async function step(
  context: ToolContext & { timeoutMinutes: number },
  argv: string[],
  cwd: string,
): Promise<PrepareResult> {
  const result = await context.run({
    argv,
    cwd,
    env: tofuEnvironment(context.env),
    timeoutMs: context.timeoutMinutes * 60_000,
  });
  if (result.status === "not-started") {
    return { ok: false, reason: { kind: "tool-error", exitCode: null }, toolLog: "" };
  }
  // What init and synth print names providers, modules and stacks, and no
  // value.
  const toolLog = stripAnsi(result.stdout + result.stderr);
  if (result.status === "timed-out") {
    return { ok: false, reason: { kind: "timed-out", minutes: context.timeoutMinutes }, toolLog };
  }
  if (result.exitCode !== 0) {
    return { ok: false, reason: { kind: "tool-error", exitCode: result.exitCode }, toolLog };
  }
  return { ok: true, toolLog };
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
