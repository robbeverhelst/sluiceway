# The failing and deploying pictures show one crate per pending stack too

Record 0047 gave pending one picture per crate count, and kept failing and deploying at one picture each: the jam with two crates floating behind it, and the open gate with three crates passing through. On 2026-09-22 the owner saw a dashboard with nine pending stacks and one failed preview, and the jam showed two crates: "on failed preview there should also be the versions with the correct amount of packages" (onboarding log, hurdle 26). Build plan slice 4.15 brings the count to every state.

This amends 0033, 0043, 0047, 0055 and 0059.

## Decision

- **One count for every state.** The crate count is the number of known rows of state `pending`, 0 to 12, and `more` above 12, as 0047 has it. It now picks the file in the pending, failing and deploying states alike. A pending header always has at least one; failing and deploying can have 0.
- **The files are `failing-<n>` and `deploying-<n>`** for n = 0 to 12 and `more`, each light and dark, and each once more with the destroy sign. `failing` and `deploying` without a count are gone.
- **The jam holds back what waits.** `failing-<n>` has the water, the crates and the fish of `pending-<n>` behind the jam, so the gauge on the wall still tells the truth. With 0 the water is at the lowest step, with no crate and no fish. Penny is stuck, not bursting, so there is no splash at the top step.
- **The open gate lets the water run.** `deploying-<n>` keeps one water level at every count, and so keeps the two fish of the 0047 amendment. The waiting crates queue upstream in the order of 0047, and one crate flows from the queue through the gate and off downstream, in place of the three that passed from the left edge. Under reduced motion it stands just past the gate.
- **The destroy sign on the jam too.** Failing gets the sign from the same rule as pending and deploying: a pending or deploying row with a destroy. 0043 left it off because the jam already says a person is needed. With a count on the jam, a picture without the sign would say less than the pending picture it replaced a moment ago.
- **The alt text says the count.** `Sluiceway: something failed, 9 stacks are pending` and `Sluiceway: deploying, more than 12 stacks are pending`. With 0 it stays `Sluiceway: something failed` and `Sluiceway: deploying`, because the picture shows no crate. With the sign, `, some changes delete or replace resources` follows, the fact deploying already had. Each file's own label says the same.
- **Drift stays one picture.** Its header state applies only when no row is pending (0055), so its count is always 0, which the drift picture already shows. Thirteen more drift pictures, and fourteen more with a sign that no drift header can show, would never be served.

## Consequences

- There are 170 header files: 13 pending, 14 failing and 14 deploying pictures, each with and without the sign, and first run, in sync and drift, each light and dark. With the spinner, 172 files in `assets/mascot/`. Only one is fetched per view.
- The fullest file is `deploying-more-destroys-dark.svg` at 10,151 of 10,240 bytes. The crate and the fish are drawn once per file and placed with `<use>`, and the flowing crate is one more `<use>` of the same crate, which is what keeps twelve waiting crates and the rushing water under the cap.
- The failing picture no longer looks the same on every failing dashboard, and a failed preview in a repo with nothing pending shows a jam with low water. The red lamp, the log, the worried face and the broken trickle downstream are in every failing picture.
- A dashboard's header file name changes when its pending count changes under failing or deploying, as it already did under pending. The URLs change with every release anyway (0033).
- The generator is `counts.mjs` on the `prototype/header-counts` branch of the private lab repo. It writes all 170 files: pending, first run and in sync as `prototype/header-fish/fish.mjs` writes them and drift as `prototype/header-drift/drift.mjs` does, byte for byte, and the new failing and deploying files. Lab issue 61 holds one contact sheet per state, the animated files in both themes and a phone-width preview.

## Rejected

- **The water rising with the count behind the open gate.** Water that rises behind a gate that is open reads as a gate that does not work, and upstream would stand lower than downstream at the first step.
- **The three passing crates kept.** They start at the left edge and would pass through the waiting queue. One crate that leaves the queue says the same with fewer bytes.
- **A count on the drift picture.** See above: it is always 0.
- **Counting deploying, queued or failed rows as crates.** A crate is a stack that waits for a tick. The counts line has the other numbers.
