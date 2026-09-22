import { describe, expect, test } from "bun:test";
import { heldByOthers, ownedPaths } from "../../../src/adapters/kubectl/ownership.ts";

// Who holds a field (record 0070): the managed fields the API server keeps on
// every object, read as the property paths a row writes (record 0046). The
// drift check uses them to tell a change made outside the code from one the
// code makes.

const live = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: {
    name: "web",
    labels: { "app.kubernetes.io/name": "web" },
  },
  spec: {
    replicas: 3,
    selector: { matchLabels: { app: "web" } },
    template: {
      spec: {
        containers: [
          { name: "sidecar", image: "proxy:1" },
          { name: "web", image: "pause:3.10", args: ["--a", "--b"] },
        ],
      },
    },
  },
};

describe("the paths a field set holds", () => {
  test("fields, list items by key, by value and by index, and a whole subtree", () => {
    const fields = {
      "f:metadata": { "f:labels": { ".": {}, "f:app.kubernetes.io/name": {} } },
      "f:spec": {
        "f:selector": {},
        "f:template": {
          "f:spec": {
            "f:containers": {
              'k:{"name":"web"}': {
                ".": {},
                "f:image": {},
                "f:args": { 'v:"--b"': {} },
              },
              "i:0": { "f:image": {} },
            },
          },
        },
      },
    };
    expect(ownedPaths(live, fields)).toEqual([
      "metadata.labels",
      'metadata.labels["app.kubernetes.io/name"]',
      "spec.selector",
      "spec.template.spec.containers[1]",
      "spec.template.spec.containers[1].image",
      "spec.template.spec.containers[1].args[1]",
      "spec.template.spec.containers[0].image",
    ]);
  });

  test("an item the object no longer holds is no path", () => {
    expect(
      ownedPaths(live, {
        "f:spec": { "f:template": { "f:spec": { "f:containers": { 'k:{"name":"gone"}': {} } } } },
      }),
    ).toEqual([]);
  });
});

describe("a changed path held by another field manager", () => {
  const managed = (
    entries: { manager: string; operation: string; fieldsV1: Record<string, unknown> }[],
  ) => ({ ...live, metadata: { ...live.metadata, managedFields: entries } });

  const scaled = managed([
    {
      manager: "kubectl",
      operation: "Apply",
      fieldsV1: { "f:spec": { "f:template": { "f:spec": { "f:containers": {} } } } },
    },
    // kubectl scale is an Update by the manager called kubectl, so it is
    // another holder than the Apply of the same name.
    { manager: "kubectl", operation: "Update", fieldsV1: { "f:spec": { "f:replicas": {} } } },
  ]);

  test("is drift, and a path the stack's own apply holds is not", () => {
    expect(heldByOthers(scaled, ["spec.replicas", "spec.selector"], "kubectl")).toEqual([
      "spec.replicas",
    ]);
  });

  test("a path the stack applies itself is the code's change, whoever else holds it too", () => {
    const shared = managed([
      { manager: "kubectl", operation: "Apply", fieldsV1: { "f:spec": { "f:replicas": {} } } },
      { manager: "other", operation: "Apply", fieldsV1: { "f:spec": { "f:replicas": {} } } },
    ]);
    expect(heldByOthers(shared, ["spec.replicas"], "kubectl")).toEqual([]);
  });

  test("a path cut short, such as a Secret's data, is held when a field below it is", () => {
    const secret = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: "credentials",
        managedFields: [
          { manager: "kubectl", operation: "Apply", fieldsV1: { "f:data": { "f:user": {} } } },
          {
            manager: "kubectl-patch",
            operation: "Update",
            fieldsV1: { "f:data": { "f:password": {} } },
          },
        ],
      },
      data: { user: "dXNlcg==", password: "cGFzcw==" },
    };
    expect(heldByOthers(secret, ["data"], "kubectl")).toEqual(["data"]);
  });

  test("a field manager of the stack's own name", () => {
    const named = managed([
      {
        manager: "sluiceway-web",
        operation: "Apply",
        fieldsV1: { "f:spec": { "f:replicas": {} } },
      },
      { manager: "kubectl", operation: "Apply", fieldsV1: { "f:spec": { "f:selector": {} } } },
    ]);
    expect(heldByOthers(named, ["spec.replicas", "spec.selector"], "sluiceway-web")).toEqual([
      "spec.selector",
    ]);
  });

  test("an object without managed fields holds nothing for anyone", () => {
    expect(heldByOthers(live, ["spec.replicas"], "kubectl")).toEqual([]);
  });
});
