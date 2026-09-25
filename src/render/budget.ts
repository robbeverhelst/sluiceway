// The size budget (records 0024 and 0028): how large the dashboard body may get
// before pending rows are shortened. An issue body that is too large is dropped
// without an error, so a body over the hard limit is never handed to a writer.

import { MAX_UPDATES } from "../core/merge-and-deploy.ts";
import { type BodyInput, renderBody, rowBlock } from "./body.ts";
import type { ParsedMerge, ParsedRow } from "./marker.ts";
import { byCodeUnit, type Row, type RowLevel } from "./row.ts";

export interface BudgetInput extends Omit<BodyInput, "rows"> {
  // The rows this writer has a diff for, in any order.
  rows: readonly Row[];
  // The row blocks it carries through from the live body as they are. A writer
  // may not read a row's text, so these are never shortened (record 0028). A
  // full scan has none.
  carried: readonly ParsedRow[];
  // `dashboard.redact` (record 0023), for the writer's own rows.
  redact?: boolean | undefined;
}

export interface FittedBody {
  body: string;
  // The size of `body`, counted the way the limits are.
  size: number;
  // How many of the writer's own rows are shortened.
  shortened: number;
  // Every row block in `body`, carried and own, as a reader of the body finds
  // them. The facts of the row set are read from these, so nobody parses a
  // body they just rendered.
  rows: ParsedRow[];
  // False when the body is over the hard limit with every row of the writer
  // cut as far as it goes. Such a body is never written.
  fits: boolean;
  // How many updates waiting to merge past the oldest thirty the body had no
  // room for (record 0071).
  mergesLeftOut: number;
}

export interface BudgetOptions {
  // What the body aims at. The default is the target of record 0028. A writer
  // that only swaps rows aims at the hard limit instead (record 0028).
  target?: number | undefined;
  // Over this the body does not fit. Only a test has a reason to change it.
  limit?: number | undefined;
}

// The renderer aims at this, the headroom Renovate keeps under the same limit
// (record 0028). It leaves room for a late row swap to grow the body a little.
export const BODY_TARGET = 58_000;

// The hard limit (record 0028, issue 17). A create refuses more characters
// than this, and an update drops a body over 262,144 bytes without an error.
// Sizes are counted in UTF-16 units, which is never fewer than GitHub's
// characters, and a body inside this limit is at most 196,608 bytes. So the
// one number keeps a body inside both limits, as it does in the write loop.
export const BODY_LIMIT = 65_536;

// For the scan to fail with when nothing fits. The old body stays.
export function bodyDoesNotFitMessage(size: number): string {
  const count = (value: number) => value.toLocaleString("en-US");
  return `The dashboard does not fit in one issue. With every pending row shortened as far as it goes the body is ${count(size)} characters, and GitHub drops a body over ${count(BODY_LIMIT)} without an error. Nothing was written and the dashboard stays as it was. It fits again with fewer stacks pending at once: deploy some, or take stacks off the dashboard with \`ignore\` in \`sluiceway.yaml\`.`;
}

const LEVELS: RowLevel[] = [0, 1, 2, 3];

// One of the writer's own rows, rendered once at every level it can have.
interface Entry {
  stackId: string;
  blocks: ParsedRow[];
  // A deploying or queued row without its spinner, when it has one.
  still?: ParsedRow | undefined;
  level: number;
}

function sizeOf(entry: Entry, level = entry.level): number {
  return entry.blocks[level]?.text.length ?? 0;
}

export function fitBody(input: BudgetInput, options: BudgetOptions = {}): FittedBody {
  const limit = options.limit ?? BODY_LIMIT;
  const target = Math.min(options.target ?? BODY_TARGET, limit);
  // The updates waiting to merge, oldest first and one line per pull request,
  // as the body lists them. The oldest thirty always stay. The newer ones are
  // the first thing to go when the body is over its target: they only offer
  // a merge, and are listed as the older ones merge (record 0071).
  const allMerges = oneLinePerPullRequest(input.merges ?? []);
  let merges = allMerges;
  // The spinner of a deploying or queued row is an image, like the header, so
  // it goes with it (record 0063). It is the first thing to go when the body
  // does not fit: every one of them, before any pending row is shortened.
  let spinning = input.personality;
  const entries = input.rows.map((row): Entry => {
    // A drifted row shortens too (record 0055). Its levels 1 and 3 look like
    // 0 and 2, and the budget never picks a level that saves nothing.
    const levels = row.state === "pending" || row.state === "drift" ? LEVELS : LEVELS.slice(0, 1);
    const plain = {
      redact: input.redact,
      readOnly: input.readOnly,
      timeZone: input.timeZone,
      // `dashboard.pendingDetail` (record 0114). At a shorter detail levels 1
      // and 2 save nothing, and the budget never picks a level that does not.
      detail: input.layout?.pendingDetail,
    };
    const blocks = levels.map((level) =>
      rowBlock(row, { ...plain, level, actionRef: spinning ? input.actionRef : undefined }),
    );
    const still = row.state === "deploying" && spinning ? rowBlock(row, plain) : undefined;
    return { stackId: blocks[0]?.stackId ?? "", blocks, still, level: 0 };
  });
  const blockOf = (entry: Entry) => (!spinning && entry.still) || entry.blocks[entry.level] || [];
  // What each deploy of the trail shipped is history, and a row decides a
  // deploy: its names become a count next, before any pending row gives way
  // (record 0072).
  let shortTrail = input.shortTrail ?? false;
  const drawn = () => [...input.carried, ...entries.flatMap(blockOf)];
  const render = () =>
    renderBody({
      ...input,
      rows: drawn(),
      merges,
      shortTrail,
    });
  const fits = () => render().length <= target;
  if (allMerges.length > MAX_UPDATES && !fits()) {
    // The most of the newer ones that fit, found by halving.
    let low = 0;
    let high = allMerges.length - MAX_UPDATES - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      merges = allMerges.slice(0, MAX_UPDATES + middle);
      if (fits()) low = middle;
      else high = middle - 1;
    }
    merges = allMerges.slice(0, MAX_UPDATES + low);
  }
  if (spinning && !fits()) spinning = false;
  if (!shortTrail && input.recentlyDeployed.some(({ shipped }) => shipped) && !fits())
    shortTrail = true;

  for (const level of LEVELS.slice(1)) {
    const biggestFirst = [...entries].sort(
      (a, b) => sizeOf(b) - sizeOf(a) || byCodeUnit(a.stackId, b.stackId),
    );
    for (const entry of biggestFirst) {
      if (fits()) break;
      // A higher level is not always smaller: a count can be longer than the
      // one pull request it replaces, and the warning longer than one delete
      // line. So this measures, and never shortens a row for nothing.
      if (entry.blocks[level] && sizeOf(entry, level) < sizeOf(entry)) entry.level = level;
    }
  }

  // Cutting a few huge rows often makes room to show the small ones in full
  // again: smallest full size first, the lowest level at which the body fits.
  const smallestFirst = [...entries].sort(
    (a, b) => sizeOf(a, 0) - sizeOf(b, 0) || byCodeUnit(a.stackId, b.stackId),
  );
  for (const entry of smallestFirst) {
    const reached = entry.level;
    for (const level of LEVELS.slice(0, reached)) {
      entry.level = level;
      if (fits()) break;
      entry.level = reached;
    }
  }

  const body = render();
  const shortened = entries.filter((entry) => entry.level > 0).length;
  return {
    body,
    size: body.length,
    shortened,
    rows: drawn(),
    fits: body.length <= limit,
    mergesLeftOut: allMerges.length - merges.length,
  };
}

// Of two lines for one pull request the first stays, as the body keeps it.
function oneLinePerPullRequest(merges: readonly ParsedMerge[]): ParsedMerge[] {
  return merges
    .filter((merge, index, all) => all.findIndex((one) => one.pr === merge.pr) === index)
    .sort((a, b) => a.pr - b.pr);
}
