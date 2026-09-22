# The root stack resource is not a change, unless it is the only work a deploy has

> Amends 0007 (the Pulumi table) and 0036 (which dropped the root stack step only when it was `same`).

Pulumi makes one resource of its own for every stack, `pulumi:pulumi:Stack`, the parent of every resource of the program. The Pulumi adapter dropped its step only when it was `same` (0036). On a stack that was never deployed the step is `create`, so a program with two resources read as "3 creates", and the row and the preview page listed `create pulumi:pulumi:Stack <name>` (issue 165). That is the first scan a new user sees, and the first thing they check is the number of resources they wrote.

The root stack resource is the stack coming into being, not a resource anyone wrote. So the adapter treats it like this, by the step op:

| Step op of the root stack resource | Becomes |
|---|---|
| `same` | dropped, as before (0036) |
| `create` | dropped, unless the diff would be empty without it. Then it is the diff's one change |
| `update` | dropped. The resource holds nothing but the stack's outputs, and a change to outputs alone is not shown (0036) |
| `delete`, `replace` | kept, as a destroy. No recording holds either one, and a destroy warning too many is the safe side (0007) |

The root stack resource is the resource whose URN names the type `pulumi:pulumi:Stack` with no parent in front of it. A resource of that type under a parent is a resource of the program.

## Why the create stays when it is the only work

A stack that was never deployed and whose program holds no resource, only outputs or stack references, previews as one step: the create of the root stack resource. Dropping it would give an empty diff. The row would say in sync and have no box, while a deploy still has work: it makes the stack, its state and its outputs, which another stack may read through a stack reference. Such a stack could then never be deployed from the dashboard. So the create is kept when nothing else is left, and the row reads "1 create" of `pulumi:pulumi:Stack`. A step that changes nothing (`same`, `read`) does not count as something else. A tracking change does.

This is not the output change of 0036. That case is a deployed stack whose outputs changed, and the tool's document cannot tell it. Here the stack does not exist yet, and the document says so.

## Consequences

- The row of a stack that was never deployed counts the resources of its program, and so do its preview page, the summary and the result file.
- The diff hash covers the changes (0008), so the row of every stack that was never deployed gets a new hash once, on the first scan with this version. A tick made on the old hash is refused as a change that moved, like any other (0051).
- `apply` previews with the same adapter, so it computes the same hash, and a stack whose one change is the root stack create deploys like any other.
- The recordings hold a scenario for the one-change case, `new-stack-without-resources`, with both CLI versions. The `update`, `delete` and `replace` rows of the table come from no recording and are held by tests of written steps, in the shape of the recorded ones.
- OpenTofu, Helm and Kubernetes manifests have no such resource.
