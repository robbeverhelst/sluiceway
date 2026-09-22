# The header tells a delete from a replace, counts to twenty and shows a queue

Build plan slice 5.8 brings five lines of `docs/later.md` into the header and the lines around it: a sign of its own for a delete next to the replace sign, more than 12 exact crates, a header state for queued stacks, drifted rows in the destroy alert, and a rotating set of good-news lines. Each was left out of v1 for a reason those lines give: more files, a marker that could not tell a delete from a replace, a pick rule for the voice. This record says how each reason is met.

This amends 0009, 0032, 0043, 0047, 0062 and 0066.

## Decision

### Two signs on the pole

- **The amber triangle is the replace sign, and a delete gets a sign of its own**: an amber diamond with a dark cross, on the same pole, under the triangle. The triangle stays exactly where the destroy sign was. Red belongs to the jam's lamp (0043), so the delete sign differs by its shape, and a cross is what a person reads as "gone". With a delete alone, the pole starts at the diamond. Neither sign moves.
- **The files** are `<picture>-deletes`, `<picture>-replaces` and `<picture>-deletes-replaces`, each light and dark, for every counted picture. `-destroys` is gone. A file with signs still differs from the file without them by the signs and the alt text alone.
- **The rule** is the one of 0043, split: a known row of state `pending`, `deploying` or `queued` with a delete puts up the delete sign, and one with a replace puts up the replace sign. `destroySigns` in `src/render/destroy-sign.ts` computes both from the row markers.
- **The alt text** says which: `, some delete resources`, `, some replace resources`, or `, some delete or replace resources` for both, after the pending alt text, and with `some changes` in place of `some` after the other states, as before.

### A marker key for the split

- **`deletes="<n>"` follows `destroys`** on a row's marker: how many of its destroys are deletes. It is written whenever `destroys` is, `0` included, so a marker without it is one an older version wrote. The row warnings, the counts line and the destroy alert still count `destroys`.
- **An older marker counts its destroys as deletes.** It did not tell them apart, and the delete sign asks for the more care of the two. The next scan that previews the stack writes the key.
- **A deploying or queued row carries the key** from the marker it replaces, as it carries `destroys` (`resolve`, and a scan that has no preview of the stack), or counts it from the fresh preview (`apply`, and a scan that has one). A row copied from an older marker keeps not having it.

### Up to 20 crates

- **The maximum is 20**, then the overflow as before: the row of crates runs on past the left edge with a half crate. The alt text says `more than 20 stacks are pending`.
- **Crates 1 to 12 arrive as 0047 has them.** Crates 13 to 19 fill the seven free places on the second tier, and crate 20 sits on a third tier in the middle. The same count always gives the same picture.
- **The water keeps its five steps** (11 or more is the top one), and the fish follow the water (0047). A person does not count 17 crates on a phone. The picture says "a lot, and this many"; the counts line has the number.

### A header state for queued stacks

- **`queued` sits between `deploying` and `pending`**: `failing`, `deploying`, `queued`, `pending`, `drift`, `first-run`, `in-sync`. It applies when a known row is `queued` and none is `deploying`: a stack waits behind its dependencies and nothing is going out right now, typically between two layers (0056). A deploying row still wins, because the open gate is what the person is watching.
- **The picture**: the gate closed, the water, crates and fish of `pending-<n>` behind it, so the gauge tells the truth, and the ticked crate tied up at the gate with a short rope. Penny is awake and calm and looks at it. No puff and no splash: nothing pushes, it waits its turn. `queued-<n>` for n = 0 to 20 and `more`, with the signs, like failing and deploying (0066).
- **The alt text** is `Sluiceway: queued behind dependencies`, with the count and the signs as the others have them.
- **The counts line does not change.** A queued row is still counted with the deploying ones, and the header dot of `queued` is the deploying blue (slice 4.5).

### Drifted rows in the destroy alert

- **A drifted row deletes and replaces nothing.** Nothing waits from its code (0055), so its marker never had `destroys`. What the drift check can find that a person may not know of yet is a resource gone outside the code, the drift op `delete`.
- **So the alert names drifted stacks with a resource gone**, in a paragraph of its own in the same caution block, under the pending paragraph: `> 1 drifted stack has resources gone outside the code: **site:prod**`. The block still sits right above the pending list, which is right above the Drifted section. With nothing pending it sits under the line under the Pending heading.
- **A drifted row's marker gets `gone="<n>"`**, after `drift`, when its drift check found resources gone. It is left out at 0. The alert reads it, as it reads `destroys`, and nothing else does.

### Three good-news lines

- **The warm good-news line is one of three**, by the day of the scan the body shows: the UTC day number of the root marker's `scan-at`, counted from 1970-01-01, modulo 3.
  1. `Gate closed, water calm. Nothing to deploy.`
  2. `Level water on both sides of the gate. Nothing to deploy.`
  3. `Still water upstream. Nothing to deploy.`
- **Each keeps the rules of 0032**: one water image, then the fact, no number, no first person, no exclamation mark, no emoji. The dry line does not rotate.
- **The pick rule keeps the body a pure function of its inputs** (0004): the day comes from the root marker, which every writer carries, so `resolve`, `apply` and `settle` write the line the scan wrote, and the same scan day gives the same body. A scan time that does not parse gives the first line.

## Consequences

- **702 header files**: 21 pending, 22 failing, 22 deploying and 22 queued pictures, each plain and with the three sign variants, and first run, in sync and drift, each light and dark. With the spinner, 704 files in `assets/mascot/`, 6.1 MB, and about 320 KB gzipped, because the files differ in few bytes. Only one header file is fetched per view.
- **The cap holds.** The water is now drawn once per wave shape and placed with `<use>`, and each side of the channel has one clip, which saved about 700 bytes a file and renders pixel for pixel as before. The fullest file is `deploying-more-deletes-replaces-dark.svg` at 9,877 of 10,240 bytes.
- **Every pending row with a destroy gets one more marker key** (about 12 characters), and a drifted row with a resource gone one more. The size budget measures the real body, as always.
- **A dashboard written before this version** shows the delete sign for any destroy until its next scan, because its markers do not tell deletes from replaces. That errs on the side of care.
- **A dashboard with nothing pending changes its good-news line once a day** on the next write, so a scheduled scan writes one different body a day where it wrote none. `dashboard-changed` is `true` for that scan.
- **The README's example dashboard** names `pending-4-deletes-*.svg` at its example tag, which has only the older files, until the example tag moves to a release that has them.
- The generator is `polish.mjs` on the `prototype/header-polish` branch of the private lab repo. It writes all 702 files: first run, in sync and drift byte for byte as `prototype/header-counts/counts.mjs` writes them, and every counted picture new. Lab issue 62 holds one contact sheet per state, the three sign variants side by side, phone-width previews and the animated files in both themes.

## Rejected

- **One sign that changes shape** (the triangle for a replace, the diamond for a delete, and the diamond alone when both). It hides a replace behind a delete, and "both" is common in a real repo.
- **A second pole between Penny and the wordmark** for the delete sign. The downstream water, the rush and the flowing crate pass there, and the space low on the downstream side is the drift state's (0043).
- **A rising water level up to 20.** Five steps are what a reader can tell apart (0047). More steps would need a taller gauge and say nothing the crates do not.
- **Queued as a picture without crates.** A queued header can hold pending rows, and the header never shows a wrong count (0066).
- **Counting drifted rows as destroys.** A drifted row's preview shows no change from the code, so there is no delete or replace to count. The delete sign and the counts line's warning stay with pending, deploying and queued rows.
- **A random or per-scan pick of the good-news line.** The same input must give the same bytes (0004), and a line that changes on every scan would make every scan write the body.
