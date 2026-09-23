# A kubectl recording that raced a write is taken again

> Amends 0060 (the fixtures come from a kind cluster). Built as slice 5.26.

The `fixtures-kubectl` job in CI failed eight times between 2026-09-22 and 2026-09-23 on pull requests that did not touch it, on both kubectl versions, and passed on a rerun each time (issue 207). The failing scenarios were `no-changes` and `removed-object` (`diff: expected exit code 0, got 1`) and `drift-changed` (`diff-after: expected exit code 0, got 1`).

The recordings of those runs say what happened. The recordings of all eight runs were still there as artifacts on 2026-09-23, and in every one the diff holds one object, the Deployment `web`, with `metadata.resourceVersion` and `status` different on the two sides and nothing else: not the spec, not a defaulted field, not `metadata.generation`. In seven of them `status.observedGeneration` already equals `metadata.generation` on both sides. In the eighth, `removed-object` on v1.34.0, the live side was read before the controller had observed the Deployment at all. For example, `no-changes` on v1.37.0 (run 35845121031): `resourceVersion` 561 on the live side and 572 on the merged side, and the merged side's status has `replicas: 1` and `updatedReplicas: 1` added, with its `Progressing` condition moved from `NewReplicaSetCreated` to `ReplicaSetUpdated`. In `drift-changed` the merged side has the scale down from 3 replicas finished (`terminatingReplicas: 2` on v1.37.0, `availableReplicas: 1` on v1.34.0).

kubectl diff reads each live object, then asks the API server for the server-side dry run of the apply. For a few seconds after a deploy or a scale, the Deployment controller writes the Deployment's status each time its ReplicaSet and pods move on. A write that lands between kubectl's read and the dry run puts two versions of the object on the two sides. The dry run itself keeps the version it read: in every recorded update the two sides share one `resourceVersion`.

## Decision

- **A recorded kubectl diff whose live and merged sides of one object name another `metadata.resourceVersion` raced a write, and the recorder runs it again.** The recording is the first run that did not race, at most ten runs, with no pause in between. When all ten race, the scenario stops with a message that says the cluster never held still, and nothing is saved.
- **Every recorded kubectl diff carries the check**: the previews, the drift checks and the tool diff of `log-diff-changed-secret`, so a scenario that diffs right after a deploy or a scale (`no-changes`, `removed-object`, `drift-changed`'s `diff-after`, and every other one) cannot record a race. A test holds every recorded `kubectl diff` step to it.
- **A test holds every committed kubectl fixture to a diff that raced nothing.** None does now: all 54 recorded diffs, 27 on each version, show one `resourceVersion` per object. No fixture in the repo holds a transient difference, and none can from now on.
- **The adapter does not change.** It already leaves `status` and `resourceVersion` out of a change (0060), so a race would show on a dashboard as no change. What the race broke was the recorder's own check of the exit code, and a raced recording of a scenario that expects differences would have passed and kept the controller's status in a fixture.

## Considered

- **Wait until `status.observedGeneration` equals `metadata.generation`.** The recordings rule it out: the two were already equal in seven of the eight failing runs. The controller goes on writing the status after it observed the generation.
- **`kubectl rollout status` before the diff.** It knows a few kinds only and waits on counts of replicas, which says when a rollout is done, not when the controller has written its last status. Any other kind with a controller would need a wait of its own. The version check covers every kind and every write.
- **Poll until two diffs in a row agree.** Two runs can agree while the controller is between two writes, and a single run can still race the write that comes after. The version check sees the race itself, in the run that is recorded.
- **A fixed sleep.** It makes the job slower on every run and still fails on a slow runner.
