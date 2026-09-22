# The header always shows the real state, and a destroy adds a sign to the same picture

> Amended by 0075: the triangle is now the replace sign, and a delete has a sign of its own under it on the same pole, an amber diamond with a cross. The files end in `-deletes`, `-replaces` or `-deletes-replaces` in place of `-destroys`, and a queued row counts like a deploying one.
>
> Amended by 0047: the sign stands on a pole in the water right of the wordmark, and it is added to the thirteen pending pictures of 0047, which makes 62 files. The pending alt text says the number of stacks.
>
> Amended by 0055: the drift state takes the low downstream space this record kept free. Sixty-four files.
>
> Amended by 0066: the failing picture carries the destroy sign too, from the same rule, and the pending, failing and deploying pictures each exist per crate count.

Record 0031 made any delete or replace in a pending or deploying row turn the header plain: a grey gate, no face, no colour, no motion. The first scan of a real repo with 58 stacks showed what that means in practice (onboarding log, hurdle 12). Four pending rows held a delete or a replace, and three of those were routine replacements of a Kubernetes Secret or ConfigMap, which Pulumi replaces whenever their content changes. In a Kubernetes repo that is the normal state. The header that sets Sluiceway apart would almost never show, and a warning that is on every day is not read.

The core cannot tell a ConfigMap from a database, and it must not try: a rule that guesses which replaces are harmless is wrong once about something that matters. So the fact stays as wide as it was, any destroy in a pending or deploying row, and what changes is what the header does with it.

The owner decided on 2026-09-21, in two steps. First: the plain header goes away. A first round drew a header state of its own, called careful, that took the place of the pending pictures (lab issues 42 to 45). He then set that aside as well: "I don't want this grey one, I think ever. The image can have special states, so it's always with Penny but with extra signs for certain things like replace or delete." A state of its own hides the real state behind the warning. A sign inside the real picture hides nothing.

So the header always shows the real state, and a destroy adds a sign to the same picture. Three signs that belong on a quay were drawn on the pending and deploying pictures and judged on rendered issues in the private lab repo, in light and dark and at phone width, on the 58 stack dashboard with its deletes and replaces (lab issues 46 to 49):

- **One stamped crate.** One of the waiting crates is red with a white cross. The quietest, and most in the story. It is small on a phone, and while deploying it drifts out of view. Rejected.
- **A striped board on the crossbeam and a slow amber beacon.** The loudest, and it moves. A sign that shows most days and pulses is tuned out within a week. It also put `pending-3` over the 10 KB cap. Rejected.
- **A warning sign painted on the wall.** Chosen.

The destroy sign is an amber warning triangle painted on the quay wall downstream, between Penny and the wordmark. It does not move. Everything else in the picture is exactly the picture without it: the water level, the crates, Penny's face, the motion. The water and the crates still say how much is waiting.

This amends 0031, 0032, 0033, 0034, 0038, 0039 and 0040.

## What was decided with the owner

| Question | Answer |
|---|---|
| One sign for both, or a sign of its own for a delete? | One sign. It costs 8 files, two signs cost 16. The row marker counts deletes and replaces together as `destroys` (0027), so one sign needs nothing new from it. Which row and which op is what the row warnings are for. |
| Which sign, and how loud? | The wall sign, and it stays still. It reads at a glance and at phone width, and a sign that shows most days must inform without nagging. |
| Which pictures get it? | The three pending levels and deploying. In sync and first run can never have a pending or deploying row. Failing does not get it: the jam already says a person is needed, and the counts line under it still carries the destroy warning. |
| The alt text | The state's alt text plus the fact: `Sluiceway: changes are pending, some delete or replace resources` and `Sluiceway: deploying, some changes delete or replace resources`. |
| Count dots when the sign shows? | Yes. 0040 took them away for plain only, and plain is gone. The dots are shown whenever there is a header. |

## Consequences

- There are five header states: `failing`, `deploying`, `pending`, `first-run` and `in-sync`, and the first that applies wins in that order. The `plain` state is gone and nothing takes its place in the table.
- The destroy sign is a second pure function of the row markers, next to the header state and the pending level: it is on when any known row of state `pending` or `deploying` has `destroys` above 0. That is the rule plain had. It picks the file only when the header state is `pending` or `deploying`.
- The files are `pending-<level>-destroys-<theme>.svg` and `deploying-destroys-<theme>.svg`. With the fourteen others that is twenty-two files. `plain-light.svg` and `plain-dark.svg` are deleted.
- Until the renderer follows (build plan, slice 1.7c) it still asks for the plain files, which no longer exist, so a dashboard with a destroy shows a broken image. That slice must land before the first release, as 1.7b had to.
- A deploying row that deletes or replaces now runs under the open, grinning gate with the sign next to it. 0031 turned the header plain to avoid exactly that, and the owner's decision reverses it: the header says what is happening, and the sign says what to watch.
- The voice rules do not change (0032). The voice lives only in the good-news line and the first-run line, and neither can show while a row is pending or deploying. The sign adds no line of text anywhere.
- The row warnings, the destroy warning on the counts line and the marker keys do not change. The same input still gives the same bytes (0004).
- A file with the sign keeps every file rule of 0033 and 0039, and differs from the file without it by the sign and the alt text alone. The rule that `plain-*.svg` has no animation and no colour leaves with the plain files.
- The cap holds, and barely: `pending-3-destroys-dark.svg` is 10,158 of 10,240 bytes. Final art that needs more asks the owner for a higher cap (0039).
- Amber is the warning colour (0030), and red stays with failing. If a delete ever gets a sign of its own, red is taken by the jam's lamp, so that sign needs a shape and not only a colour (later.md).
- The sign sits high on the wall. The space low on the downstream side stays free for the drift state (0038).
- Both rounds, their generators and the lab issue bodies are on the `prototype/careful-header` and `prototype/header-sign` branches of the private lab repo. The header generator on `prototype/mascot-v2` there writes the twenty-two shipped files, the fourteen older ones byte for byte as before.
