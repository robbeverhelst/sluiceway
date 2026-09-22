import { createHash } from "node:crypto";
import { parseAllDocuments } from "yaml";

// The inventory of a stack with pruning (record 0070): one ConfigMap, next to
// the stack's objects, that lists what the stack deployed. kubectl's own
// pruning cannot do this job: `kubectl apply --prune` refuses objects that a
// server-side apply made, `kubectl diff --prune` only finds objects with the
// annotation of a client-side apply, and the ApplySet that would do it is
// still alpha in v1.37.0. So the rendered set carries the inventory as one
// more object, the preview reads the live one first, and whatever it lists
// that the manifests no longer hold is a delete on the row and in the deploy.
//
// An object is listed by its API version, kind, namespace as the manifest
// writes it (none when it writes none) and name. Never a value: the list is
// what a row may show anyway (record 0021).

export interface ListedObject {
  apiVersion: string;
  kind: string;
  namespace?: string;
  name: string;
}

// A ConfigMap name is a DNS subdomain and a stack id is not, so the name is a
// digest. The repository is in it too, so two repos with a stack of the same
// id in one namespace never share an inventory. The annotation says which
// stack it is, for a person reading the cluster.
export function inventoryName(stackId: string, repository = ""): string {
  const digest = createHash("sha256").update(`${repository}\n${stackId}`, "utf8").digest("hex");
  return `sluiceway-${digest.slice(0, 16)}`;
}

// The objects of a rendered set, in its order, each once. The items of a List
// are objects of their own, as kubectl reads them. A document that names no
// object is left out: kubectl refuses it before anything is deployed.
export function objectsOf(text: string): ListedObject[] {
  const objects: ListedObject[] = [];
  for (const document of parseAllDocuments(text)) {
    if ("errors" in document && document.errors.length > 0) continue;
    const node: unknown = document.toJS();
    const items = isObject(node) && node.kind === "List" && Array.isArray(node.items);
    for (const item of items ? (node.items as unknown[]) : [node]) {
      const object = listed(item);
      if (object !== undefined && !objects.some((known) => sameObject(known, object))) {
        objects.push(object);
      }
    }
  }
  return objects;
}

function listed(node: unknown): ListedObject | undefined {
  if (!isObject(node) || !isObject(node.metadata)) return undefined;
  const { apiVersion, kind } = node;
  const { name, namespace } = node.metadata;
  if (typeof apiVersion !== "string" || typeof kind !== "string") return undefined;
  if (typeof name !== "string" || name === "") return undefined;
  return {
    apiVersion,
    kind,
    ...(typeof namespace === "string" && namespace !== "" ? { namespace } : {}),
    name,
  };
}

// The inventory as one more document of the rendered set. It names no
// namespace, so it goes where an object that names none goes: the stack's
// namespace option, or the context's.
export function inventoryManifest(
  name: string,
  stackId: string,
  objects: readonly ListedObject[],
): string {
  const lines = [...new Set(objects.map((object) => JSON.stringify(listedLine(object))))].sort(
    byCodeUnit,
  );
  return [
    "apiVersion: v1",
    "kind: ConfigMap",
    "metadata:",
    `  name: ${name}`,
    "  labels:",
    "    app.kubernetes.io/managed-by: sluiceway",
    "  annotations:",
    `    sluiceway.dev/stack: ${JSON.stringify(stackId)}`,
    "data:",
    ...(lines.length === 0 ? ['  objects: ""'] : ["  objects: |", ...lines.map((l) => `    ${l}`)]),
    "",
  ].join("\n");
}

export type Read<T> = { ok: true; objects: T[] } | { ok: false; problems: string[] };

// The live inventory as `kubectl get configmap --output=json` prints it, or
// nothing at all when there is none yet. A problem names a place and what was
// expected there, never what was found.
export function readInventory(stdout: string): Read<ListedObject> {
  if (stdout.trim() === "") return { ok: true, objects: [] };
  const at = "The stack's inventory";
  let printed: unknown;
  try {
    printed = JSON.parse(stdout);
  } catch {
    return { ok: false, problems: [`${at}: expected the ConfigMap as JSON.`] };
  }
  const data = isObject(printed) && isObject(printed.data) ? printed.data : undefined;
  const text = typeof data?.objects === "string" ? data.objects : undefined;
  if (text === undefined) return { ok: false, problems: [`${at}: expected a list of objects.`] };
  const objects: ListedObject[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let object: ListedObject | undefined;
    try {
      object = listedLine(JSON.parse(line));
    } catch {
      object = undefined;
    }
    if (object === undefined) {
      return {
        ok: false,
        problems: [`${at}, at line ${index + 1}: expected an object Sluiceway listed.`],
      };
    }
    objects.push(object);
  }
  return { ok: true, objects };
}

function listedLine(node: unknown): ListedObject | undefined {
  if (!isObject(node)) return undefined;
  const { apiVersion, kind, namespace, name } = node;
  if (typeof apiVersion !== "string" || typeof kind !== "string") return undefined;
  if (typeof name !== "string" || name === "") return undefined;
  if (namespace !== undefined && typeof namespace !== "string") return undefined;
  return listed({ apiVersion, kind, metadata: { name, namespace } });
}

// One object whatever its API version: the group, the kind, the namespace as
// written and the name. A manifest that moves from one version to another is
// the same object, as on a row (record 0060).
export function sameObject(a: ListedObject, b: ListedObject): boolean {
  return (
    groupOf(a.apiVersion) === groupOf(b.apiVersion) &&
    a.kind === b.kind &&
    a.namespace === b.namespace &&
    a.name === b.name
  );
}

// Whether a listing names this object, whose namespace the cluster gave it:
// the same group, kind and name, and the same namespace when the listing
// writes one.
export function lists(listing: ListedObject, object: ListedObject): boolean {
  return (
    groupOf(listing.apiVersion) === groupOf(object.apiVersion) &&
    listing.kind === object.kind &&
    listing.name === object.name &&
    (listing.namespace === undefined || listing.namespace === object.namespace)
  );
}

// What the inventory lists and the set does not.
export function pruneCandidates(
  inventory: readonly ListedObject[],
  set: readonly ListedObject[],
): ListedObject[] {
  return inventory.filter((object) => !set.some((kept) => sameObject(kept, object)));
}

// A file that names objects and says nothing else about them, for kubectl to
// find or delete them by. Every word is quoted: the inventory is an object in
// the cluster, and a word from it never becomes YAML of its own.
export function stubs(objects: readonly ListedObject[]): string {
  return objects
    .map((object) =>
      [
        `apiVersion: ${JSON.stringify(object.apiVersion)}`,
        `kind: ${JSON.stringify(object.kind)}`,
        "metadata:",
        `  name: ${JSON.stringify(object.name)}`,
        ...(object.namespace === undefined
          ? []
          : [`  namespace: ${JSON.stringify(object.namespace)}`]),
        "",
      ].join("\n"),
    )
    .join("---\n");
}

// The live objects as `kubectl get --output=json` prints them: one object, a
// List of several, or nothing when none of them is there. They hold values,
// so they never leave the adapter (record 0021).
export function readLive(stdout: string): Read<Record<string, unknown>> {
  if (stdout.trim() === "") return { ok: true, objects: [] };
  let printed: unknown;
  try {
    printed = JSON.parse(stdout);
  } catch {
    printed = undefined;
  }
  if (!isObject(printed)) {
    return {
      ok: false,
      problems: ["The live objects: expected one object or a List, as JSON."],
    };
  }
  if (printed.kind !== "List") return { ok: true, objects: [printed] };
  const items = Array.isArray(printed.items) ? printed.items : [];
  return { ok: true, objects: items.filter(isObject) };
}

// Whether the stack's field manager applied the object: its managed fields
// hold an Apply by that manager. Pruning deletes nothing else, so an object
// that another stack or tool took over stays.
export function appliedBy(object: Record<string, unknown>, manager: string): boolean {
  const metadata = isObject(object.metadata) ? object.metadata : {};
  const entries = Array.isArray(metadata.managedFields) ? metadata.managedFields : [];
  return entries.some(
    (entry) => isObject(entry) && entry.manager === manager && entry.operation === "Apply",
  );
}

// The API group of an API version: "" for the core group.
export function groupOf(apiVersion: string): string {
  const slash = apiVersion.indexOf("/");
  return slash < 0 ? "" : apiVersion.slice(0, slash);
}

function isObject(node: unknown): node is Record<string, unknown> {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The rendered set of a stack with pruning: its manifests, then its inventory,
// which lists every object of the manifests and the ones still to be pruned.
// Those stay listed until a preview no longer finds them, so a deploy whose
// pruning failed half way prunes the rest next time.
export function withInventory(
  text: string,
  name: string,
  stackId: string,
  pruned: readonly ListedObject[],
): string {
  const manifests = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return `${manifests}---\n${inventoryManifest(name, stackId, [...objectsOf(text), ...pruned])}`;
}
