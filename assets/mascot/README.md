# Header images and the row spinner

Penny, the gate, standing mid-channel on a quay: upstream on the left, downstream on the right. Ninety pictures, each light and dark, and eighty-seven of them three more times with the destroy signs: 702 files. The dashboard header points at these files at the exact release tag.

| Picture | Shown when |
|---|---|
| `first-run` | the scan found no stacks |
| `in-sync` | nothing is pending, deploying, failing or drifted |
| `pending-1` to `pending-20` | that many stacks are pending: one crate per stack |
| `pending-more` | more than 20 stacks are pending: the row of crates runs on past the left edge |
| `failing-0` to `failing-20` | a preview failed, or a row has a failure line: the jam, with one crate per pending stack behind it |
| `failing-more` | the same with more than 20 stacks pending |
| `deploying-0` to `deploying-20` | a stack is deploying: the open gate, one crate flowing through it, and one crate per pending stack waiting upstream |
| `deploying-more` | the same with more than 20 stacks pending |
| `queued-0` to `queued-20` | a stack is queued behind its dependencies and none is deploying: the closed gate, the ticked crate tied up at it, and one crate per pending stack behind it |
| `queued-more` | the same with more than 20 stacks pending |
| `drift` | nothing is pending, deploying or failing, and a stack changed outside the code: water seeps through the closed gate into the low downstream space, and Penny looks at it, puzzled |

The header always shows the real state, and the pending, failing, deploying and queued pictures show one crate per pending stack (records 0047, 0066 and 0075). Crates 13 to 20 stack on the pile. Behind the closed or jammed gate the water rises in five steps, one amber mark each on the gauge: 1 or 2, 3 or 4, 5 to 7, 8 to 10, and 11 or more pending. Behind the open gate it stays at one level. Drift only shows when nothing is pending, so it has one picture.

Small light teal fish swim in the water upstream of Penny, one per water step up to four in `pending`, `failing` and `queued`, none in `failing-0` and `queued-0`, and two in every `deploying` picture. They drift slowly back and forth.

When a pending, deploying or queued row has a delete or replace, the same picture carries the destroy signs on a pole in the water, right of the wordmark (records 0043 and 0075): the replace sign, an amber warning triangle, for a replace, and under it the delete sign, an amber diamond with a cross, for a delete. They do not move. Water, crates and Penny are exactly as in the picture without them.

| Picture with signs | Shown when |
|---|---|
| `<picture>-replaces` | a pending, deploying or queued row has a replace, and none has a delete |
| `<picture>-deletes` | one has a delete, and none has a replace |
| `<picture>-deletes-replaces` | there are both |

Every counted picture has the three: `pending-1` to `pending-more`, `failing-0` to `failing-more`, `deploying-0` to `deploying-more` and `queued-0` to `queued-more`. `drift`, `in-sync` and `first-run` have no file with a sign (records 0043, 0055 and 0066).

Final art may redraw every shape. It keeps the character and colours (record 0030), the composition (0038), the states (0031), the crates, water steps and fish (0047), the destroy signs (0043, 0047, 0075), the seep of drift (0055), the tied-up crate of queued (0075) and the file rules (0033, 0039):

- `<picture>-<theme>.svg`, and `<picture>-<signs>-<theme>.svg` with `<signs>` one of `deletes`, `replaces` and `deletes-replaces`, `viewBox="0 0 880 160"`, shown at width 880 and centered
- one self-contained SVG: no script, no font, no text element, no raster image, no external reference
- CSS or SMIL animation only, off under `prefers-reduced-motion`, nothing blinks faster than once a second
- a file with signs differs from the file without them by the signs alone, and the signs do not move
- at most 10 KB per file

The wordmark is drawn as paths, so it looks the same on every system. Its outlines come from Inter ExtraBold, which is under the SIL Open Font License 1.1. The font itself is not in this repo.

The files are generated. `polish.mjs` on the `prototype/header-polish` branch of the private lab repo writes all 702 (record 0075). It reuses the generator of `prototype/header-fish` and the drift picture's of `prototype/header-drift` (record 0055), and draws the water once per file and places it with `<use>`, which keeps the fullest file under the cap.

## The row spinner

`spinner-light.svg` and `spinner-dark.svg` are not a header. A deploying row starts with one, through the same `<picture>` trick and from the same release tag, so the stack a person just ticked is visibly moving (record 0063). It is one of the header's crates, bobbing in the water on its way through the gate. Only with a header: `dashboard.personality: false` has no spinner.

A queued row starts with `spinner-queued-light.svg` or `spinner-queued-dark.svg` instead: the same crate, level and still, in still water (record 0093). The queued header ties the ticked crate up at the closed gate and nothing moves but the water, so the row's crate does not move either, and motion on a row always means that stack is deploying now.

- `viewBox="0 0 24 24"`, shown at width 16
- the file rules above, and at most 1 KB per file
- the bob and the water turn off under `prefers-reduced-motion`; the queued crate has no animation at all

Its generator is `spinner.mjs` on the `prototype/row-spinner` branch of the private lab repo, which draws a second take too, a teal ring. The queued crate is its `moored` take.
