# Three marker kinds, a trailing row marker, and a body that is regenerated around its row blocks

Record 0004 made the body a cache of row blocks and said each block's marker carries stack id, hash and row state. This record fixes the format. It has to let drift rows and "queued behind X" arrive later without a breaking change.

> Amended by 0027: the row marker gains two optional display cache keys after `hash`, `destroys` and `failed`.
>
> Amended by 0028 (settled while building slice 1.8): a third optional display cache key follows them, `shortened`, the level of a shortened row.
>
> Amended by 0035 (settled while building slice 2.6): `settle` does not write the body. It starts a full scan, which writes the rows of the stacks whose records it ended.
>
> Amended by 0056: the `queued` state is used, placed and counted with deploying rows. `resolve` reads a dependency's row state to refuse a tick while it is pending, the one exception to "no mode decides anything from it", and it can only hold a deploy back.

Markers are HTML comments in one namespace, `sluiceway:<kind>`, with `key="value"` pairs. There are three kinds in v1:

```md
<!-- sluiceway:dashboard v="1" scan-sha="294bbc0..." scan-run="1234567890" scan-at="2026-09-20T06:00:12Z" -->

- [ ] **apps/grafana:prod** · `+2 ~1 -0` · [preview](run-url) <!-- sluiceway:row stack="apps/grafana:prod" state="pending" hash="3fa9c1e2aabbccdd" -->
  (attribution, details, failure line)
  <!-- /sluiceway:row -->
- **apps/loki:prod** · deploying · [run](run-url) <!-- sluiceway:row stack="apps/loki:prod" state="deploying" -->
  <!-- /sluiceway:row -->

- [ ] Rescan all stacks <!-- sluiceway:rescan -->
```

The open row marker sits at the end of the row's first line. Renovate's placement, directly after the checkbox, was rejected after a render test: on a row with no checkbox the line would start with the comment, GitHub reads that as an HTML block, and the rest of the line shows as literal `**apps/loki:prod**`. A marker on its own line under the row also renders, but then a tick needs two lines to parse and a block starts one line before its own marker. At the end of the first line, one placement serves every row and a tick is one regex on one line, anchored on the box at the start and the marker at the end. The visible text between them is never parsed.

JSON and base64 payloads were rejected. JSON needs the same escaping plus nested quotes, and base64 is opaque in the raw body and a third larger. With pairs, an id such as `apps/grafana:prod` reads as itself.

## Consequences

- A row block is every line from the one holding the open marker through the one holding `<!-- /sluiceway:row -->`, which is the row's last line, indented, with no payload. "Until the next marker" was rejected as the end of a block, because moving the last row of a collapsed section would take the closing `</details>` with it. The cost is about 25 characters per row.
- Values are percent-encoded as UTF-8 bytes with upper case hex: `%`, `"`, `<`, `>`, and every byte up to `0x20` plus `0x7F`. Nothing else. A value can then never close the quote or the comment. A render test showed `--` inside a comment is harmless.
- Row keys are written in the order `stack`, `state`, `hash` (then `destroys`, `failed` and `shortened`, see the notes at the top), and root keys in the order `v`, `scan-sha`, `scan-run`, `scan-at`, so output stays byte-identical. Parsers do not depend on order. Line endings are normalized to `\n` before parsing.
- The row state is a cache for placing and counting rows. No mode decides anything from it. `resolve` acts on a row when its box is ticked, discovery knows the stack id, the stack has no open deployment and the ticker is authorized. `apply` deploys only if a fresh preview still gives the hash on the row. A wrong state can at worst misplace a row until the next scan.
- The v1 states are `pending`, `deploying`, `in-sync` and `preview-failed`, in this precedence: an open deployment gives `deploying` whatever the preview says (0003), else a failed preview gives `preview-failed`, else a diff that is not empty gives `pending`, else `in-sync`.
- One rule makes additions safe. Every writer ignores marker kinds and keys it does not know, carries a row whose state it does not know through byte for byte, never acts on a tick on such a row, and leaves it out of the counts it knows. Such a row is placed in a plain list at the end of the body. This can only happen after a downgrade.
- Drift later adds the state `drift` for a row with drift only, and a key on the row that says the hash includes drift, so `apply` checks drift again before it compares (0008). A stack never has two rows. "Queued behind X" later adds the state `queued`. The fact itself is a deploy fact: a deployment record with status `queued` and the blocking stack ids in its payload (0003). A `behind` key on the row would only be a display cache. None of this changes the version.
- The body is a function of the root facts, the row blocks and the deployment records. `resolve`, `apply` and `settle` parse only the root marker and the row blocks, swap their own blocks, and regenerate everything around the blocks with the renderer the scan uses: header, counts, mascot state, section headings, empty section copy, recently deployed, footer. Nothing outside a row block is patched or carried through.
- There are no section markers. A section is the set of row blocks whose state maps to it, sorted by stack id. Sections can be reordered, renamed or restyled without touching this format.
- The root marker is the first line of the body. It carries the format version and the scan facts the header shows, because writers other than `scan` have no scan of their own to take them from. New header facts are new keys.
- The version is one integer, on the root marker only. Rows carry none, since every scan rewrites all of them. It changes only when an older parser would misread the body, never for a new key, state or kind. A `resolve`, `apply` or `settle` that meets a version other than its own does not touch the body. `resolve` dispatches a scan, which regenerates the body in its own version and clears the outstanding ticks with the note from 0005. Deploy safety is not involved, because it never rested on the body.
- The dashboard is found by label, root marker and author together.
- A bare issue or pull request reference never sits on a row's first line, because GitHub ticks a task that references an issue when that issue closes. Attribution goes on a line inside the block.

Research:
- https://github.com/sluiceway/sluiceway/blob/research/renovate-dashboard-mechanics/docs/research/renovate-dashboard-mechanics.md
- https://github.com/sluiceway/sluiceway/blob/research/issue-body-rendering/docs/research/issue-body-rendering.md
