# Header images and the row spinner

Penny, the gate, standing mid-channel on a quay: upstream on the left, downstream on the right. Forty-four pictures, each light and dark, and forty-one of them once more with the destroy sign: 170 files. The dashboard header points at these files at the exact release tag.

| Picture | Shown when |
|---|---|
| `first-run` | the scan found no stacks |
| `in-sync` | nothing is pending, deploying, failing or drifted |
| `pending-1` to `pending-12` | that many stacks are pending: one crate per stack |
| `pending-more` | more than 12 stacks are pending: the row of crates runs on past the left edge |
| `failing-0` to `failing-12` | a preview failed, or a row has a failure line: the jam, with one crate per pending stack behind it |
| `failing-more` | the same with more than 12 stacks pending |
| `deploying-0` to `deploying-12` | a stack is deploying: the open gate, one crate flowing through it, and one crate per pending stack waiting upstream |
| `deploying-more` | the same with more than 12 stacks pending |
| `drift` | nothing is pending, deploying or failing, and a stack changed outside the code: water seeps through the closed gate into the low downstream space, and Penny looks at it, puzzled |

The header always shows the real state, and the pending, failing and deploying pictures show one crate per pending stack (records 0047 and 0066). Behind the closed or jammed gate the water rises in five steps, one amber mark each on the gauge: 1 or 2, 3 or 4, 5 to 7, 8 to 10, and 11 or more pending. Behind the open gate it stays at one level. Drift only shows when nothing is pending, so it has one picture.

Small light teal fish swim in the water upstream of Penny, one per water step up to four in `pending` and `failing`, none in `failing-0`, and two in every `deploying` picture. They drift slowly back and forth.

When a pending or deploying row has a delete or replace, the same picture carries the destroy sign: an amber warning triangle on a pole in the water, right of the wordmark. It does not move. Water, crates and Penny are exactly as in the picture without it.

| Picture with the sign | Shown when |
|---|---|
| `pending-1-destroys` to `pending-12-destroys`, `pending-more-destroys` | the header state is pending, and a pending row has a delete or replace |
| `failing-0-destroys` to `failing-12-destroys`, `failing-more-destroys` | the header state is failing, and a pending or deploying row has a delete or replace |
| `deploying-0-destroys` to `deploying-12-destroys`, `deploying-more-destroys` | the header state is deploying, and a pending or deploying row has a delete or replace |

`drift`, `in-sync` and `first-run` have no file with the sign (records 0043, 0055 and 0066).

Final art may redraw every shape. It keeps the character and colours (record 0030), the composition (0038), the states (0031), the crates, water steps and fish (0047), the destroy sign (0043, 0047), the seep of drift (0055) and the file rules (0033, 0039):

- `<picture>-<theme>.svg` and `<picture>-destroys-<theme>.svg`, `viewBox="0 0 880 160"`, shown at width 880 and centered
- one self-contained SVG: no script, no font, no text element, no raster image, no external reference
- CSS or SMIL animation only, off under `prefers-reduced-motion`, nothing blinks faster than once a second
- a file with the sign differs from the file without it by the sign alone, and the sign does not move
- at most 10 KB per file

The wordmark is drawn as paths, so it looks the same on every system. Its outlines come from Inter ExtraBold, which is under the SIL Open Font License 1.1. The font itself is not in this repo.

The files are generated. `counts.mjs` on the `prototype/header-counts` branch of the private lab repo writes all 170 (record 0066). It reuses the generator of `prototype/header-fish` and the drift picture's of `prototype/header-drift` (record 0055).

## The row spinner

`spinner-light.svg` and `spinner-dark.svg` are not a header. A deploying or queued row starts with one, through the same `<picture>` trick and from the same release tag, so the stack a person just ticked is visibly moving (record 0063). It is one of the header's crates, bobbing in the water on its way through the gate. Only with a header: `dashboard.personality: false` has no spinner.

- `viewBox="0 0 24 24"`, shown at width 16
- the file rules above, and at most 1 KB per file
- the bob and the water turn off under `prefers-reduced-motion`

Its generator is `spinner.mjs` on the `prototype/row-spinner` branch of the private lab repo, which draws a second take too, a teal ring.
