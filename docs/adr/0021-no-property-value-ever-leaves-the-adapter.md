# No property value ever leaves the adapter

> Amended by 0059: the Pulumi adapter reads one input of a new state, the `name` of a stack reference, only on a step of that type, and turns it into a stack id of the repo inside the adapter. The name itself never leaves.
>
> Amended by 0037: the summary is not without a budget. GitHub drops a step summary over 1 MiB, so the summary shortens too, and the job log holds every diff in full.
>
> Amended by 0046: changed keys are property paths, not top-level names. A path holds names, list indexes and map keys, never a value, so a map key must not be a secret either.
>
> Amended by 0048: a repo that turns `scan.logDiff` on gets the tool's own diff, values included, in each pending stack's group of the job log, and nowhere else.
>
> Amended by 0050: the preview page, a check run per pending stack, is one more place Sluiceway writes. It holds what the summary holds and never a value, because the runner's masks do not reach it.
>
> Amended by 0052: a repo may list property paths in `dashboard.showValues`. The old and new value at a listed path leave the adapter as display text and appear wherever the path does. Never a value the tool marks secret, and none with `dashboard.redact` on. Everything else in this record still holds for every path that is not listed.

Sluiceway renders the diff itself (0002), so it chooses what a person sees. In v1 it shows what changes and never what it changes to: addresses by type and name, ops, tracking changes and property names. No old value, no new value, no digest of a value. This holds for every place Sluiceway writes to: the issue body, comments, markers, deployment records, job summaries and its own lines in the job log.

Showing values the way PR-comment tools do, trusting the tool's own masking, was rejected for four reasons.

- A tool only masks what somebody marked. Pulumi prints `[secret]` for marked values and everything else in plain text. OpenTofu's plan JSON holds every value in plain text, sensitive ones included, next to a separate mask. The masking is only as good as every user and every provider author remembering to mark, and one miss is enough.
- An issue body has more reach than any other surface we have. It is emailed to subscribers, sent to integrations, indexed on a public repo, and every earlier version stays in the edit history. A value that lands there cannot be taken back by the next render.
- Changed keys are top-level property names (0007). The value of a top-level key is often a whole object: all environment variables of a container, a full Kubernetes `spec`. Secret and harmless leaves sit in the same object, and on create, replace and delete Pulumi gives no paths to tell them apart. Showing values would reopen 0007.
- The value is already somewhere better. It is in the code, and the row links to the merges that brought the change.

An opt-in list of property names whose values are shown was also rejected for v1. It needs nested paths, and the list is only as safe as the judgment of the person who wrote it. Record 0008 keeps the door open: if values are ever shown they join the diff and the hash by the same rule, without a breaking change.

## Consequences

- The `Diff` type of 0007 has no field that can hold a value, and it gets none in v1. The schema that parses tool output drops everything the adapter does not need, so a value has nowhere to ride along.
- An adapter may read values in memory when that is the only way to know that a property changed. OpenTofu needs this: changed keys come from comparing `before`, `after` and `after_unknown`, and a changed sensitive value is only found by comparing the two. What crosses into the core is the property name.
- A property marked secret or sensitive is shown like any other: by name. A changed secret reads as a changed key. There is no `[secret]` text anywhere, because there is never a value to stand in for, and no flag that says a key is secret. The tool's marking is not an input to anything in Sluiceway, so a missing mark cannot cause a leak.
- The raw tool output is a sensitive object. Pulumi's preview JSON and OpenTofu's plan file and plan JSON hold plain values. Sluiceway never prints them, not in debug mode either, never uploads them as an artifact or a cache, and never puts them in an error. When parsing fails, the error names the path and what was expected there, never what was found. Anything an adapter has to write to disk goes in a temporary directory that it removes when the preview ends, also when it fails or is killed (0012).
- The job summary of a scan is rendered by the core from the same diffs as the rows, without the size budget. It exists so that a truncated row has a full version to link to. It shows nothing a row could not show. Record 0002 said the summary could carry the tool's native output. It does not: native diff text prints unmarked values, and getting it costs a second preview of every stack.
- The job summary of an apply says what happened in the same terms: the stack, the counts by op, the result and the run. It never lists stack outputs, which can be secrets.
- A person who wants the tool's own diff text adds a workflow step that runs it. That output is theirs, goes where they send it, and Sluiceway never reads it.
- Names are shown, so names must not be secrets. Resource names, types and property names come from the user's code and the provider's schema. The docs say this in one line: do not put a secret in a resource name.
- The brief's rule "never render property values that the tool marks as secret, when in doubt show keys only" becomes simply: keys only.
- The promise of a tick stays the one in 0008: change these properties on these resources, at whatever value the code has when the deploy runs. The docs say so next to the explanation of the diff hash.
- How a change that touches only a stack's outputs is shown is still open (0007). Whatever the answer, it shows output names and never output values. Decided in 0036: not shown in v1.

Research:
- https://github.com/sluiceway/sluiceway/blob/research/pulumi-cli/docs/research/pulumi-cli.md
- https://github.com/sluiceway/sluiceway/blob/research/opentofu-adapter-fit/docs/research/opentofu-adapter-fit.md
