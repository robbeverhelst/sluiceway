# A queued row starts with the crate standing still

> Amends 0063 (a deploying or queued row starts with the spinner).

0063 gave every deploying and queued row the spinner, a crate bobbing in the water, so the stack a person just ticked is visibly moving. A design review on 2026-09-23 found that this puts two moving crates in the Deploying section when one stack deploys and another waits behind it. Only one of them is running. The words say `queued behind`, but at a glance the motion says both are moving. The queued header of 0075 already draws it the other way: the ticked crate is tied up at the closed gate, and nothing moves but the water.

## Decision

- **A queued row starts with `spinner-queued-light.svg` or `spinner-queued-dark.svg`**: the same crate, level and still, in still water, with no animation at all. A deploying row, and a row waiting to start, keep the spinner. Motion on a row now always means that this stack is deploying now.
- **The same rules as the spinner otherwise.** It is shown only with a header, from the same action ref, at width 16, under 1 KB. Its alt text is empty, because the words after it say queued. The size budget drops it with the spinners (0072).
- **A carried row keeps the picture of the version that wrote it**, as 0063 says. A queued row that an older version wrote keeps the moving spinner until a scan writes it again.

## Considered

- **No picture on a queued row.** The Deploying section would then lose its shared left edge, and the row that was ticked would look like a plain line.
- **A dimmed crate.** At 16 px, a lower opacity reads as disabled, not as waiting, and it would need a contrast check against both themes. Stillness already carries the difference.
