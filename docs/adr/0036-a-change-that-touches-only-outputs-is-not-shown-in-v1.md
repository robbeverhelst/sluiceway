# A change that touches only a stack's outputs is not shown in v1

> Amended by 0079: the root stack step is dropped as `same` and as `update`, and as `create` unless it is the only change. A `delete` or `replace` of it stays.

Records 0007 and 0021 left one question open: how to show a change that touches a stack's outputs and no resource. In v1 it is not shown. A stack whose preview holds no resource change and no tracking change is in sync, whatever happened to its outputs.

The reason is what the tool gives us. A test with a file backend (Pulumi CLI 3.198.0, one resource, then one output added) gave this from `pulumi preview --json`: `changeSummary` was `{ "same": 2 }`, the root stack step was `same`, and its `newState` had no outputs at all. The document that record 0001 builds on cannot tell that an output changed. The human text does say `+ added`, and so does the event stream behind `PULUMI_ENABLE_STREAMING_JSON_PREVIEW`, where the last outputs event of the root stack lists the new output names.

Moving the adapter to the event stream for this was rejected for v1. It is a second parser with its own recorded fixtures, for a case that is rare on its own: an output nearly always changes together with the resource it comes from, and then the row is pending anyway. Comparing output values was rejected outright. Many outputs are unknown until the deploy runs, and the values of outputs are as sensitive as any other value (0021).

## Consequences

- The cost is real and the docs say it: a stack whose only change is an added, removed or changed output has no checkbox, so it cannot be deployed from the dashboard. Another stack that reads the new output through a stack reference keeps failing its preview until someone deploys the first stack from outside Sluiceway, which is legal (0016).
- The Pulumi adapter drops the root stack step when it is `same`, as the research said. The build records a fixture for this case with the minimum CLI version (0001), so a CLI that starts to report output changes is noticed.
- The door stays open without a breaking change. An output change would arrive as one change per stack: `op` is `update`, the address names the stack's outputs, `type` reads `outputs`, and `changedKeys` holds the output names. Names only, never values (0021). It is an `update` even when an output is removed, because no real object goes away, so it can never raise a destroy warning (0007). It joins the hash by the rule of 0008. Rows of stacks with such a change get a new hash once.
- OpenTofu reports output changes in `output_changes`, so its adapter can use the same shape from its first day.
