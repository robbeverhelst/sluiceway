# Deploying sits at the top, and its rows start with a spinner

Record 0029 put Pending first, because ticking is what a person opens the dashboard for, and rejected putting the short sections above the long pending list. Record 0027 fixed the row of a deploying stack as plain text: `**id** · deploying · ticked by carol · [run](url)`. The owner asked on 2026-09-22 for both to change: while something deploys, that is what the person is watching, and the section vanishes when it is empty, so pending loses nothing. Build plan slice 4.12 brings it in.

## Decision

- **The sections are, top to bottom: Deploying (only when it has rows), Updates waiting to merge, Pending, Drifted, Preview failed, In sync, Recently deployed.** The root marker, the header, the counts line, the scan line and the shortened-rows note stay above all of them. Pending is still always shown. Queued rows stay in Deploying, as 0056 placed them. This supersedes the order of 0029, and only the order: what each section holds and when it is left out do not change.
- **The destroy alert stays right above the pending list** (0062), under the Pending heading, and so under Deploying. It is an index to the delete and replace lines at the one place a person passes before ticking, and a deploying row has nothing left to tick.
- **The updates waiting to merge sit between Deploying and Pending.** A tick there deploys too (0054), so they stay next to the pending rows, and what is already going out stays above everything that could go out.
- **A deploying or queued row starts with a spinner**, a small animated picture, so the stack a person just ticked is visibly moving: `- <picture><source media="(prefers-color-scheme: dark)" srcset=".../spinner-dark.svg"><img alt="" width="16" height="16" src=".../spinner-light.svg"></picture> **id** · deploying · ...`. The same `<picture>` trick and the same exact release tag as the header (0033), from `assets/mascot/`. It stays on the first line, so the row is still found by one regex on one line, and a deploying row still has no box. A row waiting to start has it too: its deploy is on its way. No other row has one.
- **The picture is one of the header's crates, bobbing in the water on its way through the gate**, which ties the row to the deploying header, where crates go through the open gate. A second take, a teal ring, was drawn in the same generator and posted next to it on real rows in the private lab repo (lab issue 60). The crate is the recommendation and ships. The owner's choice is still open: the ring is a swap of two files and a new release.
- **The files are `spinner-light.svg` and `spinner-dark.svg`**: `viewBox="0 0 24 24"`, shown at 16 by 16, the size of GitHub's own icons in a line of text, so the line does not grow. The file rules of 0033 hold, the cap is 1 KB and not 10, and the bob and the water stop under `prefers-reduced-motion`. The crate files are 709 bytes each.
- **The alt text is empty.** The word right after it says deploying, waiting to start or queued, so a screen reader would read it twice.
- **Only with a header.** The spinner is an image, like the header, so `dashboard.personality: false` has none, and its dashboards stay what they were.
- **The spinner is the first thing the size budget drops.** A writer renders its own deploying rows with it. When the body does not fit, every spinner of the writer's own rows goes before any pending row is shortened (0028). A spinner costs a row about 300 characters with a tag and about 370 with a commit SHA, so 256 deploying rows, the most one `resolve` starts (0035), would add some 80,000 characters: more than the hard limit on their own. All or none, so every deploying row looks the same.
- **A carried row keeps the spinner of the version that wrote it.** A writer never reads inside a row it carries (0009), and a file at an exact tag never changes. A row written before this version has none until a writer renders it again.

## Consequences

- GitHub keeps the inline `<picture>`, its `<source>` and the width and height of the `<img>` inside a list item, and wraps it in its own `themed-picture` element that follows the reader's theme. It does not wrap it in a link. Seen on lab issue 60 on 2026-09-22 through the API's rendered HTML.
- The file set of 0033 grows by two: 66 files in `assets/mascot/`, 64 of them headers. The asset test holds the spinner to its own cap and view box.
- The frame of 0027 changes for deploying and queued rows only: the first line starts with the spinner under a header. Their marker, words and attribution line do not change.
- A body written before this version has Deploying under Pending. The next writer of any mode regenerates the order, as it does everything outside the row blocks (0009).

This record supersedes 0029 on the order of the sections, and amends 0027 (the first line of a deploying or queued row) and 0033 (the file set, and a second cap for the spinner).

Prototype: `spinner.mjs` on the `prototype/row-spinner` branch of the private lab repo draws both takes with the colours of the header generator, and lab issue 60 shows them on real rows.
