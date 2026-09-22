import { describe, expect, test } from "bun:test";
import { read, section } from "./docs.ts";

// Issue 166: a first scan logs "Created the dashboard", and a first user looks
// for the line the docs name. The table names every way a scan reports the
// dashboard it wrote, the three words of FOUND in src/modes/scan.ts.
const table = section(read("docs/using-the-dashboard.md"), "## Reading the job log");

describe("the job log table of a scan", () => {
  test.each([
    "Created the dashboard: <url>",
    "Reopened the dashboard and wrote it: <url>",
    "Wrote the dashboard: <url>",
  ])("names the line %p", (line) => {
    expect(table).toContain(`\`${line}`);
  });
});

// Slice 5.17 (issue 170): the only trace of a pull request held back by its
// checks used to be one line of the job log, so the table names both lines.
describe("the job log table on updates waiting to merge", () => {
  test.each([
    "#1137 is not listed to merge yet: its checks have not all finished.",
    "#1137 is not listed to merge: its checks are not all green.",
  ])("names the line %p", (line) => {
    expect(table).toContain(`\`${line}`);
  });
});

// Slice 5.18 (record 0083): what a scan did with a bulk box or a confirm box.
describe("the job log table on the bulk boxes", () => {
  test.each([
    "Cleared an orphan tick on the box that deploys all pending stacks: ...",
    "Took back the confirm box of the pending stacks: ...",
  ])("names the line %p", (line) => {
    expect(table).toContain(`\`${line}`);
  });
});
