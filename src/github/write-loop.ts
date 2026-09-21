import { BODY_LIMIT } from "../render/budget.ts";
import type { GitHubPort } from "./port.ts";

// Record 0004: at most three tries.
const MAX_TRIES = 3;

// Builds the new body from the live one. It is called again on every try, so
// it does its own late reads (the open deployments) inside, and none of the
// slow work: previews are done before the loop starts (record 0004).
export type BuildBody = (liveBody: string) => string | Promise<string>;

export interface WriteResult {
  // False when the live body already was what the builder gave, so the last
  // try sent nothing.
  written: boolean;
  tries: number;
  body: string;
}

// The builder gave a body over the hard limit, the one number that the size
// budget owns (BODY_LIMIT, record 0028). The budget exists so that this never
// happens. This is the last line behind it.
export class BodyTooLargeError extends Error {
  constructor(body: string) {
    super(
      `The dashboard body came out at ${count(body.length)} characters. The most Sluiceway ever writes is ${count(BODY_LIMIT)}, the size GitHub takes on every path. Nothing was written and the dashboard stays as it was.`,
    );
    this.name = "BodyTooLargeError";
  }
}

export class DashboardWriteError extends Error {
  constructor(number: number, lastBody: string) {
    super(
      `The dashboard (#${number}) could not be written. Sluiceway tried ${MAX_TRIES} times, and each time the body GitHub stored afterwards was not the body it sent. Either other writers kept getting in between, or GitHub dropped the body without an error, which it does when a body is too large for it. The last body sent was ${count(lastBody.length)} characters and ${count(byteLength(lastBody))} bytes.`,
    );
    this.name = "DashboardWriteError";
  }
}

// The one way any mode writes the dashboard body (record 0004): read the live
// body, build, skip the write when nothing would change, write, read back. A
// write that did not stick is tried again from the late read. There is no lock,
// so this is all that stands between two writers.
export async function writeBody(
  github: GitHubPort,
  number: number,
  build: BuildBody,
): Promise<WriteResult> {
  let live = await github.getIssue(number);
  for (let tries = 1; ; tries++) {
    const body = await build(live.body);
    if (body === live.body) return { written: false, tries, body };
    if (body.length > BODY_LIMIT) throw new BodyTooLargeError(body);
    await github.updateIssueBody(number, body);
    // The answer to the update proves nothing (issue 17). Only a read does.
    // When the write was lost, this read is the late read of the next try.
    live = await github.getIssue(number);
    if (live.body === body) return { written: true, tries, body };
    if (tries === MAX_TRIES) throw new DashboardWriteError(number, body);
  }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}
