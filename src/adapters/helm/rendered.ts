import { createHash } from "node:crypto";
import type { SavedPlan } from "../adapter.ts";

// Helm saves no plan. What stands in for one is the set of manifests the
// fresh preview of `apply` rendered, kept as a digest in memory: the deploy
// renders again right before it starts and goes out only when the two are
// the same (record 0058). The rendered manifests hold every value in plain
// text (record 0021), so they are never kept, written or printed, and the
// digest never leaves this object.
export class RenderedManifests implements SavedPlan {
  readonly stackId: string;
  private readonly digest: string;

  constructor(stackId: string, manifests: string) {
    this.stackId = stackId;
    this.digest = digestOf(manifests);
  }

  matches(manifests: string): boolean {
    return digestOf(manifests) === this.digest;
  }

  // Nothing is on disk.
  async dispose(): Promise<void> {}

  // Never the digest, wherever the object is printed.
  toJSON(): { stackId: string } {
    return { stackId: this.stackId };
  }
}

function digestOf(manifests: string): string {
  return createHash("sha256").update(manifests).digest("hex");
}
