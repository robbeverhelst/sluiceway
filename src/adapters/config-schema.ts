import { z } from "zod";
import { configJsonSchema } from "../core/config-json-schema.ts";
import { openTofuOptionsSchema } from "./opentofu/options.ts";
import { TOOLS } from "./tools.ts";

// The JSON schema of sluiceway.yaml with what the adapters know: the tools a
// `stacks` entry may name and their options (record 0053). Only
// scripts/generate-schema.ts calls this, never the action.
export function sluicewayJsonSchema(): Record<string, unknown> {
  const { $schema: _, ...options } = z.toJSONSchema(openTofuOptionsSchema, {
    target: "draft-7",
    io: "input",
  });
  return configJsonSchema({
    tool: {
      type: "string",
      enum: [...TOOLS],
      description:
        "The tool of a stack that discovery cannot find from files alone. The entry then declares the stack at path. opentofu: a root module.",
    },
    options: {
      description: "Named adapter options of the tool. Only an entry with tool takes them.",
      ...options,
    },
  });
}
