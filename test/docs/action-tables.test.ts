import { describe, expect, test } from "bun:test";
import { MODES } from "../../src/mode.ts";
import { codeIn, read, tableUnder } from "./docs.ts";

// Slice 4.8: the tables of modes, inputs and outputs, and the table of outputs
// in docs/notifications.md, say what action.yml says. A reader copies an input
// name or a default from the docs, never from action.yml. Since the README
// rewrite the tables live in docs/reference.md.

interface ActionMetadata {
  inputs: Record<string, { description: string; required?: boolean; default?: string }>;
  outputs: Record<string, { description: string }>;
}

const action = Bun.YAML.parse(read("action.yml")) as ActionMetadata;
const reference = read("docs/reference.md");
const notifications = read("docs/notifications.md");

// The modes that set an output, as the first sentence of its description in
// action.yml names them.
function setBy(output: string): string[] {
  const first = action.outputs[output]?.description.split(".")[0] ?? "";
  return MODES.filter((mode) => new RegExp(`\\b${mode}\\b`).test(first));
}

describe("the reference's table of modes", () => {
  const rows = tableUnder(reference, "## Modes");

  test("names every mode once, in the order of the mode input", () => {
    expect(rows.map((row) => codeIn(row[0] ?? "")[0])).toEqual([...MODES]);
  });

  test("says how many modes there are", () => {
    const words = ["one", "two", "three", "four", "five", "six", "seven"];
    expect(reference).toContain(`One action, ${words[MODES.length - 1]} modes`);
  });

  test("names the same modes as the description of the mode input", () => {
    const described = (action.inputs.mode?.description ?? "").match(/One of: ([a-z, ]+)\./)?.[1];
    expect(described?.split(", ")).toEqual([...MODES]);
  });
});

describe("the reference's table of inputs", () => {
  const rows = tableUnder(reference, "## Inputs");
  const byName = new Map(rows.map((row) => [codeIn(row[0] ?? "")[0] ?? "", row]));

  test("names every input of action.yml, in its order, and no other", () => {
    expect([...byName.keys()]).toEqual(Object.keys(action.inputs));
  });

  test("gives the default of action.yml for every input that has a plain one", () => {
    const wrong = Object.entries(action.inputs).filter(([name, input]) => {
      const cell = byName.get(name)?.[1] ?? "";
      if (input.required) return cell !== "required";
      // Without a default: required in one mode, or none at all, as for
      // deploy-timeout (slice 5.9).
      // `concurrency` has none so the pool can follow the cores (record 0085).
      if (name === "concurrency") return cell !== "one per core, up to 8";
      if (input.default === undefined) return !cell.startsWith("required in ") && cell !== "none";
      // An expression such as `${{ github.token }}` is written out in words.
      if (input.default.startsWith("${{")) return codeIn(cell).length > 0;
      return codeIn(cell)[0] !== input.default;
    });
    expect(wrong.map(([name]) => `${name}: ${byName.get(name)?.[1]}`)).toEqual([]);
  });

  test("the mode input lists the modes", () => {
    expect(codeIn(byName.get("mode")?.[2] ?? "")).toEqual([...MODES]);
  });
});

describe("the tables of outputs", () => {
  // The reference lists the outputs that are not for notifications, and
  // docs/notifications.md every output with what it holds.
  const inReference = tableUnder(reference, "## Outputs");
  const inNotifications = tableUnder(notifications, "## What Sluiceway hands over");

  // In its own order: the one output that is not for notifications comes last.
  test("docs/notifications.md names every output of action.yml, and no other", () => {
    expect(inNotifications.map((row) => codeIn(row[0] ?? "")[0] ?? "").sort()).toEqual(
      Object.keys(action.outputs).sort(),
    );
  });

  test("every output the reference names is one of action.yml", () => {
    const names = inReference.map((row) => codeIn(row[0] ?? "")[0] ?? "");
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(Object.keys(action.outputs)).toContain(name);
  });

  test("both tables name the modes that set each output, as action.yml does", () => {
    const wrong = [
      ...inReference.map((row) => ({ where: "docs/reference.md", row })),
      ...inNotifications.map((row) => ({ where: "docs/notifications.md", row })),
    ].filter(({ row }) => {
      const name = codeIn(row[0] ?? "")[0] ?? "";
      return (
        codeIn(row[1] ?? "")
          .sort()
          .join() !== setBy(name).sort().join()
      );
    });
    expect(wrong.map(({ where, row }) => `${where}: ${row[0]} ${row[1]}`)).toEqual([]);
  });
});
