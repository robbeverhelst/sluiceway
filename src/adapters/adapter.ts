import type { FileReference } from "../core/check.ts";
import type { Config } from "../core/config.ts";
import type { CredentialNeed } from "../core/credentials.ts";
import type { DiscoveryNote } from "../core/discovery.ts";
import type { PreviewFailureReason } from "../core/failure-reason.ts";
import type { Stack } from "../core/stack.ts";
import type {
  ApplyResult,
  DriftResult,
  PreviewResult,
  SavedPlan,
  ToolDeploy,
  ToolDiffResult,
} from "../core/tool-result.ts";
import type { ProcessRunner } from "./process.ts";

// What an adapter needs in order to start its tool. All of it is handed in, so
// an adapter reads no global and tests can replay recorded output.
export interface ToolContext {
  // The directory of the checked-out repo.
  root: string;
  // The environment of the job, as the glue read it once. The tool gets all of
  // it except the INPUT_* variables (record 0013).
  env: Record<string, string | undefined>;
  run: ProcessRunner;
}

export interface PreviewOptions extends ToolContext {
  // The time limit of this one preview, in whole minutes (record 0012).
  timeoutMinutes: number;
  // `dashboard.showValues` (record 0052): the only paths whose values the
  // diff may hold. Absent or empty, it holds none.
  showValues?: readonly string[] | undefined;
  // The value fingerprint (record 0102): read the values the row does not
  // show and put their fingerprint on each change. Absent or false, no value
  // is read for it and no change carries one.
  valueFingerprint?: boolean | undefined;
  // The cost estimate (record 0105): also work out what the change does to
  // the monthly bill, from the plan this preview made, with the Infracost
  // CLI. Only a scan asks, and only an adapter whose tool has a plan the CLI
  // reads estimates. Absent or false, no estimate is made and nothing leaves
  // the runner for one.
  cost?: boolean | undefined;
  // Keep the plan this preview made, so a deploy can go out exactly as it
  // was hashed (record 0053). Only `apply` asks, and only an adapter whose
  // tool can save a plan keeps one. Whoever asked lets the plan go.
  savePlan?: boolean | undefined;
  // `dependsOn: auto` (record 0059): read the stacks this stack depends on
  // from its program's stack references, among these stacks of the repo.
  // Only a scan asks, and only for a stack with auto. An adapter whose tool
  // has no such references reads nothing.
  dependencies?: readonly Stack[] | undefined;
  // The policies (record 0106): hand back the tool's own preview document,
  // so the policy runner can test it. Only a scan with policies asks, and an
  // adapter that was not asked hands back none.
  keepDocument?: boolean | undefined;
}

// What a preview, a deploy, the drift check, the tool's own diff and one
// entry of the tool's history come to (issue 245). Core and render read
// them, so core/ holds them; an adapter fills them in.
export type {
  ApplyResult,
  DriftResult,
  PreviewDocument,
  PreviewResult,
  ReadDependencies,
  SavedPlan,
  ToolDeploy,
  ToolDiffResult,
} from "../core/tool-result.ts";

export interface HistoryOptions extends ToolContext {
  timeoutMinutes: number;
  // The newest entries of the history to read, deploys or not.
  limit: number;
}

export type DeployHistoryResult = (
  | { ok: true; deploys: ToolDeploy[] }
  | { ok: false; reason: PreviewFailureReason; detail: string[] }
) & {
  // The tool's own words, for the job log only (record 0022).
  toolLog: string;
};

export interface ApplyOptions {
  // The diff hash the tick approved covers drift (record 0055): the deploy
  // reads what is real first, so it puts the drift back as the code says.
  repairDrift?: boolean | undefined;
}

// A step a tool needs before it can preview some stacks, such as OpenTofu's
// init of a directory. Modes run the preparations one at a time and before
// any preview, never side by side, because inits run side by side corrupted
// stacks in the first user's earlier dashboard (record 0053).
export interface Preparation {
  // What is prepared, for the job log, such as a directory.
  title: string;
  stacks: Stack[];
  run(context: ToolContext & { timeoutMinutes: number }): Promise<PrepareResult>;
}

export type PrepareResult = ({ ok: true } | { ok: false; reason: PreviewFailureReason }) & {
  // The tool's own words, with ANSI escapes stripped. They go to the job log
  // and nowhere else (record 0022).
  toolLog: string;
  // Sluiceway's own words on what the preparation did, for its group in the
  // job log: a stack that was created, one that was there (record 0107).
  // Never a word of the tool's.
  detail?: string[];
};

export interface PrepareOptions {
  // `createInBackend: true` (record 0107): the stacks among the ones handed
  // in whose entry asks that a scan create them in the backend when it lacks
  // them. Only a scan hands them in: a deploy never creates a stack. An
  // adapter whose tool has nothing to create reads nothing of it.
  createInBackend?: readonly Stack[] | undefined;
}

// The tool is missing, too old, or did not say which version it is. The scan
// cannot do its work, so this fails the job (records 0001 and 0012). The
// message is Sluiceway's own. What the tool printed is in toolLog, for the
// job log only (record 0022).
export class ToolVersionError extends Error {
  readonly toolLog: string;

  constructor(message: string, toolLog = "") {
    super(message);
    this.name = "ToolVersionError";
    this.toolLog = toolLog;
  }
}

// A file or a directory of the repo that a stack's own files name as read
// (record 0074). It is the check's, so core/ holds it.
export type { FileReference } from "../core/check.ts";

// What the stacks in the backend are (record 0074), for the check with
// backend: true. Per stack: there, not there, or not known because the tool
// could not be asked.
export type BackendAnswer =
  | { stack: Stack; found: boolean }
  // The reason names no word of the tool's (record 0022).
  | { stack: Stack; found: "unknown"; reason: PreviewFailureReason };

export interface BackendResult {
  answers: BackendAnswer[];
  // The tool's own words, with ANSI escapes stripped. They go to the job log
  // and nowhere else (record 0022).
  toolLog: string;
}

// What Sluiceway needs from an infrastructure tool. Everything the tool's own
// words mean stays behind this interface (record 0006).
export interface Adapter {
  // Finds the stacks under root, the directory of the checked-out repo, from
  // files alone. It never asks a backend and never starts the tool, because
  // resolve and settle run it in a job that holds no credentials (record
  // 0014). Paths come back in the form a stack id uses, and the stacks in the
  // same order every time. What cannot be worked out is a DiscoveryError.
  // Ignore is not the adapter's business: applyConfig drops ignored stacks.
  // Config is for a tool whose stacks files cannot name, whose stacks come
  // from `stacks` entries that name the tool (record 0053).
  discover(root: string, config: Config): Promise<Stack[]>;

  // What discovery made of each directory it looks at without a `stacks`
  // entry, for the check to show (record 0092). Files only, like discover. An
  // adapter that finds only what is certain, such as Pulumi stacks, leaves it
  // out.
  explainDiscovery?(root: string, config: Config): Promise<DiscoveryNote[]>;

  // The files and directories of the repo that the stack's own files name as
  // read (record 0074), for the check to suggest as inputs. It reads files
  // only and never starts the tool. An adapter that cannot tell leaves it out.
  readsFiles?(root: string, stack: Stack): Promise<FileReference[]>;

  // What the stack's own files say its tool will want from the job
  // environment (record 0099), for the check to say which of it the workflow
  // provides. Names only, read from files: it never starts the tool and never
  // reads the environment. An adapter that cannot tell leaves it out.
  credentialNeeds?(root: string, stack: Stack): Promise<CredentialNeed[]>;

  // Asks the backend which of these stacks it holds (record 0074). Only the
  // check with backend: true calls it, with the credentials of its job. It
  // reads and changes nothing, and it always resolves. An adapter whose tool
  // has no such list leaves it out, or answers nothing for a stack.
  findInBackend?(stacks: Stack[], context: ToolContext): Promise<BackendResult>;

  // Checks once, before any preview, that the tool of these stacks is there
  // and new enough. Anything else is a ToolVersionError. No warn-and-continue
  // (record 0001).
  checkVersion(context: ToolContext, stacks: Stack[]): Promise<void>;

  // The steps these stacks need before their previews, in the order to run
  // them. Absent or empty, a preview needs nothing first.
  prepare?(stacks: Stack[], options?: PrepareOptions): Preparation[];

  // Works out what deploying the stack would change. It always resolves: a
  // preview that gave no diff is a preview failure with a reason, so one
  // broken stack never stops the others (record 0012). No property value is in
  // the diff, the reason or the detail (record 0021), except the values at
  // paths that `showValues` lists (record 0052).
  preview(stack: Stack, options: PreviewOptions): Promise<PreviewResult>;

  // Runs the tool a second time for a stack whose preview is pending, and
  // gives the tool's own diff (record 0048). Same directory, environment and
  // time limit as the preview. It always resolves, and nothing Sluiceway
  // decides depends on it: the row and the diff hash come from the preview.
  toolDiff(stack: Stack, options: PreviewOptions): Promise<ToolDiffResult>;

  // Compares the stack's state with real infrastructure and changes neither
  // (record 0055). Same directory, environment and time limit as the
  // preview. It always resolves. An adapter whose tool cannot do this leaves
  // it out, or answers undefined for a stack it cannot check, and that stack
  // is never checked for drift.
  detectDrift?(stack: Stack, options: PreviewOptions): Promise<DriftResult | undefined>;

  // Reads the tool's own history of the stack: its deploys, newest first,
  // whoever ran them (record 0073). It reads and changes nothing else and
  // always resolves. An adapter whose tool keeps no such history leaves it
  // out, or answers undefined for a stack it cannot read, and deploys of that
  // stack made outside the dashboard are not listed.
  deployHistory?(stack: Stack, options: HistoryOptions): Promise<DeployHistoryResult | undefined>;

  // Deploys the stack as the code is now. `apply` calls it only right after a
  // fresh preview gave the diff hash the tick approved (record 0008), and the
  // command line differs from the preview's only in what makes it a deploy
  // (record 0015). It sets no time limit of its own: a deploy stopped half way
  // can leave a stack half deployed. `apply` hands it a runner with the
  // `deploy-timeout` input's limit when a workflow sets one (slice 5.9). It always resolves. With a plan that the
  // fresh preview saved, the tool deploys that plan and nothing else (record
  // 0053). An adapter whose tool saves no plan never gets one. With
  // `repairDrift` it also puts back the drift that the approved hash covered
  // (record 0055); only an adapter with `detectDrift` is ever asked to.
  apply(
    stack: Stack,
    context: ToolContext,
    plan?: SavedPlan,
    options?: ApplyOptions,
  ): Promise<ApplyResult>;
}
