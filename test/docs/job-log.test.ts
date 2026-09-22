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
