import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import { type Stack, stackId } from "../../core/stack.ts";
import type { SavedPlan, ToolContext } from "../adapter.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
import { kustomizeCommand } from "./commands.ts";
import { kubectlEnvironment } from "./environment.ts";
import { bundleManifests, sourceOf } from "./render.ts";

// The rendered set: every manifest of a stack as one YAML stream, the one
// file that the preview diffs and the deploy applies (record 0060). It is
// this adapter's saved plan. It holds every value of the manifests in plain
// text, the data of a Secret too (record 0021), so it lives in a directory of
// its own, which goes when the preview ends, or, for the set `apply` deploys,
// when `apply` lets it go. The digest is taken when the set is written and
// checked right before the deploy, so what goes out is byte for byte what the
// preview diffed. It never leaves the job and never reaches a row: record
// 0008 keeps any digest of values out of the issue.
export class RenderedSet implements SavedPlan {
  readonly path: string;
  readonly stackId: string;
  readonly digest: string;
  private readonly dir: string;

  private constructor(dir: string, stackId: string, digest: string) {
    this.dir = dir;
    this.path = join(dir, "manifests.yaml");
    this.stackId = stackId;
    this.digest = digest;
  }

  static async create(stackId: string, text: string): Promise<RenderedSet> {
    const dir = await mkdtemp(join(tmpdir(), "sluiceway-set-"));
    const set = new RenderedSet(dir, stackId, sha256(text));
    await writeFile(set.path, text, { mode: 0o600 });
    return set;
  }

  // Whether the file still holds exactly what was written.
  async intact(): Promise<boolean> {
    try {
      return sha256(await readFile(this.path, "utf8")) === this.digest;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export type Rendered =
  | { ok: true; set: RenderedSet; toolLog: string }
  | { ok: false; reason: PreviewFailureReason; toolLog: string };

// Renders the stack's directory into a set of its own: the manifests as they
// are, or what `kubectl kustomize` builds of a kustomization. kustomize reads
// files and reaches no cluster. Its stdout is the manifests, values and all,
// so only its stderr goes to the job log.
export async function renderSet(
  stack: Stack,
  context: ToolContext & { timeoutMinutes: number },
): Promise<Rendered> {
  const dir = join(context.root, stack.path);
  if (sourceOf(dir) === "manifests") {
    return {
      ok: true,
      set: await RenderedSet.create(stackId(stack), bundleManifests(dir)),
      toolLog: "",
    };
  }
  const result = await context.run({
    argv: kustomizeCommand(),
    cwd: dir,
    env: kubectlEnvironment(context.env),
    timeoutMs: context.timeoutMinutes * 60_000,
  });
  if (result.status === "not-started") {
    return { ok: false, reason: { kind: "tool-error", exitCode: null }, toolLog: "" };
  }
  const toolLog = stripAnsi(result.stderr);
  if (result.status === "timed-out") {
    return { ok: false, reason: { kind: "timed-out", minutes: context.timeoutMinutes }, toolLog };
  }
  if (result.exitCode !== 0) {
    return { ok: false, reason: { kind: "tool-error", exitCode: result.exitCode }, toolLog };
  }
  return { ok: true, set: await RenderedSet.create(stackId(stack), result.stdout), toolLog };
}
