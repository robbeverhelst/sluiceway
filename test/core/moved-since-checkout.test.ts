import { describe, expect, test } from "bun:test";
import type { Claimant } from "../../src/core/claim.ts";
import { comparedRef, movedSinceCheckout } from "../../src/core/moved-since-checkout.ts";

function claimant(id: string, inputs: string[] = []): Claimant {
  const [path = ""] = id.split(":");
  return { id, path, inputs };
}

const WEB = claimant("apps/web:prod", ["shared/**"]);
const API = claimant("apps/api:prod");
const STACKS = [WEB, API];

function moved(status: string, paths: string[], unrelated: string[] = []) {
  return movedSinceCheckout({
    comparison: { status, files: paths.map((path) => ({ path })) },
    stack: WEB.id,
    stacks: STACKS,
    unrelated,
  });
}

describe("whether the branch moved under a stack since the commit a run checked out", () => {
  test("the same commit is still", () => {
    expect(moved("identical", [])).toEqual({ kind: "still" });
  });

  test("a newer commit that changes a file of the stack's directory moved it", () => {
    expect(moved("ahead", ["apps/web/Pulumi.yaml", "apps/api/index.ts"])).toEqual({
      kind: "moved",
      why: { kind: "claims", files: ["apps/web/Pulumi.yaml"] },
    });
  });

  test("a file the stack claims through inputs moved it", () => {
    expect(moved("ahead", ["shared/motd.txt"])).toEqual({
      kind: "moved",
      why: { kind: "claims", files: ["shared/motd.txt"] },
    });
  });

  test("a renamed file counts under its old path too", () => {
    expect(
      movedSinceCheckout({
        comparison: {
          status: "ahead",
          files: [{ path: "elsewhere/main.ts", previousPath: "apps/web/main.ts" }],
        },
        stack: WEB.id,
        stacks: STACKS,
        unrelated: [],
      }),
    ).toEqual({ kind: "moved", why: { kind: "claims", files: ["apps/web/main.ts"] } });
  });

  test("a change to another stack alone leaves it still", () => {
    expect(moved("ahead", ["apps/api/index.ts"])).toEqual({ kind: "still" });
  });

  test("a file no stack claims moved it, because a scan of that commit previews every stack", () => {
    expect(moved("ahead", ["package.json", "apps/api/index.ts"])).toEqual({
      kind: "moved",
      why: { kind: "unclaimed", files: ["package.json"] },
    });
  });

  test("a file that no program reads, or scan.unrelated names, leaves it still", () => {
    expect(moved("ahead", ["README.md", ".github/workflows/ci.yml"])).toEqual({ kind: "still" });
    expect(moved("ahead", ["apps/web/notes.txt"], ["**/*.txt"])).toEqual({ kind: "still" });
  });

  test("a branch that is not a straight line on from the commit moved it", () => {
    expect(moved("diverged", [])).toEqual({
      kind: "moved",
      why: { kind: "not-a-straight-line", status: "diverged" },
    });
    expect(moved("behind", [])).toEqual({
      kind: "moved",
      why: { kind: "not-a-straight-line", status: "behind" },
    });
  });

  test("a comparison that lists the most files GitHub gives moved it, since it cannot be read whole", () => {
    const files = Array.from({ length: 300 }, (_, index) => `apps/api/f${index}.ts`);
    expect(moved("ahead", files)).toEqual({ kind: "moved", why: { kind: "file-cap" } });
  });
});

describe("what the checkout is compared with", () => {
  test("the branch or tag the workflow runs on, by its short name", () => {
    expect(comparedRef("refs/heads/main")).toBe("main");
    expect(comparedRef("refs/heads/release/2026")).toBe("release/2026");
    expect(comparedRef("refs/tags/v1.2.3")).toBe("v1.2.3");
  });

  test("any other ref is compared as GitHub wrote it", () => {
    expect(comparedRef("main")).toBe("main");
  });
});
