import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { bundleManifests, sourceOf } from "../../../src/adapters/kubectl/render.ts";

// The rendered set of a plain directory (record 0060): the manifests
// `kubectl apply -f <dir>` would read, one level deep, in name order, as one
// YAML stream. The preview diffs exactly this text and the deploy applies it.

function dir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "sluiceway-kubectl-set-"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

describe("the source of a stack", () => {
  test("a directory with a kustomization is rendered by kustomize", () => {
    expect(sourceOf(dir({ "kustomization.yaml": "", "a.yaml": "" }))).toBe("kustomization");
    expect(sourceOf(dir({ Kustomization: "" }))).toBe("kustomization");
  });

  test("any other directory is its manifests", () => {
    expect(sourceOf(dir({ "a.yaml": "" }))).toBe("manifests");
  });
});

describe("the bundle of a directory of manifests", () => {
  test("every manifest file, in name order, one document stream", () => {
    const bundle = bundleManifests(
      dir({
        "b.yml": "kind: B\n",
        "a.yaml": "kind: A\n",
        "c.json": '{"kind": "C"}',
        "README.md": "not a manifest\n",
        "nested/d.yaml": "kind: D\n",
      }),
    );
    expect(bundle).toBe('kind: A\n---\nkind: B\n---\n{"kind": "C"}\n');
  });

  test("a file that holds several documents is kept as it is", () => {
    expect(bundleManifests(dir({ "a.yaml": "kind: A\n---\nkind: B\n" }))).toBe(
      "kind: A\n---\nkind: B\n",
    );
  });

  test("order is by code unit, not by locale", () => {
    expect(bundleManifests(dir({ "a.yaml": "kind: a\n", "Z.yaml": "kind: Z\n" }))).toBe(
      "kind: Z\n---\nkind: a\n",
    );
  });

  test("the same directory gives the same bytes", () => {
    const files = { "a.yaml": "kind: A\n", "b.yaml": "kind: B" };
    expect(bundleManifests(dir(files))).toBe(bundleManifests(dir(files)));
  });
});
