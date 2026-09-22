import type { HelmStackOptions } from "./options.ts";

// The command lines of the Helm adapter, checked against helm v3.18 and v4.3
// and the diff plugin's source at v3.15.13 (records 0058 and 0069). Nothing but these
// reaches the tool: there are no free-form arguments (record 0015), and the
// named options are the only things that change a command line.
//
// - Every value goes in the `--name=value` form, so nothing a repo writes can
//   read as another flag.
// - `--reset-values` on the diff and the deploy: the release gets the chart's
//   own values and the values files, and nothing it kept from an earlier
//   deploy. Without it, an upgrade with no values file reuses the old ones.
// - `--dry-run=server` on the diff and the render: templates render as the
//   deploy renders them, with `lookup` answered by the cluster.
// - `--output=structured` on the diff: the plugin's JSON with the path of
//   every changed field (its README, "Structured JSON output"). Its plain
//   `json` output names objects and no paths.
// - `--rollback-on-failure` on the deploy with Helm 4, `--atomic` with Helm 3:
//   a failed upgrade is rolled back, and it waits until the objects are
//   ready. Helm 4 renamed the flag and keeps `--atomic` as a deprecated name
//   that prints a warning. Helm 3, up to v3.22, knows only `--atomic`.
// - `--hide-notes` on the deploy: a chart's NOTES.txt may print a value.
// - `--three-way-merge --no-hooks` on the drift check: the plugin compares
//   the chart with the live objects, and leaves out hooks, which every deploy
//   makes anew and which a hook that deletes itself leaves no object of.

export const HELM = "helm";

function release(options: HelmStackOptions): string[] {
  return [
    options.release,
    options.chart,
    `--namespace=${options.namespace}`,
    ...(options.version === undefined ? [] : [`--version=${options.version}`]),
  ];
}

function values(options: HelmStackOptions): string[] {
  return options.valuesFiles.map((file) => `--values=${file}`);
}

export function diffCommand(options: HelmStackOptions): string[] {
  return [
    HELM,
    "diff",
    "upgrade",
    ...release(options),
    "--install",
    "--reset-values",
    "--dry-run=server",
    "--output=structured",
    "--no-color",
    ...values(options),
  ];
}

// What the deploy would install, rendered without installing it: the
// manifests a deploy is held to (record 0058).
export function renderCommand(options: HelmStackOptions): string[] {
  return [HELM, "template", ...release(options), "--dry-run=server", ...values(options)];
}

// The drift check's second diff (record 0069): the plugin merges the chart
// into each live object the way a deploy does, and diffs the live object
// against that.
export function threeWayDiffCommand(options: HelmStackOptions): string[] {
  return [
    HELM,
    "diff",
    "upgrade",
    ...release(options),
    "--install",
    "--reset-values",
    "--dry-run=server",
    "--three-way-merge",
    "--no-hooks",
    "--output=structured",
    "--no-color",
    ...values(options),
  ];
}

// What a deploy's command line depends on besides the options (record 0069).
export interface DeployFlags {
  // The major version of helm.
  major: number;
  // Only when the deploy puts drift back on a release that Helm 4 applies
  // server-side: a field another manager changed is then taken back.
  forceConflicts: boolean;
}

export function deployCommand(options: HelmStackOptions, flags: DeployFlags): string[] {
  return [
    HELM,
    "upgrade",
    ...release(options),
    "--install",
    "--reset-values",
    flags.major >= 4 ? "--rollback-on-failure" : "--atomic",
    ...(flags.forceConflicts ? ["--force-conflicts"] : []),
    ...(options.createNamespace ? ["--create-namespace"] : []),
    "--hide-notes",
    ...values(options),
  ];
}

// How the release is applied, client-side or server-side, which Helm 4 keeps
// with the release. It prints the release's name, chart, versions and status,
// and no value.
export function metadataCommand(options: HelmStackOptions): string[] {
  return [
    HELM,
    "get",
    "metadata",
    options.release,
    `--namespace=${options.namespace}`,
    "--output=json",
  ];
}

// The tool's own diff (record 0048): the same diff as the preview, as the
// plugin prints it for a person. It redacts a Secret's data unless asked not
// to, and prints every other value as it is.
export function toolDiffCommand(options: HelmStackOptions): string[] {
  return [
    HELM,
    "diff",
    "upgrade",
    ...release(options),
    "--install",
    "--reset-values",
    "--dry-run=server",
    "--output=diff",
    "--no-color",
    ...values(options),
  ];
}

export function dependencyCommand(): string[] {
  return [HELM, "dependency", "build", "."];
}

export function versionCommand(): string[] {
  return [HELM, "version", "--template={{.Version}}"];
}

export function pluginVersionCommand(): string[] {
  return [HELM, "diff", "version"];
}
