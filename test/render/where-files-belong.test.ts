import { describe, expect, test } from "bun:test";
import { whereFilesBelong } from "../../src/render/check.ts";
import { escapeText } from "../../src/render/escape.ts";

// Issue 164: the hint under the files that no stack claims says which files
// are worth listing under scan.unrelated and which must stay off it.
describe("the hint under the files that no stack claims", () => {
  test("without a lockfile or a package manifest among them, it still says the rule", () => {
    expect(whereFilesBelong([])).toBe(
      "A file that some stacks read belongs under the inputs of those stacks in sluiceway.yaml. A file that no program reads, such as docs, can be listed under scan.unrelated. Keep lockfiles and package manifests off that list: a change to one should preview every stack.",
    );
  });

  test("names the lockfiles and package manifests it lists", () => {
    expect(whereFilesBelong(["bun.lock", "package.json"])).toBe(
      "A file that some stacks read belongs under the inputs of those stacks in sluiceway.yaml. A file that no program reads, such as docs, can be listed under scan.unrelated. Keep bun.lock and package.json off that list: they are lockfiles and package manifests, and a change to one should preview every stack.",
    );
  });

  test("names one alone", () => {
    expect(whereFilesBelong(["go.sum"])).toContain(
      "Keep go.sum off that list: it is a lockfile or a package manifest, and a change to it should preview every stack.",
    );
  });

  test("names five and counts the rest", () => {
    const shared = Array.from({ length: 7 }, (_, index) => `packages/p${index}/package.json`);
    expect(whereFilesBelong(shared)).toContain(
      "Keep packages/p0/package.json, packages/p1/package.json, packages/p2/package.json, packages/p3/package.json, packages/p4/package.json and 2 more off that list: they are lockfiles and package manifests, and a change to one should preview every stack.",
    );
  });

  test("a file name comes from outside and never brings a line break", () => {
    expect(whereFilesBelong(["a\nb/package.json"])).not.toContain("\n");
  });

  test("a summary shows the names escaped", () => {
    expect(whereFilesBelong(["a_b/package.json"], escapeText)).toContain(
      "Keep a&#95;b/package.json off",
    );
  });
});
