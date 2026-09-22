import { describe, expect, test } from "bun:test";
import { parseConfig } from "../../src/core/config.ts";
import { fences, read } from "./docs.ts";

// Slice 2.10: the config reference in docs/configuration.md. It is held to the
// committed JSON schema, which CI holds to the Zod schema, so a key cannot be
// added, renamed or dropped without the reference following.

interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  default?: unknown;
}

// Every key a person can write, as the reference names it: `dashboard.title`,
// `stacks[].path`. A key that holds more keys is not listed itself, except an
// object with no keys of its own (`stacks[].options`).
function keyPaths(node: SchemaNode, prefix = ""): string[] {
  return Object.entries(node.properties ?? {}).flatMap(([name, child]) => {
    const path = `${prefix}${name}`;
    if (child.properties && Object.keys(child.properties).length > 0) {
      return keyPaths(child, `${path}.`);
    }
    if (child.type === "array" && child.items?.properties) {
      return keyPaths(child.items, `${path}[].`);
    }
    return [path];
  });
}

const schema = JSON.parse(read("schema/sluiceway.schema.json")) as SchemaNode;
const reference = read("docs/configuration.md");
// The reference gives each key a heading of its own: ### `dashboard.title`
const documented = [...reference.matchAll(/^### `([^`]+)`$/gm)].map((match) => match[1]);

describe("docs/configuration.md", () => {
  test("has a heading for every key of the schema, and for nothing else", () => {
    expect([...documented].sort()).toEqual(keyPaths(schema).sort());
  });

  test("lists the keys in the order of the schema", () => {
    expect(documented).toEqual(keyPaths(schema));
  });

  test("gives each key its default as the schema has it", () => {
    const sections = reference.split(/^### /m).slice(1);
    const missing = sections.flatMap((section) => {
      const key = section.match(/^`([^`]+)`/)?.[1] ?? "";
      const node = key
        .replace(/\[\]/g, ".[]")
        .split(".")
        .reduce<SchemaNode | undefined>(
          (at, part) => (part === "[]" ? at?.items : at?.properties?.[part]),
          schema,
        );
      if (node?.default === undefined) return [];
      const shown = `Default: \`${typeof node.default === "string" ? node.default : JSON.stringify(node.default)}\``;
      return section.includes(shown) ? [] : [`${key}: ${shown}`];
    });
    expect(missing).toEqual([]);
  });

  // Every example is a real file a person could paste. A block that shows a
  // mistake starts with "# Not valid" and has to fail.
  test("every YAML example loads, and every example of a mistake fails", () => {
    const examples = fences(reference).filter((fence) => fence.language === "yaml");
    expect(examples.length).toBeGreaterThan(3);
    for (const example of examples) {
      if (example.text.startsWith("# Not valid")) {
        expect(() => parseConfig(example.text)).toThrow("sluiceway.yaml is not valid:");
      } else {
        expect(() => parseConfig(example.text)).not.toThrow();
      }
    }
  });

  // Every error message the reference quotes is one the loader really gives.
  test("quotes only messages the loader gives", () => {
    const all = fences(reference);
    const quoted = all.flatMap((fence, index) => (fence.language === "text" ? [index] : []));
    expect(quoted.length).toBeGreaterThan(2);
    for (const index of quoted) {
      const example = all[index - 1];
      expect(example?.text.startsWith("# Not valid")).toBe(true);
      expect(() => parseConfig(example?.text)).toThrow(all[index]?.text.trimEnd());
    }
  });
});

describe("the README", () => {
  test("links to the config reference", () => {
    expect(read("README.md").includes("(docs/configuration.md)")).toBe(true);
  });

  // The YAML blocks that are not a workflow or a part of one are sluiceway.yaml.
  // The setup's file and, since slice 2.17, the read-only trial's. A list is a
  // workflow step, such as the pinned step of "Pin a commit".
  test("shows sluiceway.yaml files that all load", () => {
    const configs = fences(read("README.md"))
      .filter((fence) => fence.language === "yaml")
      .filter((fence) => {
        const parsed = Bun.YAML.parse(fence.text) as Record<string, unknown>;
        if (Array.isArray(parsed)) return false;
        // Jobs of a workflow, such as the ones merge and deploy changes, are
        // a part of one too.
        const job = Object.values(parsed).some(
          (value) =>
            typeof value === "object" &&
            value !== null &&
            ["permissions", "needs", "outputs"].some((key) => key in value),
        );
        return !job && !["jobs", "on", "environment"].some((key) => key in parsed);
      });
    expect(configs.length).toBe(2);
    for (const config of configs) expect(() => parseConfig(config.text)).not.toThrow();
  });
});
