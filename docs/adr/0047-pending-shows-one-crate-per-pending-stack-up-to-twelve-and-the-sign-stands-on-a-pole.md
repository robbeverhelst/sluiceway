# Pending shows one crate per pending stack up to twelve, and the destroy sign stands on a pole

> Amended by 0075: the maximum is 20 crates, then the overflow. Crates 13 to 20 go on a second and a third tier. The water keeps its five steps.
>
> Amended, 2026-09-22: small fish swim upstream of Penny, one per water step up to four, and two in the deploying picture.
>
> Amended by 0066: failing and deploying show one crate per pending stack too, from 0 to 12 and more, each with and without the sign. Deploying is no longer one picture.

Record 0039 gave pending three pictures, picked from the pending count, with 1, 3 and 6 crates. The owner looked at the header on a real dashboard with 14 pending stacks on 2026-09-21 and asked for three things: as many crates as there are pending stacks, a maximum beyond which the crates run on off the picture, and the warning sign further right. Record 0039 had rejected one crate per stack because it needs a file pair per count and says nothing above the cap. The files turned out small, only one is fetched per view, and the picture past the cap does say something: more than the cap.

The pictures were drawn from the header generator and judged on rendered issues in the private lab repo, in light and dark and at phone width (lab issues 50 to 52).

## What was decided with the owner

| Question | Answer |
|---|---|
| Which edge does the row run off? | The left edge, upstream, where the crates queue behind the gate. The right edge is downstream, where crates have already gone through. |
| The maximum | 12. One row fits about 10 crates at 880 wide, so some crates are stacked on two others, which also makes the row look less even. At a phone's 358 pixels a crate is about 9 pixels wide and the count still reads. |
| Does the water still rise with the count? | Yes, in five steps: 1 or 2, 3 or 4, 5 to 7, 8 to 10, 11 or more. Three was too few, one step per crate too many to tell apart. The gauge on the wall has one amber mark per step. |
| Past the maximum | The row of 12 goes on with a half crate cut by the left edge. A pile running off the edge as well was busier and said nothing more. |
| Does deploying show how many still wait? | No. Deploying is about what moves now, crates waiting behind an open gate read oddly, and the counts line has the number. It stays one picture. |
| The alt text | It says the number, because the picture does: `Sluiceway: 1 stack is pending`, `Sluiceway: 4 stacks are pending`, and past the maximum `Sluiceway: more than 12 stacks are pending`. With the sign, `, some delete or replace resources` follows, as in 0043. |
| Where does the destroy sign go? | On a pole standing in the water, right of the wordmark, with the triangle up at the coping. The owner asked for a pole. A sign painted right of the wordmark, and a pole at the far right in the reeds, were the other two. |

This supersedes the three pending levels of 0039 and amends 0043 and 0038. The file rules of 0033 and 0039, the 10 KB cap, and everything else in 0043 stay.

## Consequences

- Pending has thirteen pictures: `pending-1` to `pending-12` and `pending-more`. With the destroy sign, each light and dark, that is 52 files. With `deploying`, `deploying-destroys`, `failing`, `first-run` and `in-sync` there are 62 files in `assets/mascot/`.
- The crate count is a pure function of the row markers, like the header state: the number of known rows of state `pending`, and `more` above 12. It picks the file only when the header state is `pending`. It replaces the pending level.
- The picture never shows more crates than there are stacks waiting, and up to 12 it shows exactly as many. The counts line under it still has the number.
- Crates arrive in a fixed order: three in a row from the gate, the fourth on top of the second and third, then four more in the row, the ninth on top, then the last three in the row. The same count always gives the same picture.
- Penny swells against the water from the second step on, and bursts with a splash at the fifth, as she did at the top level of 0039.
- The gauge has five marks in every picture, also where the water is level, because the wall is the same wall.
- The destroy sign is a triangle on a grey pole that stands in the water downstream, right of the wordmark and left of the reeds. It still does not move, and a file with it still differs from the file without it by the sign and the alt text alone. The space low on the downstream side right of the gate stays free for the drift state.
- The crate is drawn once per file and placed with `<use href="#k">`, which points inside the file, so twelve crates fit under the cap. The fullest file is `deploying-destroys-dark.svg` at 9,787 of 10,240 bytes, the fullest pending file `pending-more-destroys-dark.svg` at 9,553.
- Every header file changes once, for the five gauge marks and the moved sign. Their URLs change with every release anyway (0033).
- The generator and the lab issue bodies are on the `prototype/exact-crates` branch of the private lab repo. Its `crates.mjs` writes the 62 shipped files as they were before the fish (see the amendment).

## Amended, 2026-09-22

The owner asked for "a couple small fish on the left side when the level increases." Small fish now swim in the water upstream of Penny, and there are more of them as the water rises. They were drawn from the header generator and judged on a rendered issue in the private lab repo, in light and dark and at phone width (lab issue 59).

| Question | Answer |
|---|---|
| How many fish? | One per water step, up to four: 1 at the first step, then 2, 3, 4, and 4 at the fifth. The fish follow the water step, not the crate count, so a reader does not need to count them. |
| From the first step? | Yes. No fish at the lowest water was the other option. |
| Which colour? | Light teal, the foam colour, in both themes. Copper blended into the row of crates. |
| In the deploying picture too? | Yes, two fish upstream while the gate is open. Deploying is still one picture. |
| Do they move? | Each fish drifts slowly back and forth, 14 pixels over 7 seconds, and stands still under `prefers-reduced-motion`. |

- A fish is an oval and a tail, about 17 by 8 pixels at 880 wide. It faces upstream, holding against the current, and sits at least 13 pixels under the surface, below the crates. The same count always gives the same picture.
- The fish is drawn once per file and placed with `<use href="#f">`, like the crate. The fullest file is now `deploying-destroys-dark.svg` at 10,142 of 10,240 bytes, the fullest pending file `pending-more-destroys-dark.svg` at 10,046. There is little room left, so final art that adds more asks the owner for a higher cap (0039).
- The alt texts stay as they are. The fish add no fact: the number of stacks is in the alt text already.
- A file with the destroy sign still differs from the file without it by the sign and the alt text alone. `failing`, `first-run` and `in-sync` have no fish and are unchanged.
- The generator and the lab issue body are on the `prototype/header-fish` branch of the private lab repo. Its `fish.mjs` writes the 62 shipped files, and without fish it writes the files of `crates.mjs` byte for byte.
