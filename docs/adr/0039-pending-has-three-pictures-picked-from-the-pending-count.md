# Pending has three pictures, picked from the pending count, which makes sixteen files of 880 by 160

> Amended by 0043: `plain` is gone, and the three pending pictures and deploying exist once more with the destroy sign, which makes seven pictures and twenty-two files. The pending level picks the file with or without the sign in the same way.

The header could not carry a quantity. The images are static files served from the release tag (0033), so they can never hold a live number, and a badge or image service is ruled out. What a static file set can do is offer more than one picture for a state and let the renderer pick one.

Pending gets three pictures. The renderer picks one from the number of pending rows:

| Pending level | Pending rows | Upstream | File |
|---|---|---|---|
| 1 | 1 or 2 | low water, 1 crate | `pending-1-<theme>.svg` |
| 2 | 3 to 9 | water at the middle mark, 3 crates | `pending-2-<theme>.svg` |
| 3 | 10 or more | water at the top mark and splashing over Penny, 5 crates and one on top | `pending-3-<theme>.svg` |

Each level starts at or above the number of crates drawn in it, so the picture never shows more crates than there are stacks waiting. It may show fewer. The counts line right under it has the exact number.

A share of all stacks (a quarter pending, half pending) was rejected. A repo with 3 stacks would look flooded at 1 pending, and ten waiting changes are the same amount of work in a repo of 20 stacks as in one of 200. One crate per pending stack up to a cap was rejected as the only signal: it needs a file pair per count, and above the cap it says nothing. More than three levels was rejected because a reader cannot tell five water heights apart without a legend.

This amends 0033. Its mechanics stay: one file per theme, named by role, served from the exact release tag, the `<picture>` element, and every file rule not named below.

## Consequences

- There are eight pictures and sixteen files: `first-run`, `in-sync`, `pending-1`, `pending-2`, `pending-3`, `deploying`, `failing` and `plain`, each `-light.svg` and `-dark.svg`. There is no `pending-<theme>.svg` any more.
- The pending level is a pure function of the row markers, like the header state (0031): the number of known rows whose state is `pending`. Every writer can compute it for rows it only carries through.
- The header state is still one of six (0031). The pending level only picks the file when the state is `pending`. When bad news wins, the level is not shown.
- The alt text is the same for all three levels: `Sluiceway: changes are pending`.
- Every file has `viewBox="0 0 880 160"` and is shown at `width="880"`, which scales down in a narrower column. At a phone's 358 pixels Penny's face and the wordmark still read, which was checked on a rendered body.
- No file has a text element or names a font. Text would be drawn in the reader's own font, and the wordmark is paths (0038). CI checks this with the other file rules.
- The cap stays 10 KB per file. The files are 4.3 to 9.9 KB. The highest are `pending-3` and `deploying`, which leaves little room. Final art that needs more has to ask the owner for a higher cap with a reason.
- Other states may get levels later in the same way, as new files and a new line here. Deploying and failing do not need them now: one deploy and five look the same from the quay, and one failure is already the whole message.
