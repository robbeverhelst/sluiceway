import { z } from "zod";
import { configJsonSchema } from "../core/config-json-schema.ts";
import { TOOLS } from "./discover-all.ts";
import { helmOptionsSchema } from "./helm/options.ts";
import { openTofuOptionsSchema } from "./opentofu/options.ts";

// The JSON schema of sluiceway.yaml with what the adapters know: the tools a
// `stacks` entry may name and their options (records 0053 and 0058). Only
// scripts/generate-schema.ts calls this, never the action.
//
// The options of every tool sit in one closed object, each described with the
// tool that takes it. An editor then completes and checks every name, and the
// loader says when an option does not belong to the entry's tool.
export function sluicewayJsonSchema(): Record<string, unknown> {
  const propertiesOf = (schema: z.ZodType, tool: string) => {
    const json = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as {
      properties: Record<string, { description?: string }>;
    };
    return Object.fromEntries(
      Object.entries(json.properties).map(([name, property]) => [
        name,
        { ...property, description: `${tool}: ${property.description ?? ""}` },
      ]),
    );
  };
  return configJsonSchema({
    tool: {
      type: "string",
      enum: [...TOOLS],
      description:
        "The tool of a stack that discovery cannot find from files alone. The entry then declares the stack at path. opentofu: a root module. helm: a release in a namespace.",
    },
    options: {
      description: "Named adapter options of the tool. Only an entry with tool takes them.",
      type: "object",
      properties: {
        ...propertiesOf(openTofuOptionsSchema, "opentofu"),
        ...propertiesOf(helmOptionsSchema, "helm"),
      },
      additionalProperties: false,
    },
  });
}
