import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { parse } from "yaml";
import type { Config } from "../../core/config.ts";
import { DiscoveryError } from "../../core/discovery.ts";
import type { Stack } from "../../core/stack.ts";
import { HELM, type HelmStackOptions, LOCAL_CHART, parseHelmOptions } from "./options.ts";

// A chart can be installed as any number of releases, in any namespace, so
// files alone cannot say what a Helm stack is. A `stacks` entry with
// `tool: helm` names the release, its namespace, the chart and the values
// files, and discovery checks from the files alone that the entry can work
// (record 0058). It never starts the tool and never reaches a cluster, so
// `check`, `resolve` and `settle` hold no credentials (record 0014).

const WHAT_PATH_IS =
  "An entry with tool: helm names the directory its chart and values files are relative to.";

// The option problems are config problems and are thrown by the caller, so
// they come back here instead. What is wrong with the files is a
// DiscoveryError.
export function discoverHelm(
  root: string,
  config: Config,
): { stacks: Stack[]; optionProblems: string[] } {
  const stacks: Stack[] = [];
  const optionProblems: string[] = [];
  const problems: string[] = [];

  config.stacks.forEach((entry, index) => {
    if (entry.tool !== HELM) return;
    const parsed = parseHelmOptions(entry.options, index);
    if (!parsed.ok) {
      optionProblems.push(...parsed.problems);
      return;
    }
    const { options } = parsed;
    const dir = join(root, entry.path);
    const shown = JSON.stringify(entry.path);
    if (!isDirectory(dir)) {
      problems.push(`stacks[${index}]: ${shown} is not a directory of the repo. ${WHAT_PATH_IS}`);
      return;
    }
    const before = problems.length;
    const inRepo = (file: string): string | undefined => {
      const fromRoot = relative(root, normalize(join(dir, file)));
      if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        return undefined;
      }
      return fromRoot === "" ? "." : fromRoot.split(sep).join("/");
    };

    // A local chart is read for one thing only: whether it has dependencies,
    // which `helm dependency build` fetches before any preview.
    let chart: { chartDir: string; dependencies: boolean } | undefined;
    if (LOCAL_CHART.test(options.chart)) {
      const where = `stacks[${index}].options.chart: ${JSON.stringify(options.chart)}`;
      const chartDir = inRepo(options.chart);
      if (chartDir === undefined) {
        problems.push(`${where} must stay inside the repo.`);
      } else {
        const found = chartFile(join(root, chartDir, "Chart.yaml"));
        if (found === "missing") {
          problems.push(`${where} is not a chart in ${shown}: it holds no Chart.yaml.`);
        } else if (found === "unreadable") {
          problems.push(
            `stacks[${index}].options.chart: the Chart.yaml of ${JSON.stringify(options.chart)} could not be read as YAML.`,
          );
        } else {
          chart = { chartDir, dependencies: found.dependencies };
        }
      }
    }

    options.valuesFiles.forEach((file, at) => {
      const where = `stacks[${index}].options.valuesFiles[${at}]: ${JSON.stringify(file)}`;
      if (isAbsolute(file)) {
        problems.push(`${where} must be relative to the directory of the stack.`);
        return;
      }
      const fromRoot = inRepo(file);
      if (fromRoot === undefined) {
        problems.push(`${where} must stay inside the repo.`);
        return;
      }
      if (!isFile(join(root, fromRoot))) problems.push(`${where} is not a file in ${shown}.`);
    });
    if (problems.length > before) return;

    const bag: HelmStackOptions = {
      tool: HELM,
      ...options,
      ...(chart === undefined ? { dependencies: false } : chart),
    };
    stacks.push({
      path: entry.path,
      ...(entry.name === undefined ? {} : { name: entry.name }),
      options: { ...bag },
    });
  });

  if (optionProblems.length === 0 && problems.length > 0) throw new DiscoveryError(problems);
  return { stacks, optionProblems };
}

function chartFile(path: string): { dependencies: boolean } | "missing" | "unreadable" {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return "missing";
  }
  try {
    const chart: unknown = parse(text);
    const dependencies =
      typeof chart === "object" && chart !== null
        ? (chart as { dependencies?: unknown }).dependencies
        : undefined;
    return { dependencies: Array.isArray(dependencies) && dependencies.length > 0 };
  } catch {
    return "unreadable";
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
