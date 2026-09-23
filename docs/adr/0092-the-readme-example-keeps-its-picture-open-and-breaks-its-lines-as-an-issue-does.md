# The README example keeps its picture open and breaks its lines as an issue does

> Amends 0088 (the README's copy of the example sits whole in a closed `<details>`).

A design review of the README on 2026-09-23 found two problems with the example dashboard.

The first was that the rows fell apart. GitHub renders an issue body with every line break as a break, and a repository README without them. The dashboard's rows rely on that: the `from` line under a row, and each `:warning: DELETE` or `REPLACE` line, sit on lines of their own. The live dashboard of `sluiceway/examples` had 26 `<br>` where the README had none outside its folds. On the README, a row with three deletes read as one wrapped paragraph: the row, its attribution, its compare link and the three deletes run together. The one cue the dashboard is built around, a destroy on its own line starting with ⚠️, was the thing lost.

The second was that the first screen showed only the calm picture. Above the fold, the README had Penny asleep in sync, one line and the beta notice. The picture that shows what Sluiceway does, crates waiting upstream, one flowing through the open gate and the destroy signs, was inside the closed `<details>` with the counts line. A reader who never clicked never saw a crate.

## Decision

- **The README's copy ends each line of a row that goes on in an indented line with `<br>`.** That is the break the issue renderer adds. `withHardBreaks` in `scripts/example-dashboard.ts` does it. It skips a line that already ends in `<br>` and the fold of a row's changes. A `<details>` line starts a block of its own in both renderers, so it needs none. The file at `assets/example-dashboard.md` stays the body as a scan writes it, with no `<br>` added, because it is what an issue holds.
- **The header picture and the counts line stay open, above the `<details>`.** Only the sections sit in the fold, from Deploying on. Record 0088 folded the example because the body is about 130 lines long, and that reason covers the rows, not a picture of 160 pixels and two lines of counts. The summary line now says `all 16 stacks and every section`, because the counts line right above it already gives the numbers.
- **The generator finds the example from the first centred paragraph under "What it looks like" to the end of its `<details>`** (`readmeExampleSpan`), so `bun run example` still changes the example and nothing else of the README.

## Considered

- **Two trailing spaces instead of `<br>`.** They make the same break in a README, but they are invisible in the file, and an editor or formatter trims them.
- **Swapping the top header for a pending picture.** It would show crates on the first screen without any change to the example, but it would lose the calm picture that stands for the product. It would also show a state that does not match the in-sync alt text.
- **Opening the whole example.** It would add about 130 lines to the front door, which the README's line budget exists to prevent.
