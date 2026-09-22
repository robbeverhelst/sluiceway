import { z } from "zod";

// The named options of an OpenTofu stack (records 0015 and 0053). Each is
// applied the same way to the scan's preview, the fresh preview of `apply`
// and, through the saved plan, the deploy.
const text = z.string().min(1);

export const openTofuOptionsSchema = z.strictObject({
  workspace: text
    .describe(
      "The workspace of the stack, selected with TF_WORKSPACE for every command. Without it, the one the environment selects, which is default.",
    )
    .exactOptional(),
  varFiles: z
    .array(text)
    .describe(
      "Var files, relative to the directory of the stack, passed with -var-file in this order to every plan.",
    )
    .default([]),
});

export type OpenTofuOptions = z.output<typeof openTofuOptionsSchema>;

// What an OpenTofu stack carries in its options bag. `tool` is how the other
// adapters' neighbours tell it apart. Only the adapters read it (record 0006).
export interface OpenTofuStackOptions extends OpenTofuOptions {
  tool: "opentofu";
}

export const OPENTOFU = "opentofu";

export function isOpenTofuOptions(options: Record<string, unknown>): boolean {
  return options.tool === OPENTOFU;
}

// Checks the options of `stacks[index]`, in words of our own, the way config
// loading words its problems.
export function parseOpenTofuOptions(
  raw: Record<string, unknown> | undefined,
  index: number,
): { ok: true; options: OpenTofuOptions } | { ok: false; problems: string[] } {
  const parsed = openTofuOptionsSchema.safeParse(raw ?? {});
  if (parsed.success) return { ok: true, options: parsed.data };
  const at = `stacks[${index}].options`;
  const known = Object.keys(openTofuOptionsSchema.shape).join(", ");
  // Unknown names first, then the values of the known ones.
  const issues = [...parsed.error.issues].sort(
    (a, b) => Number(b.code === "unrecognized_keys") - Number(a.code === "unrecognized_keys"),
  );
  const problems = issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map(
        (key) =>
          `${at}: unknown option ${JSON.stringify(key)}. Known options for opentofu: ${known}.`,
      );
    }
    const where = `${at}${issue.path.map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`)).join("")}`;
    if (issue.code === "too_small") return [`${where}: must not be empty.`];
    if (issue.path.length === 1 && issue.path[0] === "varFiles") {
      return [`${where}: expected a list of file names.`];
    }
    return [`${where}: expected text.`];
  });
  return { ok: false, problems };
}
