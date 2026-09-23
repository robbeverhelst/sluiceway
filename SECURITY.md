# Security policy

Sluiceway runs next to infrastructure credentials and can start deploys. Reports are taken seriously.

## Reporting a vulnerability

Do not open a public issue for a vulnerability.

Report it in private through GitHub: open the [Security tab](https://github.com/sluiceway/sluiceway/security) of this repository and choose **Report a vulnerability**. Only the maintainers can read the report.

Please include:

- what an attacker can do, and what they need in order to do it (for example: read access to the repo, permission to edit issues, write access)
- the steps to reproduce it, or a proof of concept
- the version or commit you tested

We aim to answer within 7 days. Once a fix is released, the advisory is published and you are credited, unless you ask not to be.

## Supported versions

Fixes go into the latest release of the current major version, which is 0.x (`v0`) until 1.0.0. The [releases](https://github.com/sluiceway/sluiceway/releases) list every version.

## What counts

These are the promises Sluiceway makes. A way to break one of them is a vulnerability.

- A deploy starts only from a tick by a named person who was allowed to tick that stack at that moment, or, for a stack the repo's own `sluiceway.yaml` sets to `deploy: on-merge`, from the scan of a push to the default branch. A change that deletes or replaces a resource, or that repairs drift, never deploys without a tick.
- A deploy changes only what the ticked row, or that scan, showed. If a fresh preview differs, nothing is deployed.
- Re-running a workflow job never deploys anything again.
- No property value leaves the tool's adapter. Values never reach the issue, comments, deployment records, job summaries or logs written by Sluiceway.
- Sluiceway never reads a credential by name, and never stores or sends anything from the environment.
- The infrastructure tool and the stack programs it runs never receive the GitHub token that Sluiceway was given.
- This repository's own release process: the committed `dist/` matches the source, and workflows pin third-party actions by commit SHA.

## What does not count

- A person with write access to the repository can change the workflow itself. GitHub Environments with required reviewers are the protection against that, and Sluiceway works with them.
- The dashboard shows resource types, resource names and property names to everyone who can read the issue. On a public repository that is everyone. The redact setting limits this. It is not access control.
- Deploys made outside Sluiceway, from a laptop or another pipeline, are allowed and are not detected.
