# Documentation

The manual for Sluiceway. The [README](../README.md) is the short version.

## Setting it up

- [The workflow](workflow.md): the check, the whole workflow part by part, what one job gives up, merge and deploy, stack dependencies, self-hosted runners, GitHub Environments, and pinning a commit.
- [The split workflow](split-workflow.md): the same loop as four jobs, for credentials that only read in scans, an environment per stack and ticks on hosted runners.
- [Start read only](read-only-trial.md): a scan alone, with nothing that can deploy.
- [Example workflows](example-workflows.md): complete workflows for common setups.
- [Start with init](init.md): a first workflow and `sluiceway.yaml`, written from what it finds in your repo.
- [Configuration](configuration.md): every key of `sluiceway.yaml`.
- [Credentials](credentials.md): how credentials reach the tool, recipes, private registries, and your own tooling.

## Using it

- [Using the dashboard](using-the-dashboard.md): rows and ticks, reading the job log, and the limits.
- [Security](security.md): what a tick promises, and the three setups.
- [Notifications](notifications.md): the outputs and the result file, and recipes that tell people when something is pending or failed.
- [Reference](reference.md): the modes, the inputs, the outputs and the requirements.
- [What Sluiceway writes](what-sluiceway-writes.md): the markers in the dashboard, the deployment records and the result file, for scripts and agents that read them, and the rule for what may change.

## How it is built

- [The glossary](../CONTEXT.md): the words used here and in the code.
- [The roadmap](roadmap.md): what comes before 1.0 and what after.
- [Later](later.md): what was left out of v1, and why.
- [The onboarding log](onboarding-log.md): every hurdle a new user met, and what was done about it.
- [The build plan](build-plan.md): what is being built, in which order, and how it is proven.
- [The decision records](adr): where a record and the brief disagree, the record wins.
- [Acceptance](acceptance.md): the checklist that proves v1 against its first real user.
- [The brief](brief.md): the original project brief, kept as history. Do not build from it.
