import { z } from "zod";
import { configJsonSchema } from "../core/config-json-schema.ts";
import { TOOLS } from "./discover-all.ts";
import { helmOptionsSchema } from "./helm/options.ts";
import { kubectlOptionsSchema } from "./kubectl/options.ts";
import { openTofuOptionsSchema } from "./opentofu/options.ts";

// The JSON schema of sluiceway.yaml with what the adapters know: the tools a
// `stacks` entry may name and their options (records 0053, 0058 and 0060). Only
// scripts/generate-schema.ts calls this, never the action.
//
// The options of every tool sit in one closed object, each described with the
// tool that takes it. An editor then completes and checks every name, and the
// loader says when an option does not belong to the entry's tool. An option
// that two tools take, such as `namespace`, is one property with the rule
// both hold it to and both descriptions.
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
        "The tool of a stack that discovery cannot find from files alone. The entry then declares the stack at path. opentofu: a root module. helm: a release in a namespace. kubectl: a directory of Kubernetes manifests or a kustomization.",
    },
    options: {
      description: "Named adapter options of the tool. Only an entry with tool takes them.",
      type: "object",
      properties: merged([
        propertiesOf(openTofuOptionsSchema, "opentofu"),
        propertiesOf(helmOptionsSchema, "helm"),
        propertiesOf(kubectlOptionsSchema, "kubectl"),
      ]),
      additionalProperties: false,
    },
  });
}

// The properties of every tool, with the descriptions of a name that several
// tools take joined in the order of the tools.
function merged(
  tools: Record<string, { description?: string }>[],
): Record<string, { description?: string }> {
  const all: Record<string, { description?: string }> = {};
  for (const properties of tools) {
    for (const [name, property] of Object.entries(properties)) {
      const earlier = all[name];
      all[name] =
        earlier === undefined
          ? property
          : { ...earlier, description: `${earlier.description} ${property.description}` };
    }
  }
  return all;
}
