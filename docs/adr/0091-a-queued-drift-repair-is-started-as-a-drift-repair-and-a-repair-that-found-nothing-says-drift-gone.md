# A queued drift repair is started as a drift repair, and a repair that found nothing says drift gone

> Amends 0056 (what the record that starts a queued stack carries) and 0059 (the trail's words for a drift repair). Built as slice 5.27.

A drifted stack that waits behind a stack it depends on was never repaired (issue 209). On a real repo a change to one shared stack drifted 42 stacks. `Repair all 42 drifted stacks` fixed 40. The two in a `dependsOn` chain were queued, as 0056 says, and a later run started them. Their records said nothing about drift, so `apply` ran no drift check, and the fresh preview, which does not refresh, found no change. Both ended as `no changes`, deployed nothing, and the next scan showed the same drift. It happened again on every bulk repair. The bulk box ticks the whole set, so a stack in a chain always lands in a later run, and a user who repairs from the bulk box could never clear it.

The cause was one missing key. 0055 puts `drift: true` on the payload of a record whose hash covers drift, and `apply` checks drift again only when the payload says so. 0056 came after it and says the record that starts a queued stack carries "the hash and the ticker of the queued one". The code did exactly that, and the drift key was lost at the hand-off.

## How it got through

The queued path and the drift path were each tested on their own, and never together. The tests of 0056 queue and start plain pending stacks. The tests of 0055 and 0059 tick a drifted stack that nothing queues. The e2e chain of three stacks had three pending layers, and no e2e step checked drift at all. 0056 listed what a started record carries by name, and left out `drift`, which 0055 had added to the payload just before. The list read as complete, and when slice 5.9 added `attempt` nobody read it again. Nothing on the dashboard looked wrong: `no changes` is what a stack deployed outside the dashboard also says, so the failure was silent for days until the owner compared the drift before and after by hand.

## Decision

- **The record that starts a queued stack carries everything the tick approved.** One key at a time, from the payload of 0003 and every key added to it since:
  - `hash`: carried. It is what the tick approved, and `apply` compares against it (0008).
  - `ticker`: carried. The tick rule was judged when the tick was made (0056).
  - `drift`: carried, the fix. The approved hash covers drift, and `apply` has to check drift again to compare like with like, and deploy with the repair (0055).
  - `run`: not carried. It is the run that opens the new record, because `apply` deploys only a record of its own run (0035, 0056).
  - `attempt`: not carried. It is the attempt of the run that opens the record, so the record's link lands on that run (slice 5.9). The queued record's attempt belongs to another run.
  - `behind`: not carried. The started record waits behind nothing, and `apply` refuses a record that has it (0056).
  - `merge`: never there. A merge record has no hash and is never queued: the scan after the merge ends it and opens the record that deploys, and a payload with both `merge` and `behind` is not read at all (0054).
  - `v`: always 1. `drift` was an added key, so the version stays.
- **A drift repair that finds nothing to repair says so.** When the payload says the hash covers drift and the drift check and the fresh preview both find nothing, nothing is deployed, as before. The trail's word is `drift gone`, with the white dot of `no changes`, and the job log says `The drift check and the fresh preview show no change: the drift the tick approved is not there any more, so there was nothing to repair. Nothing was deployed.` A plain tick that finds nothing keeps `no changes` and its line. The record's status is the same success "nothing to deploy, already in sync" as before, and the trail reads the difference from the payload. The `outcome` output stays `in-sync`: its values are fixed names (section 3 of the build plan), and a workflow that branches on them must not break.

## Why the louder word, and what it does not catch

This is a real outcome after the fix: drift put back outside the dashboard between the scan and the deploy, by hand or by another pipeline. The person ticked a repair, and `no changes` says only that the stack was in sync, which reads as if the repair worked. `drift gone` says the repair found the drift already gone. It is one word on the trail, in the place a person looks after a tick, and it costs nothing when things are right.

It would not have caught issue 209 by itself. There the payload had lost `drift`, so apply did not know it was a repair, and it would still have said `no changes`. What catches that class of bug is a test that runs the two paths together: a mode test that ticks a drifted stack behind a pending one and runs the started record through `apply`, and the e2e chain, whose middle layer is now drifted with the real tool and must end as `drift fixed` with the file put back.

## Considered

- **A refresh in `apply`'s fresh preview whenever a record is a drift repair**, as the issue suggested. `apply` already does the equivalent: with `drift: true` it runs the drift check again and adds the drift to the fresh diff before it compares (0055). The key was missing, not the mechanism.
- **Reading drift from the row in the later run.** The row of a queued stack says `queued`, not `drift`, and nothing about a deploy is decided from a row (0009). The record is the only place the tick's approval lives.
- **Copying the whole queued payload and overwriting `run`, `attempt` and `behind`.** Shorter, and a key added later would be carried without a thought. Rejected, because a key added later might be one that must not be carried, as `behind` must not. Naming each key in one place, with this record saying why, is the check.
- **A warning or a notification for `drift gone`.** Drift put back outside the dashboard is legal (0016), so it is not a failure and needs no alarm. The trail line and the log line are enough.
