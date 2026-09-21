# `dashboard.personality: false` removes the image and the voice

> Amended by 0043: the plain header is gone, so it is no longer a reason the switch is nearly free. The dry lines are. The switch and everything it does stay as they are here.

The map listed an off-switch for the personality as not yet specified. It is in v1, because it is nearly free: the plain header and the dry lines must exist anyway for dashboards with a delete or replace (0031, 0032).

```yaml
dashboard:
  personality: false   # default true
```

Off means no header image at all and the dry lines everywhere. Keeping the plain image as a fixed header was rejected. The switch also has to serve places where the image cannot load, such as GitHub Enterprise Server or a locked-down network without `raw.githubusercontent.com`, and teams that want no fetch from another repo in their issue. A broken image icon at the top of the dashboard is worse than no header.

Shipping without a switch ("Penny is the product") was rejected. The default is what makes Sluiceway opinionated. A team that cannot or will not show a mascot should still be able to use the tool.

## Consequences

- With the switch off the body has no `<picture>` block. The root marker is followed directly by the counts line.
- With the switch off the good-news line and the first-run line use the dry strings of 0032. Nothing else changes, because nothing else has a voice.
- It is one boolean for the whole dashboard, like `dashboard.redact` (0023). A finer switch (image without voice, or the reverse) and a custom header image are left out of v1 (later.md).
- The switch changes only what the pure render function emits outside the row blocks (0009). Row blocks, markers and hashes are the same either way, so flipping it needs no scan: the next writer re-renders the header.
