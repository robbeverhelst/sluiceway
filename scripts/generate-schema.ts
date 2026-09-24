// Writes the JSON schemas under schema/: sluiceway.schema.json from the Zod
// schema that config loading uses, with the tools and options the adapters
// know, result-file.schema.json from the schemas the result file renderer
// checks its own output against (record 0061), and
// deployment-payload.schema.json from the schema every payload is checked
// against before it is written (record 0096). The files are committed, and
// CI fails when one is stale, the way it does for dist/. Run it with
// "bun run build:schema".
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sluicewayJsonSchema } from "../src/adapters/config-schema.ts";
import { deploymentPayloadJsonSchema } from "../src/core/deployment.ts";
import { resultFileJsonSchema } from "../src/render/result-file.ts";

const SCHEMAS: [string, Record<string, unknown>][] = [
  ["sluiceway.schema.json", sluicewayJsonSchema()],
  ["result-file.schema.json", resultFileJsonSchema()],
  ["deployment-payload.schema.json", deploymentPayloadJsonSchema()],
];

for (const [name, schema] of SCHEMAS) {
  const file = resolve(import.meta.dir, "../schema", name);
  writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`);
  console.log(`Wrote ${file}`);
}
