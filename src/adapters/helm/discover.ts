import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, sep } from "node:path";
import { parse } from "yaml";
import type { Config } from "../../core/config.ts";
import { DiscoveryError } from "../../core/discovery.ts";
import type { Stack } from "../../core/stack.ts";
import {
  type ChartBuild,
  HELM,
  type HelmStackOptions,
  LOCAL_CHART,
  parseHelmOptions,
} from "./options.ts";

// A chart can be installed as any number of releases, in any namespace, so
// files alone cannot say what a Helm stack is. A `stacks` entry with
// `tool: helm` names the release, its namespace, the chart and the values
// files, and discovery checks from the files alone that the entry can work
// (record 0058), and follows the local charts its chart depends on (record
// 0069). It never starts the tool and never reaches a cluster, so `check`,
// `resolve` and `settle` hold no credentials (record 0014).

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

    // A local chart is read for one thing only: which charts need
    // `helm dependency build` before any preview, its own and those of the
    // local charts it depends on.
    let chart: { chartDir: string; builds: ChartBuild[] } | undefined;
    if (LOCAL_CHART.test(options.chart)) {
      const where = `stacks[${index}].options.chart: ${JSON.stringify(options.chart)}`;
      const chartDir = inRepo(options.chart);
      if (chartDir === undefined) {
        problems.push(`${where} must stay inside the repo.`);
      } else {
        const found = chartFile(root, chartDir);
        if (found === "missing") {
          problems.push(`${where} is not a chart in ${shown}: it holds no Chart.yaml.`);
        } else if (found === "unreadable") {
          problems.push(
            `stacks[${index}].options.chart: the Chart.yaml of ${JSON.stringify(options.chart)} could not be read as YAML.`,
          );
        } else {
          chart = { chartDir, builds: chartTree(root, chartDir, found) };
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
      ...(chart === undefined ? { builds: [] } : chart),
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

interface Dependency {
  name: string;
  repository: string;
}

// The dependencies a Chart.yaml lists. Only the name and the repository are
// read, and only to find the local charts among them.
function chartFile(root: string, chartDir: string): Dependency[] | "missing" | "unreadable" {
  let text: string;
  try {
    text = readFileSync(join(root, chartDir, "Chart.yaml"), "utf8");
  } catch {
    return "missing";
  }
  try {
    const chart: unknown = parse(text);
    const dependencies =
      typeof chart === "object" && chart !== null
        ? (chart as { dependencies?: unknown }).dependencies
        : undefined;
    if (!Array.isArray(dependencies)) return [];
    return dependencies.map((one: unknown) => {
      const { name, repository } = (typeof one === "object" && one !== null ? one : {}) as {
        name?: unknown;
        repository?: unknown;
      };
      return {
        name: typeof name === "string" ? name : "",
        repository: typeof repository === "string" ? repository : "",
      };
    });
  } catch {
    return "unreadable";
  }
}

const LOCAL_DEPENDENCY = "file://";

// The charts of a local chart's tree that need `helm dependency build`, lowest
// level first (record 0069). A dependency with a file:// repository is a
// local chart, which helm packages from its directory as it is: a dependency
// it lists itself is left out of the package unless it was built first, and
// helm renders the release without that subchart's objects and says nothing.
// So every chart of the tree that lists dependencies is built, before the
// charts that depend on it. A subchart kept in a chart's own charts/
// directory is used as the repo holds it and is not built, as helm's own
// `dependency build` of the chart leaves it: building it could need a
// repository that its vendored copy never needed.
//
// A file:// dependency that is not a readable chart inside the repo, or that
// closes a circle, is not followed. It stays helm's to report: the build of
// the chart that lists it fails, which is a preview failure of the stacks
// that need it (record 0058), and never stops the others.
function chartTree(root: string, top: string, topDependencies: Dependency[]): ChartBuild[] {
  const levels = new Map<string, number>();
  const builds: ChartBuild[] = [];

  const visit = (chartDir: string, dependencies: Dependency[], path: string[]): number => {
    const known = levels.get(chartDir);
    if (known !== undefined) return known;
    let level = 0;
    for (const { repository } of dependencies) {
      if (!repository.startsWith(LOCAL_DEPENDENCY)) continue;
      const target = relative(
        root,
        normalize(join(root, chartDir, repository.slice(LOCAL_DEPENDENCY.length))),
      );
      if (target === ".." || target.startsWith(`..${sep}`) || isAbsolute(target)) continue;
      const dependencyDir = target === "" ? "." : target.split(sep).join("/");
      if (path.includes(dependencyDir)) continue;
      const found = chartFile(root, dependencyDir);
      if (typeof found === "string") continue;
      level = Math.max(level, visit(dependencyDir, found, [...path, dependencyDir]) + 1);
    }
    levels.set(chartDir, level);
    if (dependencies.length > 0) builds.push({ chart: chartDir, level });
    return level;
  };

  visit(top, topDependencies, [top]);
  return builds.sort(
    (a, b) => a.level - b.level || (a.chart < b.chart ? -1 : a.chart > b.chart ? 1 : 0),
  );
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
