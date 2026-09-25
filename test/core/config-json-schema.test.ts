import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sluicewayJsonSchema } from "../../src/adapters/config-schema.ts";

type Json = { [key: string]: Json } & { properties?: Record<string, Json>; items?: Json };

const schema = sluicewayJsonSchema() as Json;

// Every object schema in the document, with the path that leads to it.
function objects(node: Json, path = "root"): [string, Json][] {
  if (typeof node !== "object" || node === null) return [];
  const here: [string, Json][] = (node.type as unknown) === "object" ? [[path, node]] : [];
  const children = Object.entries(node).flatMap(([key, child]) => objects(child, `${path}.${key}`));
  return [...here, ...children];
}

describe("the JSON schema of sluiceway.yaml", () => {
  test("is draft-07, which editors and SchemaStore read", () => {
    expect(schema.$schema as unknown).toBe("http://json-schema.org/draft-07/schema#");
  });

  test("holds the keys of build-plan.md, section 3, and no others", () => {
    expect(Object.keys(schema.properties ?? {})).toEqual([
      "dashboard",
      "tickers",
      "deploys",
      "recordWriters",
      "deployWindows",
      "freezes",
      "ignore",
      "scan",
      "drift",
      "valueFingerprint",
      "policies",
      "cost",
      "attribution",
      "phases",
      "stacks",
      "discovery",
      "mergeAndDeploy",
      "notify",
    ]);
    // The switches come from the adapters (record 0092).
    expect(Object.keys(schema.properties?.discovery?.properties ?? {})).toEqual(["rootModules"]);
    expect(Object.keys(schema.properties?.dashboard?.properties ?? {})).toEqual([
      "title",
      "label",
      "pin",
      "redact",
      "personality",
      "readOnly",
      "showValues",
      "recentlyDeployed",
      "timeZone",
      "sections",
      "deployingSection",
      "driftedSection",
      "inSyncSection",
      "zeroCounts",
      "destroyAlert",
      "pendingDetail",
      "deployAll",
      "repairAll",
      "rescanBox",
      "footer",
    ]);
    expect(Object.keys(schema.properties?.attribution?.properties ?? {})).toEqual([
      "lookback",
      "names",
    ]);
    expect(Object.keys(schema.properties?.scan?.properties ?? {})).toEqual([
      "unrelated",
      "logDiff",
    ]);
    expect(Object.keys(schema.properties?.stacks?.items?.properties ?? {})).toEqual([
      "path",
      "name",
      "tool",
      "id",
      "environment",
      "tickers",
      "inputs",
      "previewTimeout",
      "dependsOn",
      "phase",
      "deploy",
      "deployWindows",
      "drift",
      "valueFingerprint",
      "envFile",
      "policies",
      "createInBackend",
      "cost",
      "options",
    ]);
  });

  test("closes every object, so an editor flags a typo the way the loader does", () => {
    const found = objects(schema);
    expect(found.map(([path]) => path)).toEqual([
      "root",
      "root.properties.dashboard",
      "root.properties.deployWindows.items",
      "root.properties.freezes.items",
      "root.properties.ignore.items.anyOf.1",
      "root.properties.scan",
      "root.properties.drift",
      "root.properties.cost",
      "root.properties.attribution",
      "root.properties.stacks.items",
      "root.properties.stacks.items.properties.phase.anyOf.1",
      "root.properties.stacks.items.properties.deployWindows.items",
      "root.properties.stacks.items.properties.drift",
      "root.properties.stacks.items.properties.cost",
      "root.properties.stacks.items.properties.options",
      "root.properties.discovery",
      "root.properties.mergeAndDeploy",
      "root.properties.notify",
    ]);
    for (const [, object] of found) {
      expect(object.additionalProperties as unknown).toBe(false);
    }
  });

  test("asks for nothing but the path of a stacks entry", () => {
    expect(schema.required as unknown).toBeUndefined();
    expect(schema.properties?.stacks?.items?.required as unknown).toEqual(["path"]);
  });

  test("the committed file is what the generator writes now", () => {
    const file = resolve(import.meta.dir, "../../schema/sluiceway.schema.json");
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(sluicewayJsonSchema(), null, 2)}\n`);
  });
});
