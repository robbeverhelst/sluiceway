# The voice lives in two lines and stops at the first sign of trouble

> Clarified in slice 4.5: a dot of record 0040 is a signal, not the voice. The job log's headlines and the recently deployed list start with one, and the words stay plain.
>
> Amended by 0043: there is no `plain` state any more, so its row in the second table and its mentions are void. A delete or replace no longer turns the header plain. It still keeps the voice out: the two voiced lines cannot show while a row is pending or deploying, and the destroy sign adds no words.

The map allows playful copy in good-news and empty states only, and none on anything involving a delete or replace. Three levels were tried on the same two lines: dry (no water words), warm (one water image, then the fact) and full pun (jokes, first person). Warm won. A dashboard is read every day, and a line has to survive being read for the 200th time. The fact is always in the line, so a reader who ignores the image loses nothing.

The voice is allowed in exactly two places:

| Line | When | Warm | Dry |
|---|---|---|---|
| Good-news line, under the Pending heading (0029) | header state is `in-sync` | `Gate closed, water calm. Nothing to deploy.` | `Nothing to deploy. All 58 stacks are in sync.` |
| First-run line, under the Pending heading | header state is `first-run` | ``The channel is dry. Add a stack to `sluiceway.yaml` and the next scan fills it.`` | ``No stacks found yet. Add one to `sluiceway.yaml` and the next scan lists it here.`` |

In every other header state the picture is the only personality and the words are plain:

| Header state | Words |
|---|---|
| `pending` | none added. The Pending section has its usual instruction line: `Tick a box to deploy that stack exactly as its row shows it.` |
| `deploying` | none added. The deploying rows speak for themselves (0027). |
| `failing` with nothing pending | the dry line without the count: `Nothing to deploy.` The failures are on their own rows. |
| `failing` with rows pending | none added. |
| `plain` | none added. No face, no colour, no motion, no voice. |

The hard line: everything else Sluiceway writes is plain, always. Rows, counts, attribution, failure lines and failure reasons (0022), the orphan tick note, the shortened rows note, comments on the issue, the summary page, log lines, error messages and config errors. Anything that involves a delete or replace is plain twice over: the row is plain (0024, 0027) and it turns the header plain as well (0031).

One warm line on a deploy that succeeded was considered and rejected. A comment is a notification in someone's inbox, and a success for one reader sits next to a failure for another. Warm one-liners under the header in the pending and deploying states were rejected for the same reason the rows are dense: that is where people make a decision.

Settled while building (slice 1.7): the Pending section is always shown (0029), so it always needs one line. `deploying` and `plain` with nothing pending get the same dry line without the count as `failing`: `Nothing to deploy.` So does an in sync dashboard that carries a row of a state the writer does not know (0009), because in sync is a claim about every stack. With exactly one stack the dry good-news line reads `Nothing to deploy. 1 stack is in sync.`

## Consequences

- The warm lines never carry a number and never use the first person. Penny does not speak. The line describes the water.
- Each line is one fixed string per state. A rotating set of lines was set aside (later.md): it needs a stable pick rule to keep the body byte-identical (0004), and one good line is enough to launch.
- The dry lines are not a fallback of lower quality. They are what a dashboard with `dashboard.personality: false` shows (0034), and what the `failing` state shows when nothing is pending.
- Writing rules for both levels: short sentences, the fact always included, no exclamation marks, no em-dashes, no emoji in a voiced line, glossary words used as the glossary defines them (in sync, pending, stack, scan).
- New voiced lines are not added by taste. A new place for the voice means amending this record.
