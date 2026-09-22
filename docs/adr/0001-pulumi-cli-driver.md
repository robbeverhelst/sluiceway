# Drive Pulumi through the CLI, not the Automation API

> Amended by 0055: `refresh --preview-only --json` names a drifted property only in its engine events, so the drift check streams them (`PULUMI_ENABLE_STREAMING_JSON_PREVIEW=true`). The research's claim that the one JSON document turns such a step into an `update` did not hold on v3.229.0 or v3.263.0. The lock-free check on the minimum version is recorded.

The Pulumi adapter shells out to the `pulumi` CLI with `--json` and parses the output with a schema. The Automation API was rejected: it still needs the CLI on PATH, it bundled to 13.9 MB against a few hundred bytes for a CLI wrapper, and its `preview()` result has no per-resource steps, which the row counts and the hash need. A later OpenTofu adapter can only be CLI-driven, so this keeps both adapters the same shape.

Sluiceway does not install Pulumi. The user installs it in a workflow step before Sluiceway, so they control the version.

## Consequences

- Minimum supported CLI is v3.229.0, checked on startup with `pulumi version`. An older or missing CLI is one clear error that names the found version, the required version and the fix. No warn-and-continue, no version branches in the code. The floor comes from two facts: exit codes are only distinct from v3.226.1, and `refresh --preview-only` stops taking the stack lock in v3.229.0.
- We own the parsing. `detailedDiff` is null on create, replace and delete steps, so changed keys fall back to `replaceReasons` and `diffReasons`. Step order varies between identical runs, so steps are sorted before hashing.
- Adapter tests parse recorded real CLI output, never hand-written fixtures.
- Known CLI traps: a preview can create a missing stack config file, and `--expect-no-changes` on `up` and plain `refresh` checks only after the operation ran, so it is not a guard.

Research: https://github.com/sluiceway/sluiceway/blob/research/pulumi-cli/docs/research/pulumi-cli.md
