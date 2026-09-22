# A change says what happens to the real object and, separately, what happens to the tool's record of it

> Amended by 0046: `changedKeys` and `replaceKeys` hold property paths as the tool reports them (`values.controller.image.tag`), not top-level names. Still names, list indexes and map keys, never values.
>
> Amended by 0052: a change has one optional field more, `values`, with the old and new value at the changed paths that `dashboard.showValues` lists, as display text. The diff hash leaves it out.
>
> Amended by 0053: the table from OpenTofu's plan actions to `op` and `tracking`, settled from recordings of v1.11.0 and v1.12.6, is in that record.
>
> Amended by 0055: the drift check's changes use two ops, `update` (a property changed outside the code) and `delete` (the object is gone), and live in `Diff.drift`, never in `changes`.
>
> Amended by 0058: the table from the Helm diff plugin's change types to `op`, settled from recordings of helm v3.18.0 and v4.3.0, is in that record. Helm gives no `replace` and no tracking change.
>
> Amended by 0060: the table from the two sides of `kubectl diff` to `op`, settled from recordings of kubectl v1.34.0 and v1.37.0, is in that record. kubectl gives `create` and `update`, never `replace` or a tracking change.

The brief's diff has one `op` with four values. Both tools also emit steps that leave the real object alone and only change what the tool tracks: adopting an existing object, letting go of one that survives, renaming one in state. OpenTofu can combine these with a real change in one step, such as import and update. A flat list of seven ops was rejected because it cannot say that without inventing combined values, and because a "forget" sitting next to "delete" in one list invites a destroy warning on something that is not destroyed.

So every change carries two fields. `op` is what a deploy does to the real object. `tracking` is optional and is what it does to the tool's record of the object.

```ts
type Op = "create" | "update" | "replace" | "delete" | "none";
type Tracking = "import" | "forget" | "move";

interface Change {
  address: string;           // opaque, adapter-defined, unique within the diff
  type: string;              // for display, supplied by the adapter
  name: string;              // for display, supplied by the adapter
  op: Op;
  tracking?: Tracking;
  previousAddress?: string;  // only with tracking "move"
  changedKeys: string[];     // top-level property names, never values
  replaceKeys: string[];     // the changed keys that forced a replace
}

interface Diff {
  stackId: string;
  changes: Change[];
}
```

## Consequences

- A change has an `op` other than `none`, or a `tracking` value, or both. A pure import is `none` with `import`. OpenTofu's import and update is `update` with `import`. Its forget and create is `create` with `forget`, with no special case.
- Every warning about destroyed things reads `op` alone: `replace` and `delete`. A tracking change can never raise one and can never hide one.
- `address` replaces the brief's `urn`. Core sorts, hashes and compares it and never looks inside. What a person sees is `type` and `name`, which the adapter supplies. For Pulumi these are the type token and the logical name, so a URN never reaches the dashboard. Core never builds display text by parsing an address.
- Changed keys are top-level property names. This is the only depth both Pulumi sources can give: `detailedDiff` has paths but is null on create, replace and delete, while `diffReasons` and `replaceReasons` have top-level names only. The Pulumi adapter takes the first segment of each `detailedDiff` path when it is there and `diffReasons` otherwise, so a key means the same thing on an update and on a replace. The cost is that one changed env var and all of them both read as `environment`.
- Creates and deletes list no keys. Address and op are the whole signal.
- A replace carries `changedKeys` and `replaceKeys`, from Pulumi's `replaceReasons` or OpenTofu's `replace_paths`, so the row can say what forced it. `replaceKeys` is empty when the tool gives no reason.
- All folding is the adapter's job. It drops steps that change nothing (`same`, `no-op`, data source reads, refresh steps) and folds both replace orders into `replace`. A step it does not recognise fails that stack's preview and gives a preview failure row. It is never rendered as in sync.
- Row counts such as `+2 ~1 -0` come from `op` only. Changes that have only a tracking change get their own count, so they stay visible.
- The summary counts and the rendered text from the brief leave the type. Both are derived from `changes` by the core (see 0002).
- Not decided here: how to show a change that touches only a stack's outputs. The address is opaque and may name something that is not a resource, so either answer fits this shape. Decided in 0036: not shown in v1, and the shape it would take later is fixed there.

## The Pulumi table, settled from the recordings

The build plan left the table from Pulumi's step ops to `op` and `tracking` to the build. Slice 1.5 settled it from what CLI v3.229.0 and v3.263.0 printed for every scenario of the example project.

| Step op | Becomes |
|---|---|
| `same` | dropped |
| `read`, `refresh` | dropped. No recording holds one. They are here because this record names them as steps that change nothing |
| `create` | `create` |
| `update` | `update` |
| `replace` | `replace`. The tool prints one step for either replace order, because the adapter never passes `--show-replacement-steps` |
| `delete` | `delete`, or `none` with `forget` when the old state of the resource says `retainOnDelete` |
| `import` | `none` with `import` |
| anything else | the preview fails with the reason "the tool reported a step Sluiceway does not know" |

What the recordings showed that this record did not expect:

- The Pulumi adapter never gives `move`. A resource renamed with an alias has no step in the document at all, so such a stack is in sync (`docs/later.md`). `move` and `previousAddress` stay in the shape for OpenTofu's `moved` blocks.
- The tool calls a forget a `delete`. Only `retainOnDelete` on the old state tells the two apart, so that one flag is read from the state. It is an option of the resource, not a property value (0021).
- A replace of a resource with `retainOnDelete` stays a `replace`. No recording holds one, and a destroy warning too many is the safe side.
- On a replace the tool's `diffReasons` also names computed properties that will differ, such as the hashes of a file's content and its `id`. They are listed as changed keys, as the rule above says. `replaceKeys` holds what forced the replace, and every replace key is also a changed key.
- Two changes at one address are refused as output that cannot be read. Steps that are dropped do not count.

Research:
- https://github.com/sluiceway/sluiceway/blob/research/opentofu-adapter-fit/docs/research/opentofu-adapter-fit.md
- https://github.com/sluiceway/sluiceway/blob/research/pulumi-cli/docs/research/pulumi-cli.md
