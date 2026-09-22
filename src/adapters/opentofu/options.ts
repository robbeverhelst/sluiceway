import { z } from "zod";

// The named options of a stack of the Terraform family (records 0015, 0053
// and 0068). Each is applied the same way to the scan's preview, the fresh
// preview of `apply` and, through the saved plan, the deploy.
const text = z.string().min(1);

export const TERRAGRUNT = "terragrunt";
export const CDKTF = "cdktf";
export const WRAPPERS = [TERRAGRUNT, CDKTF] as const;
export type Wrapper = (typeof WRAPPERS)[number];

export const openTofuOptionsSchema = z.strictObject({
  workspace: text
    .describe(
      "The workspace of the stack, selected with TF_WORKSPACE for every command. Without it, the one the environment selects, which is default.",
    )
    .exactOptional(),
  varFiles: z
    .array(text)
    .describe(
      "Var files, relative to the directory of the stack, passed with -var-file in this order to every plan. Not with a wrapper.",
    )
    .default([]),
  wrapper: z
    .enum(WRAPPERS)
    .describe(
      "What stands in front of the tool. terragrunt: path is one Terragrunt unit, and terragrunt runs the tool there. cdktf: path is a CDK for Terraform app, cdktf synth writes its stacks, and name picks the one this entry deploys.",
    )
    .exactOptional(),
});

export type OpenTofuOptions = z.output<typeof openTofuOptionsSchema>;

export const OPENTOFU = "opentofu";
export const TERRAFORM = "terraform";
// The tools of the Terraform family: one adapter, one plan format, and a
// binary each (record 0068).
export const TERRAFORM_FAMILY = [OPENTOFU, TERRAFORM] as const;
export type FamilyTool = (typeof TERRAFORM_FAMILY)[number];

// What a stack of the family carries in its options bag. `tool` is how the
// other adapters' neighbours tell it apart, and which binary runs. Only the
// adapters read it (record 0006).
export interface OpenTofuStackOptions extends OpenTofuOptions {
  tool: FamilyTool;
}

export function isFamilyTool(tool: string | undefined): tool is FamilyTool {
  return (TERRAFORM_FAMILY as readonly (string | undefined)[]).includes(tool);
}

export function isOpenTofuOptions(options: Record<string, unknown>): boolean {
  return isFamilyTool(options.tool as string | undefined);
}

// Checks the options of `stacks[index]`, in words of our own, the way config
// loading words its problems.
export function parseOpenTofuOptions(
  raw: Record<string, unknown> | undefined,
  index: number,
  tool: FamilyTool = OPENTOFU,
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
          `${at}: unknown option ${JSON.stringify(key)}. Known options for ${tool}: ${known}.`,
      );
    }
    const where = `${at}${issue.path.map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`)).join("")}`;
    if (issue.code === "too_small") return [`${where}: must not be empty.`];
    if (issue.path.length === 1 && issue.path[0] === "varFiles") {
      return [`${where}: expected a list of file names.`];
    }
    if (issue.path.length === 1 && issue.path[0] === "wrapper") {
      return [`${where}: expected one of ${WRAPPERS.map((w) => JSON.stringify(w)).join(" or ")}.`];
    }
    return [`${where}: expected text.`];
  });
  return { ok: false, problems };
}
