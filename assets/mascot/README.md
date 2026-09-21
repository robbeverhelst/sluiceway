# Header images

Penny, the gate, standing mid-channel on a quay: upstream on the left, downstream on the right. Eight pictures, each light and dark. The dashboard header points at these files at the exact release tag.

| Picture | Shown when |
|---|---|
| `first-run` | the scan found no stacks |
| `in-sync` | nothing is pending, deploying or failing |
| `pending-1` | 1 or 2 stacks are pending |
| `pending-2` | 3 to 9 stacks are pending |
| `pending-3` | 10 or more stacks are pending |
| `deploying` | a stack is deploying |
| `failing` | a preview failed, or a row has a failure line |
| `plain` | a pending or deploying row has a delete or replace |

Final art may redraw every shape. It keeps the character and colours (record 0030), the composition (0038), the states (0031), the pending levels (0039) and the file rules (0033, 0039):

- `<picture>-<theme>.svg`, `viewBox="0 0 880 160"`, shown at width 880 and centered
- one self-contained SVG: no script, no font, no text element, no raster image, no external reference
- CSS or SMIL animation only, off under `prefers-reduced-motion`, nothing blinks faster than once a second
- `plain-*.svg` has no animation and no colour
- at most 10 KB per file

The wordmark is drawn as paths, so it looks the same on every system. Its outlines come from Inter ExtraBold, which is under the SIL Open Font License 1.1. The font itself is not in this repo.

The files are generated. The generator lives with the prototype, on the `prototype/mascot-v2` branch of the private lab repo.
