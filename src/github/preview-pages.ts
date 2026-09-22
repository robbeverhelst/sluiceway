// The preview pages of a scan on GitHub (record 0050): one check run per
// pending stack on the scanned commit, found again by its name and updated in
// place, so a scan of a commit that was scanned before adds none. The list of
// the commit's check runs is read once per scan, one request per 100 check
// runs, and each page costs one write. A page that cannot be written only
// costs its row the link: the row falls back to the summary.

import { previewPageName } from "../render/preview-page.ts";
import type { CheckRun, CheckRunOutput, GitHubPort } from "./port.ts";

export interface PreviewPageToWrite {
  stackId: string;
  output: CheckRunOutput;
}

export interface WrittenPages {
  // The address of every page that was written, by stack id.
  urls: Map<string, string>;
  created: number;
  updated: number;
  // Pages that failed on their own, with GitHub's words.
  failed: { stackId: string; message: string }[];
  // Pages that were not tried, because GitHub refused before them.
  skipped: string[];
  // Set when GitHub refused, in this call, in a way that every later write
  // would meet too. A later call skips every page and does not say it again.
  // `permission` says the token has no `checks: write`.
  refused?: { message: string; permission: boolean } | undefined;
}

export interface PreviewPages {
  write(pages: PreviewPageToWrite[]): Promise<WrittenPages>;
}

function statusOf(error: unknown): unknown {
  return (error as { status?: unknown } | null)?.status;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A 403 or a 429 answers every later write the same way: a token without
// `checks: write`, or a rate limit (research, preview-page.md).
function refusal(error: unknown): WrittenPages["refused"] {
  const status = statusOf(error);
  if (status !== 403 && status !== 429) return undefined;
  const message = messageOf(error);
  return { message, permission: /not accessible by integration/i.test(message) };
}

// One per scan, so a later round of the scan neither lists again nor tries
// again after a refusal.
export function previewPages(github: GitHubPort, sha: string): PreviewPages {
  let known: Map<string, CheckRun> | undefined;
  let refused: WrittenPages["refused"];

  return {
    async write(pages) {
      const written: WrittenPages = {
        urls: new Map(),
        created: 0,
        updated: 0,
        failed: [],
        skipped: [],
      };
      const skipRest = (from: number) => {
        written.skipped.push(...pages.slice(from).map(({ stackId }) => stackId));
        return written;
      };
      if (pages.length === 0) return written;
      if (refused) return skipRest(0);
      const refuse = (error: unknown, from: number) => {
        refused = refusal(error);
        written.refused = refused;
        return refused ? skipRest(from) : undefined;
      };

      if (!known) {
        try {
          known = new Map((await github.listCheckRuns(sha)).map((run) => [run.name, run]));
        } catch (error) {
          const stopped = refuse(error, 0);
          if (stopped) return stopped;
          for (const { stackId } of pages)
            written.failed.push({ stackId, message: messageOf(error) });
          return written;
        }
      }

      for (const [index, { stackId, output }] of pages.entries()) {
        const name = previewPageName(stackId);
        try {
          const found = known.get(name);
          let run: CheckRun | undefined;
          if (found) {
            try {
              run = await github.updateCheckRun(found.id, output);
              written.updated++;
            } catch (error) {
              // Deleting a workflow run deletes the check runs in its suite,
              // whichever workflow made them (research, preview-page.md).
              if (statusOf(error) !== 404) throw error;
            }
          }
          if (!run) {
            run = await github.createCheckRun({ sha, name, output });
            written.created++;
          }
          known.set(name, run);
          written.urls.set(stackId, run.htmlUrl);
        } catch (error) {
          const stopped = refuse(error, index);
          if (stopped) return stopped;
          written.failed.push({ stackId, message: messageOf(error) });
        }
      }
      return written;
    },
  };
}
