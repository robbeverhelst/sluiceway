import { globMatcher } from "./glob.ts";
import { type Stack, stackId } from "./stack.ts";

// The stacks of a repo could not be worked out. It holds every problem found,
// not only the first, so a person fixes the repo in one go.
export class DiscoveryError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      [
        "Could not work out the stacks of this repo:",
        ...problems.map((problem) => `- ${problem}`),
      ].join("\n"),
    );
    this.name = "DiscoveryError";
    this.problems = problems;
  }
}

// The stacks that exist for Sluiceway, out of the ones an adapter found. An
// ignored stack has no row, is never previewed and claims nothing (record
// 0010), so it is dropped here, before anything else sees it.
export function knownStacks(found: Stack[], ignore: string[]): Stack[] {
  const ignored = globMatcher(ignore);
  const known = found.filter((stack) => !ignored(stackId(stack)));

  // The id is fixed on the row, the deployment records and the concurrency
  // group, so two stacks can never share one (record 0006).
  const byId = Map.groupBy(known, stackId);
  const problems = [...byId].flatMap(([id, sharing]) =>
    sharing.length < 2
      ? []
      : [
          `two stacks have the id ${JSON.stringify(id)}: ${sharing.map(describe).join(", and ")}. A stack id has to name one stack. Rename or move one of them.`,
        ],
  );
  if (problems.length > 0) throw new DiscoveryError(problems);
  return known;
}

// Each side names its tool, because a Pulumi stack and a declared stack with
// the same path and name read the same otherwise (issue 168). A stack
// without a tool in its options is a Pulumi stack, found from its files.
function describe(stack: Stack): string {
  const path = JSON.stringify(stack.path);
  const where =
    stack.name === undefined ? `in ${path}` : `${JSON.stringify(stack.name)} in ${path}`;
  const { tool } = stack.options;
  return typeof tool === "string"
    ? `the stack ${where} that a stacks entry declares with tool: ${tool}`
    : `the Pulumi stack ${where}`;
}
