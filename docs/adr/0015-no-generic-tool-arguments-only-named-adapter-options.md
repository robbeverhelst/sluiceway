# No generic tool arguments, only named adapter options

> Amended by 0055: a deploy of a row whose approved hash covers drift runs with `--refresh`, after `apply` checked the drift again. The named `refresh` option is still not built.

Tooling that wraps an IaC tool usually fixes a set of flags for every call, and users moving to Sluiceway will ask for a way to pass their own. There is no such option, in v1 or later. Sluiceway decides the command line (0001). When a flag is really needed it becomes a named, typed option in the stack's adapter options (0006), added one at a time.

A free list of extra arguments was rejected for three reasons. A flag can change the output the adapter parses. A flag that reaches the preview but not the deploy, or the other way round, breaks the promise that a tick deploys what the row showed (0008). And a flag such as `--target` brings back selection below the stack, which is a non-goal. A named option is reviewed once for all three: it is applied the same way to the scan's preview, the preview that `apply` repeats and the deploy itself, or it is not added.

## Consequences

- There is no `refresh` option in v1. The first real user's wrapper previews and deploys with `--refresh`, to catch changes made outside the code. Sluiceway keeps those apart on purpose: a preview compares code with state, the drift check compares state with reality, and both land on the same row. Refreshing in every preview would also read every real resource of every stack in every scan. So a deploy from the dashboard does not refresh first. Whether a deploy should also repair drift belongs to the drift design and is not decided here.
- If `refresh` is added later it is a named option that puts the flag on all three calls, so the hash stays honest. Rows of stacks that turn it on get a new hash once. Nothing else breaks.
- The environment stays the way to change tool behavior that has no named option. Pulumi and OpenTofu both read many variables of their own, and the workflow can set them (0013).
- Sluiceway never runs destroy, state surgery or a plain refresh. Those stay with the user's own tooling (0016).
