import { type Stack, stackId } from "../../core/stack.ts";
import type { ReadDependencies } from "../adapter.ts";
import { projectName } from "./discover.ts";

// `dependsOn: auto` (record 0059): the stacks of the repo that a program's
// stack references name. A name is `organization/project/stack`, or shorter:
// a stack alone is one of the program's own project, and two parts are
// `project/stack` as a file backend writes them, or else `organization/stack`
// of the program's own project as Pulumi Cloud reads them. The organization
// is never compared: the repo's files do not say it. A name that fits no
// stack, or more than one, is counted and waits on nothing. The stack itself
// is dropped. Only stack ids leave here.
export async function readDependencies(
  stack: Stack,
  names: readonly string[],
  root: string,
  candidates: readonly Stack[],
): Promise<ReadDependencies> {
  const self = stackId(stack);
  const projects = new Map<string, string | undefined>();
  const projectOf = async (path: string) => {
    if (!projects.has(path)) projects.set(path, await projectName(root, path));
    return projects.get(path);
  };
  const own = await projectOf(stack.path);
  const known = await Promise.all(
    candidates.map(async (one) => ({
      id: stackId(one),
      name: one.name,
      project: await projectOf(one.path),
    })),
  );
  const matching = (project: string | undefined, name: string | undefined) =>
    project === undefined || name === undefined
      ? []
      : known.filter((one) => one.project === project && one.name === name);

  const found = new Set<string>();
  let elsewhere = 0;
  for (const reference of names) {
    const parts = reference.split("/");
    const fits =
      parts.length === 3
        ? matching(parts[1], parts[2])
        : parts.length === 1
          ? matching(own, parts[0])
          : parts.length === 2
            ? orElse(matching(parts[0], parts[1]), () => matching(own, parts[1]))
            : [];
    const [one] = fits;
    if (fits.length !== 1 || one === undefined) elsewhere++;
    else if (one.id !== self) found.add(one.id);
  }
  return { stackIds: [...found].sort(byCodeUnit), elsewhere };
}

function orElse<T>(first: T[], second: () => T[]): T[] {
  return first.length > 0 ? first : second();
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
