# Redact strips the issue, not the summary, and the hash still covers the whole diff

> Amended by 0052: redact also turns `dashboard.showValues` off, so no value is read or hashed. In a repo with a list, turning redact on or off therefore gives the rows that showed a value a new hash once, and a tick on such a row is refused as moved.

With no values shown (0021), what is left on a row is names: resource types, resource names and property names. Some teams do not want those in an issue either, mostly on public repos. `dashboard.redact: true` is for them. A redacted row shows the stack id, the counts by op, the destroy warning, the failure line and the links. It has no "Show changes" block, so no resource type, resource name or property name appears in the issue.

Redact is about reach, not about access. An issue body is emailed, sent to integrations, indexed on a public repo and kept in edit history. A job summary sits behind a click and expires with the run. But whoever can read the repo can open the run, and the code that names the resources is in the repo as well. So redact does not hide anything from a reader who goes looking, and the docs must say exactly that. It is not access control.

That is why the job summary stays full under redact. Stripping it too was rejected: the ticker would approve bare numbers with no way on GitHub to see what is behind them, and the only thing gained is hiding names from people who can already read them in the code.

The diff hash on a redacted row still covers the whole diff. Hashing only what the row shows, the counts, was rejected: deleting the database and deleting a test bucket would both hash as one delete. This amends 0008, whose title says the hash covers no more than the row shows. The rule that matters is the other half, and it stays whole: the renderer shows nothing that is not in the hashed diff. Under redact the hash covers more than the row shows, which is the safe direction. The ticker approves the full diff as the summary shows it, and the row links there.

## Consequences

- `dashboard.redact` is one boolean for the whole dashboard, default `false`. There is no per stack setting in v1, and no middle level such as types without names. Both can be added without a breaking change.
- Redact changes the renderer only. The diff, the hash, the markers, discovery, `resolve` and `apply` are the same with and without it. Turning it on or off never voids a tick.
- Stack ids stay. They are paths in the repo and the row cannot work without them. Attribution to merges stays as well.
- A redacted row that contains a replace or a delete still carries the warning and the counts that caused it. Redact never makes a destroy quieter (0024).
- A redacted row links to the scan run's summary in the place where the details block would be, so the path from "what is this" to the answer is one click.
- 0008 rejected putting a digest of values in the issue because a low-entropy value can be guessed offline. The hash on a redacted row is a digest of names, so the same attack can confirm a guessed set of names. We accept that: those names are in the repo's code, which the same reader can open, and 16 hex characters over a whole diff confirm a guess only when every address, op and key is guessed right at once.
- Comments follow the same rule. With redact on, a comment from Sluiceway names the stack and links to the run, and never lists resources.
- Deployment records are not affected. They never held anything from the diff but its hash (0003).
