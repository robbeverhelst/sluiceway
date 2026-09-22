import { z } from "zod";

// The named options of a Helm stack (records 0015 and 0058). Each is applied
// the same way to the scan's preview, the fresh preview of `apply`, the render
// the deploy is held to, and the deploy.
const text = z.string().min(1);

// Helm's own rule for a release name, which also keeps a name from reading as
// a flag on the command line.
const RELEASE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
// A Kubernetes namespace is a DNS label.
const NAMESPACE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
// A local chart is a path that says so. Anything else is a chart reference:
// repo/name from a repository the workflow added, or a URL.
export const LOCAL_CHART = /^\.\.?(\/|$)/;
const REFERENCE = /^(oci:\/\/|https?:\/\/)[^\s]+$|^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;
// An exact version, never a range: the deploy installs the chart the preview
// saw.
const EXACT = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

export const helmOptionsSchema = z.strictObject({
  release: text
    .max(53)
    .regex(RELEASE)
    .describe("The name of the Helm release. Helm's rule: lower case letters, digits, - and ."),
  namespace: text
    .max(63)
    .regex(NAMESPACE)
    .describe("The namespace of the release, passed with --namespace to every command."),
  chart: text
    .regex(new RegExp(`${LOCAL_CHART.source}|${REFERENCE.source}`))
    .describe(
      'The chart: a path relative to the directory of the stack that starts with "./" or "../", or a chart reference such as repo/name or oci://registry/name.',
    ),
  version: text
    .regex(EXACT)
    .describe("The exact version of a chart reference. A local chart takes none.")
    .exactOptional(),
  valuesFiles: z
    .array(text)
    .describe(
      "Values files, relative to the directory of the stack, passed with --values in this order to every command.",
    )
    .default([]),
});

export type HelmOptions = z.output<typeof helmOptionsSchema>;

// What a Helm stack carries in its options bag. `tool` is how the other
// adapters' neighbours tell it apart. Discovery adds where a local chart
// lives and whether it has dependencies to build. Only the adapters read it
// (record 0006).
export interface HelmStackOptions extends HelmOptions {
  tool: "helm";
  // The directory of a local chart, relative to the repo root.
  chartDir?: string;
  dependencies: boolean;
}

export const HELM = "helm";

export function isHelmOptions(options: Record<string, unknown>): boolean {
  return options.tool === HELM;
}

const PATTERN_PROBLEMS: Record<string, string> = {
  release:
    'expected a release name of lower case letters, digits, "-" and ".", that starts and ends with a letter or a digit, at most 53 characters.',
  namespace:
    'expected a namespace of lower case letters, digits and "-", that starts and ends with a letter or a digit, at most 63 characters.',
  chart:
    'expected a local chart as a path that starts with "./" or "../", or a chart reference such as repo/name or oci://registry/name.',
  version: "expected an exact chart version, such as 1.2.3.",
};

// Checks the options of `stacks[index]`, in words of our own, the way config
// loading words its problems.
export function parseHelmOptions(
  raw: Record<string, unknown> | undefined,
  index: number,
): { ok: true; options: HelmOptions } | { ok: false; problems: string[] } {
  const at = `stacks[${index}].options`;
  const parsed = helmOptionsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const known = Object.keys(helmOptionsSchema.shape).join(", ");
    // Unknown names first, then the values of the known ones in their order.
    const order = Object.keys(helmOptionsSchema.shape);
    const rank = (issue: z.core.$ZodIssue) =>
      issue.code === "unrecognized_keys" ? -1 : order.indexOf(String(issue.path[0]));
    const issues = [...parsed.error.issues].sort((a, b) => rank(a) - rank(b));
    const problems = issues.flatMap((issue) => {
      if (issue.code === "unrecognized_keys") {
        return issue.keys.map(
          (key) =>
            `${at}: unknown option ${JSON.stringify(key)}. Known options for helm: ${known}.`,
        );
      }
      const [name] = issue.path;
      const where = `${at}${issue.path.map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`)).join("")}`;
      if (issue.code === "invalid_type" && issue.input === undefined) {
        return [`${where}: required for tool: helm.`];
      }
      if (issue.code === "too_small") return [`${where}: must not be empty.`];
      if (issue.path.length === 1 && name === "valuesFiles") {
        return [`${where}: expected a list of file names.`];
      }
      if (issue.code === "invalid_type") return [`${where}: expected text.`];
      return [`${where}: ${PATTERN_PROBLEMS[String(name)] ?? "expected something else."}`];
    });
    // One problem per option is enough.
    return { ok: false, problems: [...new Set(problems)] };
  }

  const options = parsed.data;
  const local = LOCAL_CHART.test(options.chart);
  if (local && options.version !== undefined) {
    return {
      ok: false,
      problems: [
        `${at}.version: only a chart reference takes a version. A local chart is used as the repo holds it.`,
      ],
    };
  }
  if (!local && options.version === undefined) {
    return {
      ok: false,
      problems: [
        `${at}.version: required for a chart reference, so that the deploy installs the chart the preview saw.`,
      ],
    };
  }
  return { ok: true, options };
}
