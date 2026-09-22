import { z } from "zod";

// The named options of a Kubernetes manifests stack (records 0060 and 0070).
// Each is passed the same way to the preview, the tool diff, the drift check
// and the deploy, so all of them reach the same cluster and namespace and meet
// the same conflicts. The kubeconfig itself comes from the environment, as
// everything else a tool needs (record 0013).
const text = z.string().min(1);

// A Kubernetes namespace is a DNS label, the rule the Helm adapter holds a
// namespace to as well. It also keeps a name from reading as a flag.
const NAMESPACE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const NAMESPACE_PROBLEM =
  'expected a namespace of lower case letters, digits and "-", that starts and ends with a letter or a digit, at most 63 characters.';

// The API server takes a field manager of at most 128 printable characters.
// These are fewer, so a name never reads as a flag and needs no quoting.
const FIELD_MANAGER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FIELD_MANAGER_PROBLEM =
  'expected a field manager of letters, digits, ".", "_" and "-", that starts with a letter or a digit, at most 128 characters.';

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
  recursive: z
    .boolean()
    .describe(
      "Read the manifests of every subdirectory too, as kubectl apply -R does. Only for a directory of manifests. Default false: one level.",
    )
    .exactOptional(),
  prune: z
    .boolean()
    .describe(
      "Delete an object taken out of the manifests when the stack deploys, and show it as a delete on the row. Sluiceway keeps the list of the stack's objects in a ConfigMap next to them. Default false.",
    )
    .exactOptional(),
  forceConflicts: z
    .boolean()
    .describe(
      "Take a field that another field manager holds, with --force-conflicts on the preview and the deploy. Without it such a field fails the preview. Default false.",
    )
    .exactOptional(),
  fieldManager: text
    .max(128)
    .regex(FIELD_MANAGER)
    .describe(
      "The field manager of the preview and the deploy, passed with --field-manager. Without it, kubectl's own, kubectl.",
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

const SWITCHES = new Set(["recursive", "prune", "forceConflicts"]);

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
    const name = String(issue.path[0]);
    const where = `${at}${issue.path.map((part) => `.${String(part)}`).join("")}`;
    if (SWITCHES.has(name)) return [`${where}: expected true or false.`];
    if (issue.code === "too_small") return [`${where}: must not be empty.`];
    if (issue.code === "too_big" || issue.code === "invalid_format") {
      return [`${where}: ${name === "fieldManager" ? FIELD_MANAGER_PROBLEM : NAMESPACE_PROBLEM}`];
    }
    return [`${where}: expected text.`];
  });
  return { ok: false, problems };
}
