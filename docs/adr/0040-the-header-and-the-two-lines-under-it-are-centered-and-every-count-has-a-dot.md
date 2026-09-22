# The header and the two lines under it are centered, and every count has a dot

> Amended by 0043: there is no plain state any more. The dots are shown whenever there is a header, also when the picture carries the destroy sign.

Record 0029 put the header, the counts line and the scan line at the top of the body, all left-aligned, the counts as plain text. With a header as wide as the issue (0038) the three belong together as one block, and the counts deserve to be found at a glance.

GitHub's sanitizer was tested through its Markdown API. It keeps `align="center"` on `<p>`, `<div>`, tables and headings. It strips `style` and every colour attribute. So a coloured dot can only be an emoji or an image.

```md
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/sluiceway/sluiceway/<exact release tag>/assets/mascot/pending-2-dark.svg">
    <img alt="Sluiceway: changes are pending" width="880" src="https://raw.githubusercontent.com/sluiceway/sluiceway/<exact release tag>/assets/mascot/pending-2-light.svg">
  </picture>
</p>

<div align="center">

🟡&nbsp;**7 pending** · 🔵&nbsp;2 deploying · 🔴&nbsp;2 preview failed · 🟢&nbsp;43 in sync · 🔴&nbsp;2 failed deploys

Scanned [`8c41f0e`](commit-url) on 2026-09-21 10:02 UTC · [run](run-url) · <sub>last full scan 2026-09-21 06:00 UTC</sub>

</div>
```

The dots are emoji: yellow for pending, blue for deploying, red for preview failed and for failed deploys, green for in sync. A count of 0 gets a white dot, so a red dot always means there is something to look at. Small dot images in the brand colours, served next to the header files, were rejected: GitHub wraps every image in a link, so each dot would be clickable, and they are eight more files that say nothing an emoji does not. One merged `failing` number was rejected: preview failed is a section of the body and failed deploys are lines on rows, and the reader looks for them in different places.

This amends 0029 and the markup of 0033. The wording of both lines, what they count, and when the two extra facts appear stay as 0029 has them.

## Consequences

- The `<picture>` sits inside `<p align="center">`. The counts line and the scan line sit inside one `<div align="center">`, with a blank line after the opening tag, between the two lines, and before the closing tag, so both are still rendered as Markdown.
- A non-breaking space joins each dot to its count. Without it a narrow column can break the line between the two, which was seen at phone width.
- The destroy warning keeps its `:warning:` and gets no dot.
- The dots are signals, like the signal colours in the picture (0030). They belong to the header: they are shown exactly when a header in colour is shown.
- In the plain state (0031) the lines stay centered under the plain header and carry no dots. Plain has no colour, and the destroy warning is the one thing that should stand out there.
- With `dashboard.personality: false` (0034) there is no header, no centering and no dots. The two lines are exactly what 0029 made them, left-aligned, so nothing changes for those dashboards.
- Same input still gives the same bytes (0004). The dots and the centering are a pure function of the header state, the counts and the personality switch.
- The shortened-rows note (0028) stays directly under the scan line, outside the centered block.

## Settled while building (slice 4.5)

The owner asked for the result of a deploy to be visible at a glance (2026-09-22). The dots of this record now also mark results, in three places and nowhere else:

- **The recently deployed list** (0029): each line starts with a result dot and a non-breaking space, 🟢 for a deploy that went out, ⚪ for one that found nothing to deploy (0051) and 🟣 for a rehearsal. Like the count dots, they are shown exactly when there is a header: with `dashboard.personality: false` the list is what 0029 made it.
- **The headlines of the job log**: the scan's line that wrote the dashboard takes the dot of the header state it wrote (🔴 failing, 🔵 deploying, 🟡 pending, 🟠 drift, ⚪ first run, 🟢 in sync), a preview failure 🔴, the line of `apply` that says how the deployment record ended takes the dot of its `outcome` (🟢 deployed, 🔴 failed, 🟡 refused, ⚪ in sync, 🟣 rehearsed), and `settle` 🔴 for a record it ended and ⚪ when it had nothing to end. The log has no personality switch, so these are always shown.
- **The notification recipes** (0041): the message starts with the dot of its result.

The colours are the counts line's own. Green went out, red failed, white is nothing went out, as a count of 0 is. A refused deploy is yellow, the pending dot, because nothing went out and the stack is pending again. Orange was the first choice for refused and is taken by drift (0055). A rehearsal is purple, the one result the counts line has no colour for. The set that the earlier internal dashboard used, a check mark for a deploy and a test tube for a rehearsal, was set aside: it is a second set of symbols next to the dots, for the same facts.

Never on a row, never in a voiced line (0032), and never on any other log line, comment, summary or error message. The dots are signals and carry no voice: the words next to a dot always say what it means.
