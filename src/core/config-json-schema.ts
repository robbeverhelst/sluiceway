import { z } from "zod";
import { configSchema } from "./config.ts";

// What the adapters say about `stacks[].tool` and `stacks[].options`, as JSON
// schema: the tools that exist and the options each takes (record 0053), and
// the switches of `discovery` (record 0092). Core holds no tool word (record
// 0006), so they are handed in.
export interface ToolSchemas {
  tool: Record<string, unknown>;
  options: Record<string, unknown>;
  discovery: Record<string, unknown>;
}

// The JSON schema of sluiceway.yaml, for editors. It describes what a person
// may write (the input side), so keys with a default are not required. Checks
// that JSON schema cannot say, such as two entries for one stack, are left to
// the loader. Only scripts/generate-schema.ts calls this, never the action.
export function configJsonSchema(tools?: ToolSchemas): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(configSchema, { target: "draft-7", io: "input" });
  if (tools !== undefined) {
    const stacks = rest.properties?.stacks as { items: { properties: Record<string, unknown> } };
    stacks.items.properties.tool = tools.tool;
    stacks.items.properties.options = tools.options;
    (rest.properties as Record<string, unknown>).discovery = tools.discovery;
  }
  return {
    $schema,
    title: "sluiceway.yaml",
    description: "Configuration of Sluiceway. The file is optional and sits at the repo root.",
    ...rest,
  };
}
