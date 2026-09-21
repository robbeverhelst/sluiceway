# Header images

Penny, the gate, standing mid-channel on a quay: upstream on the left, downstream on the right. Seven pictures, each light and dark, and four of them once more with the destroy sign: twenty-two files. The dashboard header points at these files at the exact release tag.

| Picture | Shown when |
|---|---|
| `first-run` | the scan found no stacks |
| `in-sync` | nothing is pending, deploying or failing |
| `pending-1` | 1 or 2 stacks are pending |
| `pending-2` | 3 to 9 stacks are pending |
| `pending-3` | 10 or more stacks are pending |
| `deploying` | a stack is deploying |
| `failing` | a preview failed, or a row has a failure line |

The header always shows the real state. When a pending or deploying row has a delete or replace, the same picture carries the destroy sign: an amber warning triangle painted on the wall, between Penny and the wordmark. It does not move. Water, crates and Penny are exactly as in the picture without it.

| Picture with the sign | Shown when |
|---|---|
| `pending-1-destroys`, `pending-2-destroys`, `pending-3-destroys` | the header state is pending, and a pending row has a delete or replace |
| `deploying-destroys` | the header state is deploying, and a pending or deploying row has a delete or replace |

`failing`, `in-sync` and `first-run` have no file with the sign (record 0043).

Final art may redraw every shape. It keeps the character and colours (record 0030), the composition (0038), the states (0031), the pending levels (0039), the destroy sign (0043) and the file rules (0033, 0039):

- `<picture>-<theme>.svg` and `<picture>-destroys-<theme>.svg`, `viewBox="0 0 880 160"`, shown at width 880 and centered
- one self-contained SVG: no script, no font, no text element, no raster image, no external reference
- CSS or SMIL animation only, off under `prefers-reduced-motion`, nothing blinks faster than once a second
- a file with the sign differs from the file without it by the sign alone, and the sign does not move
- at most 10 KB per file

The wordmark is drawn as paths, so it looks the same on every system. Its outlines come from Inter ExtraBold, which is under the SIL Open Font License 1.1. The font itself is not in this repo.

The files are generated. The generator lives with the prototype, on the `prototype/mascot-v2` branch of the private lab repo.
