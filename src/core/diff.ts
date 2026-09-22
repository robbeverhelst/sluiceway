// The shape of a diff, as record 0007 fixes it. One field holds values: the
// ones at paths a repo listed in `dashboard.showValues`, and no other (record
// 0052, which amends 0021).

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
  // The old and new value at changed paths that `dashboard.showValues` lists,
  // sorted by path. Absent when there are none. The diff hash covers them, as
  // a row shows them (records 0008 and 0052).
  values?: ShownValue[];
}

// A value as display text, already shortened. A side is absent when the
// property is not there on that side: a key that is added or removed.
export interface ShownValue {
  path: string;
  old?: string;
  new?: string;
}

export interface Diff {
  stackId: string;
  changes: Change[];
}
