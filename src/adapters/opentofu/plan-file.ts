import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SavedPlan } from "../adapter.ts";
import { PLAN_JSON } from "./cost.ts";

// A plan file holds the configuration, every variable and every value in plain
// text (record 0021). It lives in a directory of its own, which goes when the
// preview ends, or, for the plan `apply` deploys, when `apply` lets it go.
export class PlanFile implements SavedPlan {
  readonly path: string;
  readonly stackId: string;
  // The plan's directory, and the plan's JSON in it, which the cost
  // estimate writes and reads there (record 0105). Both go with the plan.
  readonly dir: string;
  readonly jsonPath: string;

  private constructor(dir: string, stackId: string) {
    this.dir = dir;
    this.path = join(dir, "tfplan");
    this.jsonPath = join(dir, PLAN_JSON);
    this.stackId = stackId;
  }

  static async create(stackId: string): Promise<PlanFile> {
    return new PlanFile(await mkdtemp(join(tmpdir(), "sluiceway-plan-")), stackId);
  }

  async dispose(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}
