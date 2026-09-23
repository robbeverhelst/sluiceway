# OpenTofu and Terraform root modules are found when the repo's own files say so

> Amends 0053 (an OpenTofu stack is declared, never guessed). Built as slice 5.29, for issue 215.

A Pulumi repo needs no configuration: discovery finds its stacks from `Pulumi.yaml` and `Pulumi.<stack>.yaml`. A Terraform or OpenTofu repo had to declare every stack in `sluiceway.yaml` with `tool: opentofu` or `tool: terraform`, because record 0053 held that "a root module and a child module look the same on disk". That made a repo full of Terraform harder to start with than a repo full of Pulumi. Issue 215 asked for root modules to be found by themselves, and warned that a wrong answer is worse than none: rows for things that are not stacks, on the very first dashboard a new user sees.

A root module and a shared module do look the same to a tool that only lists `.tf` files. They do not look the same to a reader of the whole repo: the repo says which directories are modules when another directory calls them, and says which are roots when they choose where their state lives. This record settles what the files must say, what discovery does when they say less, and how a repo overrules it.

## Decision

**A directory is a root module when the repo's own files say so, not when a naming convention says so.** Discovery reads every directory of `*.tf`, `*.tofu`, `*.tf.json` and `*.tofu.json` files and asks, in this order, stopping at the first answer that leaves it out:

1. **Does a `stacks` entry with a tool name it?** Then it is that entry's, exactly as before, and discovery does not look further. A declared stack keeps its stack id, its options, its rows and its deploys, so no repo that declares its stacks today loses or changes one. This holds for an entry of any tool, and for a directory the entry declares in a workspace other than the default.
2. **Does another directory name it as a local module source?** A `module` block with `source = "../x"` or `"./x"`, in either syntax, from any directory of the repo, the declared ones included. This is the signal trusted most, because it is the repo stating that the directory is a module. It is read, not guessed.
3. **Does it sit under a directory named `modules`?** Both tools' docs put a repo's own modules there. The convention is honoured in one direction only: it can leave a directory out, and it is never evidence for one. Sitting next to a `modules` directory proves nothing.
4. **Does a `terraform` block hold a `backend` or `cloud` block?** Only a root module chooses where its state lives. A root module without one keeps its state in a file on the runner, which the job throws away, so a deploy from Sluiceway would create everything again on the next one. An empty `backend "s3" {}` counts, because the rest can come from the environment, and a `backend "local"` counts, because someone chose it.
5. **Is it built for one workspace?** Code that reads `terraform.workspace` (or `tofu.workspace`), or a `cloud` block whose `workspaces` picks by `tags`, runs in workspaces its files do not name. It is left out.
6. **Does a file choose something?** A `*.tfvars` file other than `terraform.tfvars` and `*.auto.tfvars`, or a `*.tfbackend` file, in the directory or in a subdirectory that holds only such files (the `env/dev.tfvars` layout Atlantis knows), is loaded only when a command names it. Which one a stack takes is the repo's to say, so it is left out.
7. **Do its files say which tool runs it?** A `.terraform.lock.hcl` whose providers come from `registry.opentofu.org` means OpenTofu, from `registry.terraform.io` Terraform. `.tofu` files mean OpenTofu, the only one that reads them. Files that name both, or neither, leave it out. The wrong binary can upgrade a state past what the other tool reads, so this is never defaulted.

**A repo with Terragrunt files finds no root module.** A `terragrunt.hcl`, `terragrunt.hcl.json` or `terragrunt.stack.hcl` anywhere in the repo turns the rule off for it. In such a repo the stacks are the units, and the modules they run commonly carry an empty backend block for Terragrunt's `remote_state` to fill, with sources built at run time (`${get_repo_root()}/modules/x`) that no reader of files can resolve. Signal 2 would miss them and signal 4 would pass them, so the rule would find exactly the wrong directories. Units keep their declarations with `wrapper: terragrunt` (record 0068).

**CDK for Terraform keeps its declarations too.** An app's stacks exist only in its program, and `cdktf.out`, which `synth` writes, is skipped with every directory whose name starts with a dot (`.terraform`, `.terragrunt-cache`) and `node_modules`.

**A found root module is one stack in the default workspace, and its stack id is its path.** No name, no var files, no `TF_WORKSPACE`: exactly the stack a `stacks` entry with only `path` and `tool` declares, byte for byte in its options, so it runs the code a declared stack runs. It is initialised once per directory, planned once with `-refresh=false -out` and deployed from the saved plan, as record 0053 settled. The default workspace is chosen because it is the only workspace files can name: every other lives in the backend, and discovery never asks one (records 0014, 0042). The id is unambiguous because a directory is either found, one stack with the id `path`, or declared, whatever stacks its entries give it, never both. A directory that runs in several workspaces is declared with one entry per workspace, and the first entry takes the directory over.

**`sluiceway.yaml` overrules discovery**, with keys it already has and one new switch:

- **Add a directory discovery missed:** a `stacks` entry with `tool`, as before.
- **Exclude a found directory:** `ignore`, by its stack id, which for a found root module is its bare path. With a `reason` it is listed under In sync, like every ignored stack (record 0051). A separate exclude list was not added: it would be a second way to do what `ignore` does.
- **Give a found stack settings:** a `stacks` entry without `tool`, as for a Pulumi stack.
- **Turn it off:** `discovery.rootModules: false`. Core takes `discovery` as a mapping of switches and the adapters say which switches exist, the way record 0053 split `tool` and `options`, so no tool word is written in core (record 0006). An unknown switch fails the config.

**The check shows it first.** The check lists every directory of OpenTofu or Terraform files with what discovery made of it: found, with the evidence (`a backend "s3" block in main.tf, and a lock file of OpenTofu providers`), left out, with the first reason, or declared, with the entry. It runs on pull requests (record 0077), so a pull request that adds a root module, or that bumps Sluiceway to this version, shows what the dashboard will get before it gets it. The table is in the summary and one line per directory is in the job log.

**On by default.** A repo that declares every stack today and holds a root module it did not declare gets a new row for it after this version, in sync or pending by what its plan says. That is the feature, not a move of an existing stack: every declared stack is unchanged. `discovery.rootModules: false` restores the old behaviour in one line, and the check shows the new rows on the pull request that bumps the version.

### Signals considered and not used

- **A lock file alone.** Module CI, `terraform validate` in a pre-commit hook and the tools' own tutorials initialise shared modules too, and some repos commit the lock file there. A lock file says which tool ran `init` in a directory, not that the directory is a root. It is read only for the tool.
- **A `.terraform` directory.** It is in every `.gitignore` template and never in the repo's files. It would make discovery depend on what ran before in the job, and the check, which reads a fresh checkout, would disagree with a scan in a job that ran `init` first.
- **`provider` blocks and `variable` defaults.** Shared modules have both: a module may configure a provider, and most give defaults. They are weaker than a backend block and add nothing once it is asked for.
- **A committed `terraform.tfstate`.** It would find roots with local state, which a deploy on a runner rewrites and loses, and the state file holds every value in plain text.
- **Atlantis's rule.** Atlantis (`server/events/project_finder.go`) filters the files a pull request modified by a glob, maps each to a directory, takes the parent of a directory named `env`, and for a path with `/modules/` takes the directory above `modules` when it has Terraform files, or nothing. Its auto discovery is on only while `atlantis.yaml` names no projects, and a configured project always wins. It never enumerates a repo: it only answers which directories a pull request touched, so being incomplete costs it nothing. Sluiceway's dashboard lists every stack, in sync ones included, so it needs a complete inventory, and a wrong guess is a permanent row for something that is not a stack. Its conventions are taken (the `env/` layout, nothing under `modules/` is a root, a declaration wins) and its approach is not. Its "on only while nothing is configured" was rejected too: adding one declaration for a directory discovery missed would silently turn discovery off for every other directory and take their rows away.

### What a repo would have to look like for the rule to be wrong

The rule prefers finding nothing to finding something that is not a stack, so most of its mistakes are misses, which the check names with the reason and a `stacks` entry fixes: a root module with local state, one another directory calls as a module (a test harness that wraps it), one with var files or several workspaces, one whose lock file was never committed, and every root module of a Terragrunt repo.

A false stack needs a directory that passes every question: not called by any directory of the repo, not under `modules/`, a backend or cloud block, one workspace, no var file of its own, and a lock file of one registry or `.tofu` files. That is:

- a shared module that other repos call by a Git address, with an empty backend block for its callers and a committed lock file from a validate run. Nothing in this repo calls it, so nothing says it is a module;
- a template directory that a generator copies to start a new root module, committed complete with a backend block and a lock file;
- a root module that was retired, whose infrastructure is gone, and whose directory stays in the repo. Its plan shows every resource as a create, a row nobody should tick.

Each shows in the check as found, with its evidence, and `ignore` or a move under `modules/` takes it off. A repo with many of them sets `discovery.rootModules: false`.

## Consequences

- Amends 0053: an OpenTofu or Terraform stack is declared, or found by this rule. "A directory of `.tf` files that no entry names is no stack, only files" now holds only for the directories the rule leaves out.
- The adapter interface gets an optional `explainDiscovery(root, config)`, which the check alone calls. `DiscoveryNote` in core holds a directory, its outcome and the adapter's words for why.
- `init` counts a found root module as a stack that is there, so the `sluiceway.yaml` it writes declares only the root modules discovery leaves out. What it declares for those is unchanged, and so is its workflow for a Terraform stack (`docs/later.md`, `init` for the Terraform family).
- Reading HCL needed no dependency: a small reader in the OpenTofu adapter follows blocks, labels, plain string attributes, comments, heredocs and templates, and gives up on nothing, reading less instead. The JSON syntax is read with `JSON.parse`.
- `docs/later.md` loses zero-config discovery for OpenTofu and the check's hint for a directory of `.tf` files no entry declares, and gains root module discovery part 2: several workspaces or var files per root, Terragrunt repos, and sources that are Git addresses of the same repo.
