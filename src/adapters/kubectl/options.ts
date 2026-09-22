import { z } from "zod";

// The named options of a Kubernetes manifests stack (record 0060). Each is
// passed the same way to the preview, the tool diff and the deploy, so all
// three reach the same cluster and namespace. The kubeconfig itself comes
// from the environment, as everything else a tool needs (record 0013).
const text = z.string().min(1);

// A Kubernetes namespace is a DNS label, the rule the Helm adapter holds a
// namespace to as well. It also keeps a name from reading as a flag.
const NAMESPACE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const NAMESPACE_PROBLEM =
  'expected a namespace of lower case letters, digits and "-", that starts and ends with a letter or a digit, at most 63 characters.';

export const kubectlOptionsSchema = z.strictObject({
  context: text
    .describe(
      "The kubeconfig context of the stack, passed with --context to every command. Without it, the current context of the kubeconfig.",
    )
    .exactOptional(),
  namespace: text
    .max(63)
    .regex(NAMESPACE)
    .describe(
      "The namespace of objects that name none, passed with --namespace to every command. Without it, the namespace of the context.",
    )
    .exactOptional(),
});

export type KubectlOptions = z.output<typeof kubectlOptionsSchema>;

// What a Kubernetes manifests stack carries in its options bag. `tool` is how
// the other adapters' neighbours tell it apart. Only the adapters read it
// (record 0006).
export interface KubectlStackOptions extends KubectlOptions {
  tool: "kubectl";
}

export const KUBECTL = "kubectl";

export function isKubectlOptions(options: Record<string, unknown>): boolean {
  return options.tool === KUBECTL;
}

// Checks the options of `stacks[index]`, in words of our own, the way config
// loading words its problems.
export function parseKubectlOptions(
  raw: Record<string, unknown> | undefined,
  index: number,
): { ok: true; options: KubectlOptions } | { ok: false; problems: string[] } {
  const parsed = kubectlOptionsSchema.safeParse(raw ?? {});
  if (parsed.success) return { ok: true, options: parsed.data };
  const at = `stacks[${index}].options`;
  const known = Object.keys(kubectlOptionsSchema.shape).join(", ");
  // Unknown names first, then the values of the known ones.
  const issues = [...parsed.error.issues].sort(
    (a, b) => Number(b.code === "unrecognized_keys") - Number(a.code === "unrecognized_keys"),
  );
  const problems = issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map(
        (key) =>
          `${at}: unknown option ${JSON.stringify(key)}. Known options for kubectl: ${known}.`,
      );
    }
    const where = `${at}${issue.path.map((part) => `.${String(part)}`).join("")}`;
    if (issue.code === "too_small") return [`${where}: must not be empty.`];
    if (issue.code === "too_big" || issue.code === "invalid_format") {
      return [`${where}: ${NAMESPACE_PROBLEM}`];
    }
    return [`${where}: expected text.`];
  });
  return { ok: false, problems };
}
