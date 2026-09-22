import { describe, expect, test } from "bun:test";
import { EXAMPLE_WORKFLOWS, read, section, USER_DOCS } from "./docs.ts";

// After releases 0.1.0 and 0.1.1 (build plan, section 8): the docs stop saying there is
// no release, and every example says @v0 until a deliberate 1.0.0.

// Every page a user copies from or reads for the version: the user docs, the
// notifications recipes, the security policy and the example files.
const PAGES = [...USER_DOCS, "docs/notifications.md", "SECURITY.md", ...EXAMPLE_WORKFLOWS];

const readme = read("README.md");

// The words on pinning a commit, the one place a full SHA is shown on purpose.
// In docs/workflow.md since the README rewrite.
const PIN = section(read("docs/workflow.md"), "## Pin a commit");

describe("the version the docs name", () => {
  test.each(PAGES)("every use of the action is @v0: %s", (path) => {
    const text = path === "docs/workflow.md" ? read(path).replace(PIN, "") : read(path);
    const refs = [...text.matchAll(/sluiceway\/sluiceway@([^\s`"')]+)/g)].map((match) => match[1]);
    expect(refs.filter((ref) => ref !== "v0")).toEqual([]);
  });

  test("no page keeps the placeholder of 40 zeros", () => {
    const wrong = PAGES.filter((path) => read(path).includes("0".repeat(40)));
    expect(wrong).toEqual([]);
  });

  test.each(PAGES)("no page says there is no release yet: %s", (path) => {
    const text = read(path);
    const said = [
      /no release/i,
      /before the first release/i,
      /until the first release/i,
      /until 0\.1\.0/i,
      /that tag does not exist/i,
      /no tag exists/i,
      /placeholder of 40 zeros/i,
      /replace the 40 zeros/i,
    ].filter((pattern) => pattern.test(text));
    expect(said.map(String)).toEqual([]);
  });
});

describe("the README", () => {
  const notice = readme.slice(readme.indexOf("> [!IMPORTANT]"), readme.indexOf("\n\n## "));

  // Slice 4.8: the notice named 0.1.1 long after newer releases, so it names
  // the series and links to the list of releases, which never goes stale.
  test("the beta notice says beta, released as 0.x, the roadmap to 1.0, and @v0", () => {
    expect(notice).toContain("**Sluiceway is in beta.**");
    expect(notice).toContain("released as [0.x](https://github.com/sluiceway/sluiceway/releases)");
    expect(notice).not.toMatch(/releases\/tag\//);
    expect(notice).toContain("(docs/roadmap.md)");
    expect(notice).toContain("`sluiceway/sluiceway@v0`");
    expect(notice).toContain("(docs/workflow.md#pin-a-commit)");
  });

  test("Pin a commit, in docs/workflow.md, still shows how to pin a release by its full commit SHA", () => {
    expect(PIN).not.toBe("");
    expect(PIN).toMatch(/uses: sluiceway\/sluiceway@[0-9a-f]{40} # v\d+\.\d+\.\d+\n/);
    expect(PIN).toContain("(https://github.com/sluiceway/sluiceway/releases)");
  });
});
