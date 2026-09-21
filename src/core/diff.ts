// The shape of a diff, as record 0007 fixes it. No field here can hold a
// property value, and none gets added in v1 (record 0021).

// What a deploy does to the real object.
export type Op = "create" | "update" | "replace" | "delete" | "none";

// What a deploy does to the tool's record of the object.
export type Tracking = "import" | "forget" | "move";

export interface Change {
  // Opaque, defined by the adapter, unique within the diff. Core sorts, hashes
  // and compares it and never looks inside.
  address: string;
  // For display, supplied by the adapter.
  type: string;
  // For display, supplied by the adapter.
  name: string;
  op: Op;
  tracking?: Tracking;
  // Only with tracking "move".
  previousAddress?: string;
  // Property paths: names of properties, list indexes and map keys, as the
  // tool writes them. Never values (record 0046).
  changedKeys: string[];
  // The changed keys that forced a replace.
  replaceKeys: string[];
}

export interface Diff {
  stackId: string;
  changes: Change[];
}
