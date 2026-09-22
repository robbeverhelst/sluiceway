# Header images

Penny, the gate, standing mid-channel on a quay: upstream on the left, downstream on the right. Eighteen pictures, each light and dark, and fourteen of them once more with the destroy sign: 64 files. The dashboard header points at these files at the exact release tag.

| Picture | Shown when |
|---|---|
| `first-run` | the scan found no stacks |
| `in-sync` | nothing is pending, deploying, failing or drifted |
| `pending-1` to `pending-12` | that many stacks are pending: one crate per stack |
| `pending-more` | more than 12 stacks are pending: the row of crates runs on past the left edge |
| `deploying` | a stack is deploying |
| `failing` | a preview failed, or a row has a failure line |
| `drift` | nothing is pending, deploying or failing, and a stack changed outside the code: water seeps through the closed gate into the low downstream space, and Penny looks at it, puzzled |

The header always shows the real state. The water behind Penny rises in five steps, one amber mark each on the gauge: 1 or 2, 3 or 4, 5 to 7, 8 to 10, and 11 or more pending.

Small light teal fish swim in the water upstream of Penny, one per water step up to four, and two in `deploying`. They drift slowly back and forth.

When a pending or deploying row has a delete or replace, the same picture carries the destroy sign: an amber warning triangle on a pole in the water, right of the wordmark. It does not move. Water, crates and Penny are exactly as in the picture without it.

| Picture with the sign | Shown when |
|---|---|
| `pending-1-destroys` to `pending-12-destroys`, `pending-more-destroys` | the header state is pending, and a pending row has a delete or replace |
| `deploying-destroys` | the header state is deploying, and a pending or deploying row has a delete or replace |

`failing`, `drift`, `in-sync` and `first-run` have no file with the sign (records 0043 and 0055).

Final art may redraw every shape. It keeps the character and colours (record 0030), the composition (0038), the states (0031), the crates, water steps and fish (0047), the destroy sign (0043, 0047), the seep of drift (0055) and the file rules (0033, 0039):

- `<picture>-<theme>.svg` and `<picture>-destroys-<theme>.svg`, `viewBox="0 0 880 160"`, shown at width 880 and centered
- one self-contained SVG: no script, no font, no text element, no raster image, no external reference
- CSS or SMIL animation only, off under `prefers-reduced-motion`, nothing blinks faster than once a second
- a file with the sign differs from the file without it by the sign alone, and the sign does not move
- at most 10 KB per file

The wordmark is drawn as paths, so it looks the same on every system. Its outlines come from Inter ExtraBold, which is under the SIL Open Font License 1.1. The font itself is not in this repo.

The files are generated. The generator lives with the prototype, on the `prototype/header-fish` branch of the private lab repo, and the drift picture's on `prototype/header-drift` (record 0055).
