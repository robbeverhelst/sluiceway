import { type Claimant, claim } from "./claim.ts";
import { type Comparison, changedPaths } from "./scan-plan.ts";

// Record 0111: `apply` previews the commit its run checked out, and a push to
// the branch after that never reaches the fresh preview. So before the
// preview it compares that commit with the head of the branch, and a newer
// commit that a scan of the head would preview this stack for is a change
// that moved since the tick. The claim rule decides, exactly as it decides
// for a narrowed scan (record 0010): a file the stack claims, or a file no
// stack claims, which makes that scan a full one.

export type MovedWhy =
  | { kind: "claims"; files: string[] }
  | { kind: "unclaimed"; files: string[] }
  // The branch is not a straight line on from the commit, as after a force
  // push or a reset. What the branch holds is not what was previewed.
  | { kind: "not-a-straight-line"; status: string }
  // The comparison lists the most files GitHub gives, so it cannot be read
  // whole. A refusal is the safe direction.
  | { kind: "file-cap" };

export type SinceCheckout = { kind: "still" } | { kind: "moved"; why: MovedWhy };

export function movedSinceCheckout({
  comparison,
  stack,
  stacks,
  unrelated,
}: {
  // From the checked-out commit to the head of the branch.
  comparison: Comparison;
  stack: string;
  stacks: Claimant[];
  unrelated: string[];
}): SinceCheckout {
  const changed = changedPaths(comparison);
  if (changed.kind === "not-a-straight-line" || changed.kind === "file-cap") {
    return { kind: "moved", why: changed };
  }
  if (changed.kind !== "changed") return { kind: "moved", why: { kind: "file-cap" } };
  const { claims, unclaimed } = claim(stacks, changed.paths, unrelated);
  const files = claims.get(stack);
  if (files) return { kind: "moved", why: { kind: "claims", files } };
  if (unclaimed.length > 0) return { kind: "moved", why: { kind: "unclaimed", files: unclaimed } };
  return { kind: "still" };
}

// The name the comparison takes for the ref the workflow runs on, which
// GitHub writes as `refs/heads/main`: the branch or tag by its short name.
export function comparedRef(ref: string): string {
  return ref.replace(/^refs\/(heads|tags)\//, "");
}
