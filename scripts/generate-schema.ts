// Writes schema/sluiceway.schema.json from the Zod schema that config loading
// uses, with the tools and options the adapters know. The file is committed,
// and CI fails when it is stale, the way it does for dist/. Run it with "bun run build:schema".
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sluicewayJsonSchema } from "../src/adapters/config-schema.ts";

const file = resolve(import.meta.dir, "../schema/sluiceway.schema.json");
writeFileSync(file, `${JSON.stringify(sluicewayJsonSchema(), null, 2)}\n`);
console.log(`Wrote ${file}`);
