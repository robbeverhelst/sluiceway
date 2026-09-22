# The check suggests inputs, asks the backend on request, and reads the rest of the workflow

> Amended by 0077: for a job in auto mode the check asks for one concurrency group with `queue: max` and no `cancel-in-progress`, and no status check or second apply job.

Record 0042 made the check a pass over the repo's files with no credential, no tool and no GitHub call, and record 0061 added the workflow files. Three things stayed with the person, and the first real trial caught each of them by hand: a stack file with no stack in the backend became a red row on the first dashboard (onboarding log, hurdle 9), a program that read a shared file had to be given it as an input by someone who knew, and a workflow could lack a concurrency group, a status check or the second apply job of merge and deploy and run without an error until the day it mattered. Build plan slice 5.7 brings them into the check.

This amends 0042 and 0061.

## Decision

### Inputs from what a stack's files name

- **The check lists the files and directories that a stack's own files name as read and that the stack does not claim**, and gives one ready-to-paste block of `stacks` entries that adds them as `inputs`. It never applies a suggestion. Inputs of several entries add up (slice 1.2), so a pasted entry loses nothing and can sit next to the entries the file has.
- **What counts as named**, read from the files alone through a new optional adapter method, `readsFiles`, that never starts the tool:
  - Pulumi: a YAML program's `fn::readFile`, `fn::fileAsset` and `fn::fileArchive`, with `${pulumi.cwd}` as the program's directory; and a plain value of the stack's config, or a default or value of the project's config, that is the path of a file or directory of the repo from the project's directory. A value under `secure`, or a project value marked `secret`, is never read. Any other interpolation is only known at run time and is left alone.
  - Helm: the stack's local chart and its values files, from its `stacks` entry.
  - OpenTofu and Kubernetes manifests stacks name nothing yet (docs/later.md).
- **Only paths that are there and inside the repo count**, so a config value that merely looks like a path, such as `a/b`, is a value like any other and never shows. What the check prints is the repo path the value names, which is a name Sluiceway derived from the repo's files, as 0042 allows.
- **A file becomes a warning when a push that changes it would not preview the stack**: another stack claims it, or `scan.unrelated` covers it. Otherwise such a push is a full scan today, which previews the stack anyway, so the suggestion is a line and not a warning.
- **The glob is exact**: a file as itself with every glob character escaped, a directory as `<dir>/**`. One entry per path when all its stacks read the same, else one per stack with its name.

### The backend, on request

- **A new input, `backend`, `check` only, `false` by default.** With `true` the check asks the backend which of the stacks that have a row it holds, with the environment of its job minus `INPUT_*` (0013), which holds whatever credentials the workflow loaded before the step. Every other mode refuses `backend: true`, as they refuse `dry-run: true`.
- **A new optional adapter method, `findInBackend`.** Pulumi answers with one `pulumi stack ls --json` per project directory, which lists that project's stacks, reads the backend, changes nothing, takes no lock and needs no passphrase (recorded on v3.229.0 and v3.263.0). A name listed as `organization/project/stack` is matched on its last part. The other adapters give no answer, and their stacks are listed as not checked.
- **What it finds is a warning, never a red job.** A stack the backend does not hold is a warning each, and one ready-to-paste `ignore` block keeps the entries `ignore` has and adds each such stack as a glob that matches only its id. A directory the tool could not be asked about is a warning each for its stacks, with a reason from the fixed list of 0022, and the tool's own words go to the job log alone. The red job stays the verdict of 0042.
- **The time limit of one question is 10 minutes**, the default of `preview-timeout`. The check takes no `preview-timeout` input, and listing stacks is far quicker than a preview.
- **The check job still cannot reach the process runner by itself.** The dispatcher hands it what asks the backend, and the job uses it only with `backend: true`. The import walk of 0042 holds for the check job's own imports, and a test proves the part that is handed in reaches no GitHub API. A dynamic import was tried first: the bundler then wraps every module it shares with the other modes in a lazy initializer, which rewrites the whole bundle and changes when the other modes' modules run.

### The rest of the workflow

Read as text, like the rest of 0061, and a warning only where the text plainly lacks something:

- **Concurrency.** A scan or `resolve` job with no concurrency group. An `apply` job with none, with a group that does not name `matrix.stack`, without `queue: max`, or with `cancel-in-progress: true`. A group's name is not checked: `sluiceway-scan` is the docs' name and nothing reads it.
- **Status checks.** An `apply` job whose `if:` has neither `!cancelled()` nor `always()`, and a `settle` job whose `if:` has no `always()`: `!cancelled()` skips settle for exactly the cancelled deploys it exists for.
- **settle waits for every apply job**, both of them with merge and deploy.
- **The second apply job.** With `mergeAndDeploy.authors` set, a file with a scan and `resolve` needs an `apply` job whose matrix comes from `needs.<scan job>.outputs.matrix`, and that scan job needs a `matrix` output.

## Considered

- **Suggesting inputs from the code of a program in TypeScript, Python or Go.** A path built at run time cannot be read from a file without running it, and a guess would suggest the wrong file. Left out (docs/later.md).
- **The backend check on by default.** It needs credentials, and the check's promise is that it is safe on a pull request from a fork. Off by default, for a workflow that loads credentials on purpose, such as one run by hand.
- **A red job for a stack missing in the backend.** A stack file for a stack still to be made is a normal state of a repo, and the row of a scan already says so.
- **Asking OpenTofu, Helm or kubectl.** None of them fails its first scan the way a missing Pulumi stack does: the scan's init makes a missing workspace, and a Helm release that is not installed is a first install.
- **Checking the label in the `if:` of `resolve`, the branch of `push` and a reusable workflow's caller.** Still left out, for the reason 0061 gives.

## Consequences

- Record 0042 is amended: the check starts the tool when, and only when, a workflow sets `backend: true`, for one read-only question per project directory. Without it the promise is unchanged: files only, no credential, no tool, no GitHub call. The summary's last section says which of the two it was.
- Record 0061 is amended: the check reads the concurrency groups, the status checks of `apply` and `settle`, settle's `needs` and the second apply job.
- The adapter interface gains two optional methods, `readsFiles` and `findInBackend`.
- `docs/later.md` loses the lines about the check suggesting inputs and asking the backend, and about one `ignore` block for stacks missing in the backend, as far as this delivers them, and keeps the rest of each.
