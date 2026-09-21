import { expect, test } from "bun:test";
import { resolve } from "node:path";

// docs/notifications.md (record 0041): every recipe is a step that parses,
// and it reads only outputs that action.yml declares.

const ROOT = resolve(import.meta.dir, "..");
const doc = await Bun.file(resolve(ROOT, "docs/notifications.md")).text();
const action = Bun.YAML.parse(await Bun.file(resolve(ROOT, "action.yml")).text()) as {
  outputs: Record<string, unknown>;
};

function dedent(block: string): string {
  const lines = block.split("\n").filter((line) => line.trim() !== "");
  const indent = Math.min(...lines.map((line) => line.length - line.trimStart().length));
  return block
    .split("\n")
    .map((line) => line.slice(indent))
    .join("\n");
}

const blocks = [...doc.matchAll(/```yaml\n([\s\S]*?)```/g)].map((match) => dedent(match[1] ?? ""));

test("the doc has the step with an id and the four recipes", () => {
  expect(blocks).toHaveLength(5);
});

test("every recipe is a step list that parses", () => {
  for (const block of blocks) {
    const steps = Bun.YAML.parse(block) as unknown[];
    expect(Array.isArray(steps)).toBe(true);
    expect(steps).toHaveLength(1);
  }
});

test("every output a recipe reads is declared in action.yml", () => {
  const read = new Set(
    [...doc.matchAll(/steps\.sluiceway\.outputs(?:\.([a-z]+)|\['([a-z-]+)'\])/g)].map(
      (match) => match[1] ?? match[2] ?? "",
    ),
  );
  expect(read.size).toBeGreaterThan(0);
  for (const name of read) expect(Object.keys(action.outputs)).toContain(name);
});

test("a hyphenated output is always read with brackets", () => {
  expect(doc).not.toMatch(/steps\.sluiceway\.outputs\.[a-z]+-/);
});
