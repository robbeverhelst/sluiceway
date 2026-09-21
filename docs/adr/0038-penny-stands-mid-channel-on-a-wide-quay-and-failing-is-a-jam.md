# Penny stands mid-channel on a wide quay, and failing is a jam

> Amended by 0047: the gauge staff has one amber mark per water step, five in all, and pending shows one crate per pending stack up to 12.

> Amended by 0043: there is no plain picture any more. When a pending or deploying row has a delete or replace, the pending or deploying picture carries the destroy sign: an amber warning triangle painted on the wall downstream, between Penny and the wordmark.

The first header (0030, 0033) was 440 by 120 and sat left-aligned in an issue column about twice as wide. Penny took the left third, the wordmark the middle, and the right third was empty apart from a thin waterline. The picture said which state the dashboard was in and nothing more. The owner asked for a header that is impressive, fun and useful, and in brand.

Three wide headers were drawn as animated SVGs and judged on rendered issues in the private lab repo, in light and dark and at phone width, on the 58 stack dashboard: a flat cutaway where pending is a water level, the same cutaway where pending is a row of crates, and a quay scene with both. All three put Penny in the middle of a channel that crosses the whole picture. Upstream is on the left, where water piles up while changes are pending. Downstream is on the right, where it rushes while deploying and lies calm when in sync.

The quay won. A brick quay wall runs behind the water from edge to edge, with a strip of sky above it. The wall fills the upper half that the flat versions left empty, gives the water level something to be read against, and gives the wordmark a place that belongs to the scene: it is painted on the wall, downstream. The flat cutaways were rejected as too bare to be worth a screenshot. A wordmark in a top corner was rejected because it floats over the scene as a label.

This amends 0030 and 0031. Penny herself, her name, the colour pair and the signal colours stay as 0030 has them. The six header states and their order stay as 0031 has them.

## Consequences

- The picture is 880 by 160 and is centered in the issue (0039 has the file rules, 0040 the markup).
- Penny faces the reader in the middle of the picture: two posts, a crossbeam with the hand wheel, the plank panel with the face. The channel is seen from the side. That is not how a gate and a channel line up in real life, and it reads at once.
- When in sync the water is level on both sides of the closed gate. Level water is the picture of in sync: nothing is held back.
- When pending the water upstream is higher than downstream and crates float on it. How high and how many is 0039.
- When deploying the panel is lifted, the wheel turns, water rushes under it with foam on the surface downstream, and crates pass through.
- Failing is a jam: the panel is stuck half open over a log, Penny looks worried, the red lamp blinks, and downstream is a broken trickle. This replaces the gate that hung crooked in its frame. A jam says something is stuck and needs a person, a crooked gate said the gate is angry. The alt text stays `Sluiceway: something failed`.
- On a first run the gate is open over a dry bed.
- Plain is the same scene in GitHub's greys: closed gate, no face, flat water, no sun or moon, no motion.
- The wall has a gauge staff painted on it upstream, with one amber mark per pending level. It replaces the gauge on Penny's post.
- Water moves downstream, left to right, in every file. Crates, foam and the duck move the same way.
- The motion is: water surfaces, Penny blinks about every five seconds, the wheel turns only while deploying, ripples spread downstream, clouds drift slowly, crates bob, and the rubber duck still drifts by when in sync. All of it is off under `prefers-reduced-motion` (0033).
- The sky strip holds far hills, two clouds, and a sun in the light files or a moon and stars in the dark ones.
- The space right of the gate, low on the downstream side, is kept free. The drift state (later.md) will show water seeping through the closed gate there.
- The wordmark is drawn as paths, which closes the known gap of 0033. The outlines come from Inter ExtraBold, under the SIL Open Font License 1.1. No font file is in the repo or in any image. Inter was chosen over rounder faces because it is the smallest as paths, about 1.7 KB, and sits closest to the text around it on GitHub.
- Two line weights are used throughout, 2.4 and 1.6.
- The files are still generated concept art, and final art may redraw every shape (0030). The generator, the two rejected versions and the first round of all three live on the `prototype/mascot-v2` branch of the private lab repo. Lab issues 25 to 36 are the three versions, 37 to 41 the chosen one.
