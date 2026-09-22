import { join } from "node:path";
import type { Stack } from "../../core/stack.ts";
import type { Preparation } from "../adapter.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
import { initCommand } from "./commands.ts";
import { tofuEnvironment } from "./environment.ts";

// `tofu init` must run in every fresh checkout before a plan (OpenTofu docs,
// "init"). One per directory: the stacks of one root module differ only in
// workspace and var files, which init does not read, and init writes the
// directory's .terraform, so two inits of one directory would share it. The
// modes run these one at a time and before any preview, because inits run
// side by side corrupted stacks in the first user's earlier dashboard (record
// 0053). Init gets the job's environment as it is, with no workspace of a
// stack: the workspace is selected on every later command instead.
export function prepare(stacks: Stack[]): Preparation[] {
  const byPath = Map.groupBy(stacks, (stack) => stack.path);
  return [...byPath]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, grouped]) => ({
      title: path,
      stacks: grouped,
      run: async (context) => {
        const result = await context.run({
          argv: initCommand(),
          cwd: join(context.root, path),
          env: tofuEnvironment(context.env),
          timeoutMs: context.timeoutMinutes * 60_000,
        });
        if (result.status === "not-started") {
          return { ok: false, reason: { kind: "tool-error", exitCode: null }, toolLog: "" };
        }
        // What init prints names providers and modules, and no value.
        const toolLog = stripAnsi(result.stdout + result.stderr);
        if (result.status === "timed-out") {
          return {
            ok: false,
            reason: { kind: "timed-out", minutes: context.timeoutMinutes },
            toolLog,
          };
        }
        if (result.exitCode !== 0) {
          return { ok: false, reason: { kind: "tool-error", exitCode: result.exitCode }, toolLog };
        }
        return { ok: true, toolLog };
      },
    }));
}
