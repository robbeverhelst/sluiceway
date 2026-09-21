import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actionsLog } from "../../src/github/job-log.ts";

// What the runner gets to read on the step's standard output.
function capture(): { printed: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return { printed: () => chunks.join(""), restore: () => spy.mockRestore() };
}

const summaryFile = process.env.GITHUB_STEP_SUMMARY;
afterEach(() => {
  if (summaryFile === undefined) delete process.env.GITHUB_STEP_SUMMARY;
  else process.env.GITHUB_STEP_SUMMARY = summaryFile;
});

describe("the job log on a real runner", () => {
  test("a group is a fold with its lines inside", () => {
    const out = capture();
    try {
      actionsLog().group("network:dev", ["1 update", "update x y"]);
    } finally {
      out.restore();
    }
    expect(out.printed()).toBe("::group::network:dev\n1 update\nupdate x y\n::endgroup::\n");
  });

  // Record 0048: the tool's own diff can quote any value, and a value on a
  // line of its own must never act as a workflow command, such as an
  // annotation that would show it on the run's page.
  test("the verbatim part is printed with workflow commands stopped by a token nobody can guess", () => {
    const out = capture();
    try {
      const log = actionsLog();
      log.group(
        "network:dev",
        ["1 update"],
        ["  ~ NOTE: a", "::error::VALUE", "  ::warning::VALUE"],
      );
      log.group("zone:dev", ["1 update"], ["  + x"]);
    } finally {
      out.restore();
    }
    const printed = out.printed();
    const token = /::stop-commands::([0-9a-f-]{36})\n/.exec(printed)?.[1] ?? "";
    expect(
      printed.startsWith(
        [
          "::group::network:dev",
          "1 update",
          `::stop-commands::${token}`,
          "  ~ NOTE: a",
          "::error::VALUE",
          "  ::warning::VALUE",
          `::${token}::`,
          "::endgroup::",
          "",
        ].join("\n"),
      ),
    ).toBe(true);
    const tokens = [...printed.matchAll(/::stop-commands::(.+)\n/g)].map((match) => match[1]);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  test("a group without a verbatim part stops nothing", () => {
    const out = capture();
    try {
      actionsLog().group("network:dev", ["1 update"], []);
    } finally {
      out.restore();
    }
    expect(out.printed()).toBe("::group::network:dev\n1 update\n::endgroup::\n");
  });

  test("a warning is an annotation with a title, and a line break cannot start a command", () => {
    const out = capture();
    try {
      actionsLog().warning("The preview of a\n::error::b failed.", "Preview failed");
    } finally {
      out.restore();
    }
    expect(out.printed()).toBe(
      "::warning title=Preview failed::The preview of a%0A::error::b failed.\n",
    );
  });

  // One file for both tests, as one step has: @actions/core looks the file up
  // once and keeps it.
  const file = join(mkdtempSync(join(tmpdir(), "sluiceway-summary-")), "summary.md");

  test("the summary goes to the file the runner names", async () => {
    writeFileSync(file, "");
    process.env.GITHUB_STEP_SUMMARY = file;
    await actionsLog().writeSummary("## Sluiceway scan\n");
    expect(readFileSync(file, "utf8")).toBe("## Sluiceway scan\n");
  });

  test("a second summary takes the place of the first, because it holds everything the first did", async () => {
    writeFileSync(file, "");
    process.env.GITHUB_STEP_SUMMARY = file;
    const log = actionsLog();
    await log.writeSummary("## Sluiceway scan\n\none stack\n");
    await log.writeSummary("## Sluiceway scan\n\ntwo stacks\n");
    expect(readFileSync(file, "utf8")).toBe("## Sluiceway scan\n\ntwo stacks\n");
  });
});
