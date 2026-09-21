# The state images are twelve small files named by role, served from the exact release tag

> Amended by 0039 and 0040: there are sixteen files of 880 by 160, pending has three of the eight pictures, no file has a text element, and the `<picture>` is centered. Naming by role, one file per theme, the exact release tag and the 10 KB cap stay as they are here. Amended again by 0043: the plain files and their rule are gone, and four pictures exist once more with the destroy sign, as `<picture>-destroys-<theme>.svg`, which makes twenty-two files.

The rendering research fixed the mechanics: an animated SVG plays through `<img>`, a top level `<picture>` with a `prefers-color-scheme` source follows the reader's GitHub theme, images from `raw.githubusercontent.com` are not proxied, and a file must never change behind a URL because the raw host caches for five minutes. The owner confirmed by eye in the lab repo on 2026-09-21 that the images show, move and follow the GitHub theme, which closes the last open item of that research.

```
assets/mascot/<header state>-<theme>.svg

first-run-light.svg   first-run-dark.svg
in-sync-light.svg     in-sync-dark.svg
pending-light.svg     pending-dark.svg
deploying-light.svg   deploying-dark.svg
failing-light.svg     failing-dark.svg
plain-light.svg       plain-dark.svg
```

```md
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/sluiceway/sluiceway/<exact release tag>/assets/mascot/pending-dark.svg">
  <img alt="Sluiceway: changes are pending" width="440" src="https://raw.githubusercontent.com/sluiceway/sluiceway/<exact release tag>/assets/mascot/pending-light.svg">
</picture>
```

Files are named by role and not after Penny, so the names survive a redraw or a rename. One file per theme and not one file with a media query inside: a media query inside an SVG follows the operating system, while `<picture>` follows the reader's GitHub theme setting.

## Consequences

- Every file has `viewBox="0 0 440 120"` and is shown at `width="440"`, which scales down on a phone.
- Every file is one self-contained SVG: no script, no embedded or linked font, no raster image, no external reference. The serving policy blocks all of those anyway. The wordmark in final art is drawn as paths so it looks the same on every system. The concept files still use system font text.
- Animation is CSS or SMIL only. Every animated file turns its animation off under `prefers-reduced-motion: reduce`, and nothing blinks faster than once a second.
- `plain-*.svg` has no animation and no colour beyond GitHub's greys.
- At most 10 KB per file, checked in CI. The concept files are 0.8 to 4.5 KB. The cap forces clean, hand-made SVG and keeps the header instant on a phone.
- The ref in the URL is the exact release tag of the running action, or its commit SHA. Never a moving tag such as `v1`. A release therefore gets new URLs, and the first scan after an upgrade rewrites the header once.
- The images live in the public action repo, so they load for every reader, also on a private consumer repo. A private repo's images do render in its own issues for readers with access, through the `github.com/<owner>/<repo>/raw/<ref>/` form, which is how the lab issues were built.
