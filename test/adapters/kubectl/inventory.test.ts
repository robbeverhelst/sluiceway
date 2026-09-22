import { describe, expect, test } from "bun:test";
import {
  appliedBy,
  inventoryManifest,
  inventoryName,
  objectsOf,
  pruneCandidates,
  readInventory,
  readLive,
  stubs,
} from "../../../src/adapters/kubectl/inventory.ts";

// The inventory of a stack with pruning (record 0070): a ConfigMap that lists
// the objects the stack deployed, by API group, kind, namespace and name, and
// never a value.

describe("the name of the inventory", () => {
  test("is a DNS name made from the repository and the stack id", () => {
    const name = inventoryName("k8s/web:prod", "acme/shop");
    expect(name).toMatch(/^sluiceway-[0-9a-f]{16}$/);
    expect(inventoryName("k8s/web:prod", "acme/shop")).toBe(name);
  });

  test("two repositories with the same stack id get two inventories", () => {
    expect(inventoryName("web", "acme/shop")).not.toBe(inventoryName("web", "acme/blog"));
    expect(inventoryName("web", "acme/shop")).not.toBe(inventoryName("api", "acme/shop"));
  });
});

describe("the objects of a rendered set", () => {
  test("each document, the items of a List, the namespace only as written", () => {
    const text = [
      "apiVersion: apps/v1",
      "kind: Deployment",
      "metadata:",
      "  name: web",
      "spec:",
      "  replicas: 1",
      "---",
      "apiVersion: v1",
      "kind: List",
      "items:",
      "  - apiVersion: v1",
      "    kind: ConfigMap",
      "    metadata: { name: settings, namespace: shop }",
      "---",
      "# a comment only",
      "---",
      '{"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "ClusterRole", "metadata": {"name": "reader"}}',
      "",
    ].join("\n");
    expect(objectsOf(text)).toEqual([
      { apiVersion: "apps/v1", kind: "Deployment", name: "web" },
      { apiVersion: "v1", kind: "ConfigMap", namespace: "shop", name: "settings" },
      { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", name: "reader" },
    ]);
  });
});

describe("the inventory as a manifest", () => {
  test("names the stack, lists the objects in a fixed order, and holds no value", () => {
    const text = inventoryManifest("sluiceway-0123456789abcdef", "web", [
      { apiVersion: "v1", kind: "Service", name: "web" },
      { apiVersion: "apps/v1", kind: "Deployment", name: "web" },
      { apiVersion: "v1", kind: "ConfigMap", namespace: "shop", name: "a" },
    ]);
    expect(text).toBe(
      [
        "apiVersion: v1",
        "kind: ConfigMap",
        "metadata:",
        "  name: sluiceway-0123456789abcdef",
        "  labels:",
        "    app.kubernetes.io/managed-by: sluiceway",
        "  annotations:",
        '    sluiceway.dev/stack: "web"',
        "data:",
        "  objects: |",
        '    {"apiVersion":"apps/v1","kind":"Deployment","name":"web"}',
        '    {"apiVersion":"v1","kind":"ConfigMap","namespace":"shop","name":"a"}',
        '    {"apiVersion":"v1","kind":"Service","name":"web"}',
        "",
      ].join("\n"),
    );
  });

  test("reads back what it wrote, from the ConfigMap kubectl prints", () => {
    const objects = [
      { apiVersion: "apps/v1", kind: "Deployment", name: "web" },
      { apiVersion: "v1", kind: "ConfigMap", namespace: "shop", name: "a" },
    ];
    const lines = objects.map((object) => JSON.stringify(object)).join("\n");
    const printed = JSON.stringify({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: "sluiceway-0123456789abcdef" },
      data: { objects: `${lines}\n` },
    });
    expect(readInventory(printed)).toEqual({ ok: true, objects });
  });

  test("no inventory yet is an empty list", () => {
    expect(readInventory("")).toEqual({ ok: true, objects: [] });
  });

  test("anything else is output Sluiceway cannot read, and says where", () => {
    expect(readInventory("{")).toEqual({
      ok: false,
      problems: ["The stack's inventory: expected the ConfigMap as JSON."],
    });
    expect(
      readInventory(JSON.stringify({ kind: "ConfigMap", data: { objects: "not json\n" } })),
    ).toEqual({
      ok: false,
      problems: ["The stack's inventory, at line 1: expected an object Sluiceway listed."],
    });
  });
});

describe("what pruning deletes", () => {
  const deployment = { apiVersion: "apps/v1", kind: "Deployment", name: "web" };
  const settings = { apiVersion: "v1", kind: "ConfigMap", name: "settings" };

  test("the objects the inventory lists and the set does not", () => {
    expect(pruneCandidates([deployment, settings], [deployment])).toEqual([settings]);
  });

  test("a new API version of the same kind is the same object", () => {
    expect(pruneCandidates([{ ...deployment, apiVersion: "apps/v1beta2" }], [deployment])).toEqual(
      [],
    );
  });

  test("another namespace, or none written, is another object", () => {
    expect(pruneCandidates([{ ...settings, namespace: "shop" }], [settings])).toEqual([
      { ...settings, namespace: "shop" },
    ]);
  });

  test("the stubs name each object and nothing else, every word quoted", () => {
    expect(stubs([settings, { ...deployment, namespace: "shop" }])).toBe(
      [
        'apiVersion: "v1"',
        'kind: "ConfigMap"',
        "metadata:",
        '  name: "settings"',
        "---",
        'apiVersion: "apps/v1"',
        'kind: "Deployment"',
        "metadata:",
        '  name: "web"',
        '  namespace: "shop"',
        "",
      ].join("\n"),
    );
  });
});

describe("the live objects kubectl prints", () => {
  const object = (name: string) => ({ apiVersion: "v1", kind: "ConfigMap", metadata: { name } });

  test("one object, a List of several, or nothing", () => {
    expect(readLive(JSON.stringify(object("a")))).toEqual({ ok: true, objects: [object("a")] });
    expect(readLive(JSON.stringify({ kind: "List", items: [object("a"), object("b")] }))).toEqual({
      ok: true,
      objects: [object("a"), object("b")],
    });
    expect(readLive("")).toEqual({ ok: true, objects: [] });
  });

  test("anything else says where, and never what it found", () => {
    expect(readLive("[1]")).toEqual({
      ok: false,
      problems: ["The live objects: expected one object or a List, as JSON."],
    });
  });

  test("an object the stack's field manager applied, and one it did not", () => {
    const managed = (manager: string, operation: string) => ({
      ...object("a"),
      metadata: { name: "a", managedFields: [{ manager, operation }] },
    });
    expect(appliedBy(managed("kubectl", "Apply"), "kubectl")).toBe(true);
    expect(appliedBy(managed("kubectl", "Update"), "kubectl")).toBe(false);
    expect(appliedBy(managed("other-team", "Apply"), "kubectl")).toBe(false);
    expect(appliedBy(object("a"), "kubectl")).toBe(false);
  });
});
