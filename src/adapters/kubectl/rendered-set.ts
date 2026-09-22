import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Change } from "../../core/diff.ts";
import type { PreviewFailureReason } from "../../core/failure-reason.ts";
import { type Stack, stackId } from "../../core/stack.ts";
import type { SavedPlan, ToolContext } from "../adapter.ts";
import type { RunResult } from "../process.ts";
import { stripAnsi } from "../pulumi/tool-log.ts";
import { inventoryCommand, kustomizeCommand, liveCommand } from "./commands.ts";
import { kubectlEnvironment, optionsOf } from "./environment.ts";
import { identityOf } from "./fold.ts";
import {
  appliedBy,
  inventoryName,
  type ListedObject,
  lists,
  objectsOf,
  pruneCandidates,
  readInventory,
  readLive,
  stubs,
  withInventory,
} from "./inventory.ts";
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
//
// A stack with pruning (record 0070) has a second file next to it, the prune
// file, which names the objects the deploy deletes after it applies the set.
// The digest covers it too.
export class RenderedSet implements SavedPlan {
  readonly path: string;
  readonly stackId: string;
  private readonly dir: string;
  private digest = "";
  private pruning = false;

  private constructor(dir: string, stackId: string) {
    this.dir = dir;
    this.path = join(dir, "manifests.yaml");
    this.stackId = stackId;
  }

  static async create(stackId: string, text: string, prune?: string): Promise<RenderedSet> {
    const set = await RenderedSet.open(stackId);
    await set.write(text, prune);
    return set;
  }

  // A directory for the set, before its text is known.
  static async open(stackId: string): Promise<RenderedSet> {
    return new RenderedSet(await mkdtemp(join(tmpdir(), "sluiceway-set-")), stackId);
  }

  // The prune file, when the deploy deletes something.
  get prunePath(): string | undefined {
    return this.pruning ? this.scratchPath : undefined;
  }

  // Where the prune file goes, also for the file of the objects a preview
  // looks for before it knows what the deploy deletes.
  get scratchPath(): string {
    return join(this.dir, "prune.yaml");
  }

  async write(text: string, prune?: string): Promise<void> {
    await writeFile(this.path, text, { mode: 0o600 });
    if (prune === undefined) await rm(this.scratchPath, { force: true });
    else await writeFile(this.scratchPath, prune, { mode: 0o600 });
    this.pruning = prune !== undefined;
    this.digest = sha256(text) + sha256(prune ?? "");
  }

  // Whether the files still hold exactly what was written.
  async intact(): Promise<boolean> {
    try {
      const text = await readFile(this.path, "utf8");
      const prune = this.pruning ? await readFile(this.scratchPath, "utf8") : "";
      return sha256(text) + sha256(prune) === this.digest;
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

// What pruning found (record 0070): the stack's inventory as the cluster
// holds it, and the objects the deploy deletes, as changes for the row.
export interface Pruning {
  inventory: string;
  listed: ListedObject[];
  deletes: Change[];
}

export type Rendered =
  | { ok: true; set: RenderedSet; toolLog: string; pruning?: Pruning }
  | { ok: false; reason: PreviewFailureReason; detail: string[]; toolLog: string };

// Renders the stack's directory into a set of its own: the manifests as they
// are, or what `kubectl kustomize` builds of a kustomization. kustomize reads
// files and reaches no cluster. Its stdout is the manifests, values and all,
// so only its stderr goes to the job log. With pruning, the stack's inventory
// joins the set, and the objects to delete are found first.
export async function renderSet(
  stack: Stack,
  context: ToolContext & { timeoutMinutes: number },
): Promise<Rendered> {
  const dir = join(context.root, stack.path);
  const options = optionsOf(stack);
  let text: string;
  let toolLog = "";
  if (sourceOf(dir) === "manifests") {
    text = bundleManifests(dir, options.recursive === true);
  } else {
    const result = await context.run({
      argv: kustomizeCommand(),
      cwd: dir,
      env: kubectlEnvironment(context.env),
      timeoutMs: context.timeoutMinutes * 60_000,
    });
    const failed = failure(result, context.timeoutMinutes);
    toolLog = result.status === "not-started" ? "" : stripAnsi(result.stderr);
    if (failed !== undefined) return { ok: false, reason: failed, detail: [], toolLog };
    text = (result as { stdout: string }).stdout;
  }
  if (options.prune !== true) {
    return { ok: true, set: await RenderedSet.create(stackId(stack), text), toolLog };
  }
  const set = await RenderedSet.open(stackId(stack));
  const pruned = await prune(stack, context, set, text);
  if (!pruned.ok) {
    await set.dispose();
    return { ...pruned, toolLog: toolLog + pruned.toolLog };
  }
  return { ok: true, set, toolLog: toolLog + pruned.toolLog, pruning: pruned.pruning };
}

// Reads the live inventory, finds which of the objects it lists and the
// manifests no longer hold are still there and were applied by the stack's
// own field manager, and writes the set with its inventory and the prune
// file. An object another field manager took over is not the stack's to
// delete, and one that is gone already needs no delete.
async function prune(
  stack: Stack,
  context: ToolContext & { timeoutMinutes: number },
  set: RenderedSet,
  text: string,
): Promise<
  | { ok: true; pruning: Pruning; toolLog: string }
  | { ok: false; reason: PreviewFailureReason; detail: string[]; toolLog: string }
> {
  const options = optionsOf(stack);
  const id = stackId(stack);
  const name = inventoryName(id, context.env.GITHUB_REPOSITORY);
  const run = (argv: string[]) =>
    context.run({
      argv,
      cwd: join(context.root, stack.path),
      env: kubectlEnvironment(context.env),
      timeoutMs: context.timeoutMinutes * 60_000,
    });

  // Neither get prints a value to the log: stdout is the objects, which stay
  // here, and only stderr is the tool's words.
  const inventory = await run(inventoryCommand(name, options));
  let toolLog = inventory.status === "not-started" ? "" : stripAnsi(inventory.stderr);
  const failed = failure(inventory, context.timeoutMinutes);
  if (failed !== undefined) return { ok: false, reason: failed, detail: [], toolLog };
  const read = readInventory((inventory as { stdout: string }).stdout);
  if (!read.ok) {
    return { ok: false, reason: { kind: "unreadable-output" }, detail: read.problems, toolLog };
  }

  const candidates = pruneCandidates(read.objects, objectsOf(text));
  const kept: { listed: ListedObject; live: Record<string, unknown> }[] = [];
  if (candidates.length > 0) {
    await writeFile(set.scratchPath, stubs(candidates), { mode: 0o600 });
    const live = await run(liveCommand(set.scratchPath, options));
    if (live.status !== "not-started") toolLog += stripAnsi(live.stderr);
    const failedLive = failure(live, context.timeoutMinutes);
    if (failedLive !== undefined) return { ok: false, reason: failedLive, detail: [], toolLog };
    const found = readLive((live as { stdout: string }).stdout);
    if (!found.ok) {
      return { ok: false, reason: { kind: "unreadable-output" }, detail: found.problems, toolLog };
    }
    const manager = options.fieldManager ?? "kubectl";
    for (const object of found.objects) {
      const identity = identityOf(object);
      const listed =
        identity === undefined
          ? undefined
          : candidates.find((candidate) => lists(candidate, identity.listed));
      if (listed !== undefined && appliedBy(object, manager)) kept.push({ listed, live: object });
    }
  }

  const deletes: Change[] = [];
  const resolved: ListedObject[] = [];
  for (const { live } of kept) {
    const identity = identityOf(live);
    if (identity === undefined) continue;
    deletes.push({
      address: identity.address,
      type: identity.type,
      name: identity.name,
      op: "delete",
      changedKeys: [],
      replaceKeys: [],
    });
    resolved.push(identity.listed);
  }
  await set.write(
    withInventory(
      text,
      name,
      id,
      kept.map(({ listed }) => listed),
    ),
    resolved.length === 0 ? undefined : stubs(resolved),
  );
  return { ok: true, pruning: { inventory: name, listed: read.objects, deletes }, toolLog };
}

// The reason a run of kubectl gives no output to read, or nothing when it
// ended well.
function failure(result: RunResult, minutes: number): PreviewFailureReason | undefined {
  if (result.status === "not-started") return { kind: "tool-error", exitCode: null };
  if (result.status === "timed-out") return { kind: "timed-out", minutes };
  return result.exitCode === 0 ? undefined : { kind: "tool-error", exitCode: result.exitCode };
}
