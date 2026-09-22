# Changelog

## [0.6.0](https://github.com/sluiceway/sluiceway/compare/v0.5.0...v0.6.0) (2026-09-22)


### Features

* a three stack chain goes round the whole loop on the fake, in order ([3ba64ad](https://github.com/sluiceway/sluiceway/commit/3ba64ad6f4ea034a081cff521d07f526c828369b))
* dependsOn in sluiceway.yaml, checked against discovery, circles refused ([263aa8c](https://github.com/sluiceway/sluiceway/commit/263aa8c6b81ec8ed595681d4b3fb9c9657f4eaa8))
* queued rows survive a scan, and apply never deploys a queued record ([31960da](https://github.com/sluiceway/sluiceway/commit/31960da02706491b357518d3d7f5eb3c73886504))
* rebuild dist for stack dependencies ([6389019](https://github.com/sluiceway/sluiceway/commit/6389019e26e3e8afbdf83b133e6ae983a11aa173))
* record 0056, the config reference for dependsOn, glossary terms, and resolve on workflow_dispatch in the workflows ([6af36c3](https://github.com/sluiceway/sluiceway/commit/6af36c3bd518145e26e73e303018abf558531927))
* resolve refuses a tick whose dependency has a change waiting, queues the rest of a chain, and a dispatched resolve starts what is ready ([ddc303a](https://github.com/sluiceway/sluiceway/commit/ddc303ac84a3f321a9a85314d8b11caa16093279))
* settle starts the next layer and ends a queued record whose dependency did not deploy ([b68bd7d](https://github.com/sluiceway/sluiceway/commit/b68bd7d44b951eaaa2c3bc910c1aa7929a3ea262))
* the dependency rules: refused, started and queued ticks, and when a queued record is ready ([633235f](https://github.com/sluiceway/sluiceway/commit/633235fa0acbf93969b2353614f915283cd6a5e5))
* the e2e runs a chain of three stacks, one layer per run, with the real tool ([c1018ad](https://github.com/sluiceway/sluiceway/commit/c1018ad158b554bc8121515cec4737c409954cff))
* the queued row state, counted as deploying, and the note on a tick refused for a dependency ([2bd65af](https://github.com/sluiceway/sluiceway/commit/2bd65af63b8312b4fe04c0f5814bb6fcc9031900))

## [0.5.0](https://github.com/sluiceway/sluiceway/compare/v0.4.0...v0.5.0) (2026-09-22)


### Features

* **header:** small fish upstream of Penny, more as the water rises ([9155a60](https://github.com/sluiceway/sluiceway/commit/9155a600fa1d9b3d450f492c25d5d353d8c3776a))
* OpenTofu stacks are declared in sluiceway.yaml and found from their files (record 0053) ([757a9ae](https://github.com/sluiceway/sluiceway/commit/757a9aedde4997168ed510dc14a3b6b0f8756c64))
* the adapter interface grows preparations and a saved plan (record 0053) ([cb3e13f](https://github.com/sluiceway/sluiceway/commit/cb3e13f20b50e2fbf0fd7e05944304fdba648c3c))
* the OpenTofu preview, tofu plan -out and show -json folded into a diff (record 0053) ([2b25bdc](https://github.com/sluiceway/sluiceway/commit/2b25bdc5cb945f56d6dc358ffdff21b0bd8b61af))
* tofu init before the pool, the deploy of exactly the saved plan, and the tool diff (record 0053) ([644b07e](https://github.com/sluiceway/sluiceway/commit/644b07ec7676ceb78ab012ac089a7524b3dd4708))

## [0.4.0](https://github.com/sluiceway/sluiceway/compare/v0.3.0...v0.4.0) (2026-09-22)


### Features

* small polish from real use (slice 2.22) ([1d14d23](https://github.com/sluiceway/sluiceway/commit/1d14d233931f0dd3699499fecf3a53adf2523922))

## [0.3.0](https://github.com/sluiceway/sluiceway/compare/v0.2.0...v0.3.0) (2026-09-22)


### Features

* **apply:** a change that moved since the tick is told to the ticker in one comment (slice 2.20, part 4) ([a8ff4a8](https://github.com/sluiceway/sluiceway/commit/a8ff4a8ecd409a6eed06a8e09af765920ac7b1fb))
* **apply:** an empty fresh preview ends as success, nothing to deploy (slice 2.20, part 3) ([84fa132](https://github.com/sluiceway/sluiceway/commit/84fa132d1c32aa74a664c7b82063e46d5400e16b))
* **apply:** dry-run rehearses a tick and deploys nothing (slice 2.20, part 5) ([34311b2](https://github.com/sluiceway/sluiceway/commit/34311b2b16c6e5f50521f5519428360b181d0cc5))
* **config:** an ignore entry may give a reason, listed under In sync (slice 2.20, part 1) ([7ae4999](https://github.com/sluiceway/sluiceway/commit/7ae499956ad5b2cb9a4cbe9a9345292651776ada))
* **config:** deploys: false stops every deploy (slice 2.20, part 2) ([373b130](https://github.com/sluiceway/sluiceway/commit/373b1306920de7e0220e16635a18ed03801859e9))
* dashboard.showValues, an allowlist of paths whose values may appear (slice 2.19) ([2ea116c](https://github.com/sluiceway/sluiceway/commit/2ea116c03d4304ccf803c597737a80858c168054))
* slice 2.21, two checks: the UI tick event and stdout diagnostics on a failed preview ([2d3fc3a](https://github.com/sluiceway/sluiceway/commit/2d3fc3ad7e708e01279e3b90c1e9e464195429e6))
* the diff hash covers the values a row shows (record 0052) ([947f115](https://github.com/sluiceway/sluiceway/commit/947f1151205c81382e85386b085324c9695826f0))

## [0.2.0](https://github.com/sluiceway/sluiceway/compare/v0.1.1...v0.2.0) (2026-09-22)


### Features

* a preview page per pending stack, the page a row's preview link lands on (slice 2.18) ([d9f4e11](https://github.com/sluiceway/sluiceway/commit/d9f4e112478906af7b9b40b2a65bcda056c3fb33))
* **scan:** a failed list of check runs stops the preview pages with one log line ([e53d243](https://github.com/sluiceway/sluiceway/commit/e53d243a4f9a8896762339321b807653d9339aaf))

## [0.1.1](https://github.com/sluiceway/sluiceway/compare/v0.1.0...v0.1.1) (2026-09-21)


### Bug Fixes

* find the action's own version next to its bundle, not through GITHUB_ACTION_PATH ([5018c8a](https://github.com/sluiceway/sluiceway/commit/5018c8a598b7e554a88d771e64c6fe1388832c07))

## 0.1.0 (2026-09-21)


### Features

* **action:** a branding block for the Marketplace, the droplet on blue ([fcaaedf](https://github.com/sluiceway/sluiceway/commit/fcaaedf83bd345a551ad7d156b3336ec1f29bf5e))
* **adapters:** a stack that does not exist in the backend is a failure reason of its own, picked from exit code 6 ([5dfccea](https://github.com/sluiceway/sluiceway/commit/5dfccea20109646fdc9b7a64fd96a2236700979d))
* **adapters:** changed keys are property paths as the tool writes them ([65ab41c](https://github.com/sluiceway/sluiceway/commit/65ab41cb7fa65f93f84bedb5a718c7b9038a91ab))
* **adapters:** slice 1.4, Pulumi discovery ([1b9cc20](https://github.com/sluiceway/sluiceway/commit/1b9cc2011ea4543004e87cdf226ae6763c80d23c))
* **adapters:** slice 1.5, Pulumi preview ([78e4195](https://github.com/sluiceway/sluiceway/commit/78e4195a89b567c96f611056e3837efa5447873b))
* **adapters:** the adapter interface and Pulumi discovery from files alone ([2d9da4a](https://github.com/sluiceway/sluiceway/commit/2d9da4a1a389dee3459dfdc705ac01707977c258))
* **adapters:** the process runner with the time limit, and the tool environment ([b49bab4](https://github.com/sluiceway/sluiceway/commit/b49bab475862c76030d7b6f5535ed2bdc994379c))
* **adapters:** the Pulumi adapter's apply: up with the preview's quiet flags, the outputs kept to the tool, and no time limit of Sluiceway's ([b866188](https://github.com/sluiceway/sluiceway/commit/b8661882908ed031de13d29588f50cab02d0a51f))
* **adapters:** the Pulumi version check and preview ([ce27034](https://github.com/sluiceway/sluiceway/commit/ce27034239cde3a51e6afcf6f515eafb613c3ccd))
* add action metadata with the inputs the decision records fix ([3811f9d](https://github.com/sluiceway/sluiceway/commit/3811f9d3c2ece81975758f9cd38c2770d2de717b))
* check is the fifth mode, in the dispatch and in action.yml ([3139526](https://github.com/sluiceway/sluiceway/commit/3139526d3f2efb3b0b908e497199c0b7c014681a))
* **config:** dashboard.readOnly, for a workflow that only scans ([80af3e7](https://github.com/sluiceway/sluiceway/commit/80af3e7489079bce309b7bd5f2f579458060a782))
* **core:** add the diff hash over a canonical document ([3a8e9b0](https://github.com/sluiceway/sluiceway/commit/3a8e9b0d97d214aec00eefbe18886e3c60d8789e))
* **core:** add the Stack, Change and Diff types and the derived stack id ([3e5b0f8](https://github.com/sluiceway/sluiceway/commit/3e5b0f8e67ad2e1cb68edda19de14adcba48215f))
* **core:** attribution: the range of a stack, the pull requests and direct pushes it claims, the line and its counted form ([9cd5c8f](https://github.com/sluiceway/sluiceway/commit/9cd5c8f9fc4a02449449e270a461d34fb593cde7))
* **core:** deployment records: the task, the versioned payload, deploy facts and the row a stack gets at the late read ([a96bb5b](https://github.com/sluiceway/sluiceway/commit/a96bb5b91e21e255e1c2f189db1379d9f473d642))
* **core:** ignore on the stack id, one id per stack, and applyConfig drops ignored stacks ([cd4b088](https://github.com/sluiceway/sluiceway/commit/cd4b0887e71f85b43918b9035a84fe4c69e23a2f))
* **core:** parse sluiceway.yaml with defaults and its own error messages ([30d7918](https://github.com/sluiceway/sluiceway/commit/30d79180ad06db57be85201e325377c7d93a8df6))
* **core:** read sluiceway.yaml from the repo root and refuse sluiceway.yml ([396cf66](https://github.com/sluiceway/sluiceway/commit/396cf6646debed64eb54c6b064e422f7f34b5926))
* **core:** slice 1.1, core types and the diff hash, render/ inside the boundary ([edfef8e](https://github.com/sluiceway/sluiceway/commit/edfef8ef7eb673e2e6d2fa5a5eabc4e13dbac34c))
* **core:** slice 1.2, config loading and the JSON schema ([4e4b3bf](https://github.com/sluiceway/sluiceway/commit/4e4b3bf53d402273e73a8e58659eaf0c5279050c))
* **core:** the bounded pool a scan previews through ([8d1805f](https://github.com/sluiceway/sluiceway/commit/8d1805f30444cd66183dde4e0b35c61094aecfcb))
* **core:** the check: what ignore leaves out and the glob that would work, the files no stack claims, the globs offered for scan.unrelated ([2683889](https://github.com/sluiceway/sluiceway/commit/268388986f6df9ff60899da2163e2e4c9918e37e))
* **core:** the claim rule and the scan plan of a narrowed scan ([b0c7a6c](https://github.com/sluiceway/sluiceway/commit/b0c7a6c85d3b471c5453fa7ec4854b138abaf317))
* **core:** the open deployment records of one run, which settle ends ([1f09fd1](https://github.com/sluiceway/sluiceway/commit/1f09fd17eff6c429be26b0d3255a14b5ef7d9ba1))
* **core:** the orphan tick rule of a scan: carry, sweep, preview first, and when a resolve run is on its way ([d207d4b](https://github.com/sluiceway/sluiceway/commit/d207d4b416fdaddb9e3d6f8a5a5d6eff6798c1c9))
* **core:** the preview failure reasons of record 0022 and their text ([f6bac46](https://github.com/sluiceway/sluiceway/commit/f6bac46f795ee9fb9f7d00862a6481d340460342))
* **core:** the reasons a deploy fails, from the fixed list of record 0022 ([f5e52c6](https://github.com/sluiceway/sluiceway/commit/f5e52c6edb3bee10f4ccdf45b891906850734287))
* **core:** the tick rule: levels from the three booleans, a list that only narrows, only a person can tick ([6fcbdfe](https://github.com/sluiceway/sluiceway/commit/6fcbdfe127a97ae3c423833e2af3d9588e298574))
* **core:** the walk through the edit history that names the ticker of a tick ([c8cefa8](https://github.com/sluiceway/sluiceway/commit/c8cefa8f13d94403a29cf3b240a4feaecdb1c052))
* dispatch on mode to stubs that fail as not implemented yet ([c01e756](https://github.com/sluiceway/sluiceway/commit/c01e756cdd96635287456c549f516497a722c4db))
* **examples:** add the pulumi-basic example project ([83ad250](https://github.com/sluiceway/sluiceway/commit/83ad250f2a721ec815a5368fe7e686f6efafaae9))
* generate the JSON schema of sluiceway.yaml and check it in CI ([d2fa09c](https://github.com/sluiceway/sluiceway/commit/d2fa09ca29264917b9d50e64586aebb3175c287e))
* **github:** a workflow dispatch on the port, on Octokit, on the fake and on its server, and the fake starts an event for a person's edit ([ea0cfcb](https://github.com/sluiceway/sluiceway/commit/ea0cfcbef1676e2b4352c3ce778f88f908a6cce8))
* **github:** deployment records on the port and on Octokit: create, statuses with auto_inactive false, one GraphQL page, the REST fall back, a workflow run ([d1e11e6](https://github.com/sluiceway/sluiceway/commit/d1e11e611409a0a02751de59175fbd1ae15abf2c))
* **github:** finding, repairing and creating the dashboard ([e9bb101](https://github.com/sluiceway/sluiceway/commit/e9bb10172bc25fcf283c1cd8d3f3aa99c5e5d418))
* **github:** judge the ticks of a run against the live lookup, and write the one comment ([0f2cb11](https://github.com/sluiceway/sluiceway/commit/0f2cb11419f2e2b16c730b1e4c4fd893725ca354))
* **github:** one deployment record by its id, on the port, on Octokit, on the fake and on its server ([9e23360](https://github.com/sluiceway/sluiceway/commit/9e23360e69fc4c204e9a31cb0d8c0da6c94bf8e4))
* **github:** slice 1.10, the GitHub port, the fake, the dashboard and the write loop ([fcc52a6](https://github.com/sluiceway/sluiceway/commit/fcc52a6bda4a46c17c0e2eb4882fb400fdc7025a))
* **github:** step outputs, the result file under RUNNER_TEMP, and the dashboard url from the event ([49a6347](https://github.com/sluiceway/sluiceway/commit/49a63473c18f1c2acbb28c1e8255ae1653f8888c))
* **github:** the action ref rule, exact tag or commit SHA and never a moving tag ([997d441](https://github.com/sluiceway/sluiceway/commit/997d441f172d81fc1c268a481f9cd6fe2f7a84c5))
* **github:** the bounded reads of deployment records, and an open deployment whose run is over becomes error ([2036050](https://github.com/sluiceway/sluiceway/commit/20360506c294a632168d3b494aba5f3b23461e66))
* **github:** the compare call on the port, on Octokit and on the fake ([a96ba6b](https://github.com/sluiceway/sluiceway/commit/a96ba6b5ba11ada4a1ceb95c8b9ae072d985c9c7))
* **github:** the edit history on the port, on Octokit, on the fake and on its server ([2d7c9f9](https://github.com/sluiceway/sluiceway/commit/2d7c9f9c77ed4612ec2d0b51b11f8b2ad3b5ecdd))
* **github:** the fall back of the bounded reads can name its stacks only when a page is full ([c44efb3](https://github.com/sluiceway/sluiceway/commit/c44efb3da93fdddb53eb45716e5f37b8edef24a0))
* **github:** the GitHub port and the fake GitHub with the lab's size limits ([34ea351](https://github.com/sluiceway/sluiceway/commit/34ea351968250b4a886764a84e92d1fef1b59a64))
* **github:** the job knows the file name of its workflow ([0ed3134](https://github.com/sluiceway/sluiceway/commit/0ed3134401b76a1c4fe92cfd122576bcf02de72c))
* **github:** the job-id input from job.check_run_id, and the run attempt with the job's facts ([bc92340](https://github.com/sluiceway/sluiceway/commit/bc92340ba58ef46a8e49461c2f4e4f7cb3a558f2))
* **github:** the Octokit implementation of the port ([14e2d99](https://github.com/sluiceway/sluiceway/commit/14e2d99c77b142a2ee6579deac4758e43e327dba))
* **github:** the permission lookup on the port, on Octokit and on the fake ([d28ebc2](https://github.com/sluiceway/sluiceway/commit/d28ebc2ac332d0a3bf45722093c577ef607adceb))
* **github:** the runs an issue edit started, on the port, on Octokit, on the fake and on its server ([23df7a2](https://github.com/sluiceway/sluiceway/commit/23df7a2012d5454a89145f9a1bb5532fa1e7110b))
* **github:** the walk of the lookback and the files of one commit, on the port and on Octokit ([d5ef061](https://github.com/sluiceway/sluiceway/commit/d5ef061aef5c8f746488b155f186c7a06bb29a0b))
* **github:** the write loop, which reads back every write and tries three times ([e42d8e8](https://github.com/sluiceway/sluiceway/commit/e42d8e8662ee95915b8ae5e7cfaf2b3084f9c364))
* **header:** one crate per pending stack up to 12, and the destroy sign on a pole ([2e4fd33](https://github.com/sluiceway/sluiceway/commit/2e4fd330aa45483df80ee727db440bad87ff5824))
* **header:** the destroy sign on the pending and deploying pictures, and the plain files are gone ([201e58b](https://github.com/sluiceway/sluiceway/commit/201e58b6de8f66296917afd70cae2c4e76b7b193))
* **header:** the wide quay header, sixteen files of 880 by 160 ([add6877](https://github.com/sluiceway/sluiceway/commit/add68778e99cf4d27e2460e05824fafe6e8de6c2))
* **modes:** a scan that follows a push previews only the stacks that claim a changed file ([28a1dac](https://github.com/sluiceway/sluiceway/commit/28a1dac02b765f59a5fa936e164e0ef7d7609e4e))
* **modes:** after a change to sluiceway.yaml the log says the config file changed, not that no stack claims it ([0033a1b](https://github.com/sluiceway/sluiceway/commit/0033a1b010feb39fd6a7082cf7d641164f4933dc))
* **modes:** apply is wired: the deployment-id input in action.yml, required in apply and an error in every other mode, and the job glue ([929fb47](https://github.com/sluiceway/sluiceway/commit/929fb472a718863c6be88687c807676942e3b904))
* **modes:** apply sets outcome, stack, dashboard-url and the result file, and settle sets dashboard-url ([761717f](https://github.com/sluiceway/sluiceway/commit/761717f520ba46b2275ca9932ab8fb4b8dd8ccfc))
* **modes:** apply warns too when scan.logDiff is on in a public repo ([bd53496](https://github.com/sluiceway/sluiceway/commit/bd53496332f0cbf50a64a951f9d697a77ab96e19))
* **modes:** apply: the record first, a fresh preview, the hash check, the deploy, the status and the row swap ([3502b2e](https://github.com/sluiceway/sluiceway/commit/3502b2e6e38629deee3d6877ec9bd54ba6d0eb3f))
* **modes:** resolve is wired: the job glue, the matrix output in action.yml, and the refusal, rescan and cap tests ([8802010](https://github.com/sluiceway/sluiceway/commit/88020103363b0b390f9b8ddf0618ded138d3b599))
* **modes:** resolve works the attribution line out again for the deploying row it writes, from a scan-sha that is a commit id ([9e0c038](https://github.com/sluiceway/sluiceway/commit/9e0c038a5dac1a4bc45ee012df445282157e451f))
* **modes:** resolve: the cheap payload check, body and history in one read, records created as queued, the matrix output before the row swap ([00bdf8a](https://github.com/sluiceway/sluiceway/commit/00bdf8a54f8fd479ca32c8ea22278f7f614c3388))
* **modes:** scan sets its outputs on every way out and writes the result file ([2ccb021](https://github.com/sluiceway/sluiceway/commit/2ccb0214f7d3a04ab930580f3f06e10da97d94c7))
* **modes:** scan, resolve and apply draw a read-only dashboard, and a read-only scan drops old ticks without a note ([e2b37a8](https://github.com/sluiceway/sluiceway/commit/e2b37a81e7867c7c04d7ade940db8a90dcf681b2))
* **modes:** scan.logDiff prints the tool's own diff of every pending stack in its log group ([1839d7c](https://github.com/sluiceway/sluiceway/commit/1839d7cb6e059b15e65ab7402156b09803009806))
* **modes:** settle ends the open records of its own run and starts a full scan ([be223a8](https://github.com/sluiceway/sluiceway/commit/be223a87f94515cc56a4f30b3a51b353820e4533))
* **modes:** settle is wired as a mode ([4de84d1](https://github.com/sluiceway/sluiceway/commit/4de84d1b7dce188c031a3e7628766f6725ffe3f6))
* **modes:** the check mode: config, discovery and the files no stack claims, in the job log and the summary, with no port and no process runner ([180ed53](https://github.com/sluiceway/sluiceway/commit/180ed53ed4ec30d61810ddb6bb3b01c836b3bb49))
* **modes:** the full scan, with the pool, the job result and the job log ([c992b07](https://github.com/sluiceway/sluiceway/commit/c992b07db9487e5ecd1c9d52597a876998693044))
* **modes:** the scan puts the attribution line on its rows and the pull requests in its summary, and never fails over it ([978b7c0](https://github.com/sluiceway/sluiceway/commit/978b7c0b865a181e10856f4ed3574aadf04bd88f))
* **modes:** the scan reads the deployment records at its late read: deploying rows, failure lines, recently deployed, and it defers to a deploy that ended under it ([cbd3684](https://github.com/sluiceway/sluiceway/commit/cbd3684bb6a32334f13c4ba6a3cb84f3de24f0fd))
* **modes:** the scan sweeps orphan ticks at its late read, and keeps its hands off while a resolve run is on its way ([a807a95](https://github.com/sluiceway/sluiceway/commit/a807a95e78ae8d687a03bda003d58d1e5d68d53a))
* **render:** a pending row can carry a tick through ([3995511](https://github.com/sluiceway/sluiceway/commit/39955112862b0e7cb729b054d33895653d3cff43))
* **render:** a read-only dashboard draws no boxes and says so under the Pending heading ([724183f](https://github.com/sluiceway/sluiceway/commit/724183f6f1e24124172599d360d9572637c981f5))
* **render:** a row shortens long property paths and lists ten per change in its fold ([3d70074](https://github.com/sluiceway/sluiceway/commit/3d70074070de4c6846eb85f2f95fd6c05e0b90a5))
* **render:** a row's link lands on the attempt's summary or the job's log, and the summary has an index and an anchor per stack ([caf3ea6](https://github.com/sluiceway/sluiceway/commit/caf3ea68df11e245cbb680c100c762067ff82c57))
* **render:** escape text from outside, and write times in UTC to the minute ([0929d64](https://github.com/sluiceway/sluiceway/commit/0929d6453bebf1e85c96bb278c675f2807eb31d0))
* **render:** slice 1.6, markers and rows ([1c03412](https://github.com/sluiceway/sluiceway/commit/1c034127ad508a7d5c16f272a93172dd2e84d457))
* **render:** slice 1.7, the body ([ba2e349](https://github.com/sluiceway/sluiceway/commit/ba2e349311dbd49e3ea17d5bbf744f66ef549e83))
* **render:** slice 1.7b, the wide header in the body renderer ([0ac39cd](https://github.com/sluiceway/sluiceway/commit/0ac39cd3d9646a735c706772e5be93c2b7e1d874))
* **render:** slice 1.9, the summary and the log text ([9fa347f](https://github.com/sluiceway/sluiceway/commit/9fa347f6c66d500db8ce8d6221c3ab677dfccc4b))
* **render:** the body around the row blocks, personality on and off ([7b9e021](https://github.com/sluiceway/sluiceway/commit/7b9e021d64c962167861ec7a861a142f39785945))
* **render:** the budget of the summary, its levels and the note at the top ([b4b64e4](https://github.com/sluiceway/sluiceway/commit/b4b64e418b63cff1404a93d816264bc9ed12bc71))
* **render:** the destroy sign as a pure function of the row markers ([ca538c3](https://github.com/sluiceway/sluiceway/commit/ca538c38662b41542fcd4b69020dca2e1cce3a31))
* **render:** the header always shows the real state, and a destroy adds a sign ([ca69615](https://github.com/sluiceway/sluiceway/commit/ca696156faca262d45f52556a60ba8421bb4e6b8))
* **render:** the header state, six states and bad news wins ([d0ea53e](https://github.com/sluiceway/sluiceway/commit/d0ea53e1bf97e2737f40c51ea98b3ce5ab996c58))
* **render:** the last full scan on the root marker ([1cf23e7](https://github.com/sluiceway/sluiceway/commit/1cf23e7a42d75530659cb8a1bd1ec57ade294364))
* **render:** the level of a shortened row on its marker ([c3a6538](https://github.com/sluiceway/sluiceway/commit/c3a6538787e8a6a918239ac1590e9ff18d20b22c))
* **render:** the log text of a diff, and the title of a stack's group ([4ac839d](https://github.com/sluiceway/sluiceway/commit/4ac839d9231ab08d4d155e5a7124412fe51115a2))
* **render:** the note about shortened rows, counted from the row markers ([da6123f](https://github.com/sluiceway/sluiceway/commit/da6123f5c17d3c89395f1bc337fcb9fc64cef46a))
* **render:** the one comment for the refused ticks of a run ([14c1cc7](https://github.com/sluiceway/sluiceway/commit/14c1cc7b3256c05ccb3346f841a0a73543cff706))
* **render:** the pending level of record 0039 ([943b963](https://github.com/sluiceway/sluiceway/commit/943b963d6f2dffb976706470362982f65dfc9ac4))
* **render:** the result file of a scan and of an apply, its strict schema, and the dashboard counts from the row markers ([41fa2f2](https://github.com/sluiceway/sluiceway/commit/41fa2f295a73531dc3141e58097ee92e484207dd))
* **render:** the row renderer for every kind of row, redact and the four levels ([574ef68](https://github.com/sluiceway/sluiceway/commit/574ef6857f4188c80cca30d85c2943a04d01f4bc))
* **render:** the size budget, biggest rows first, give-back, destroys last ([97afbd4](https://github.com/sluiceway/sluiceway/commit/97afbd44a98b1caf2553347cf05da821102bac2a))
* **render:** the summary names the ignore glob that takes a stack off the dashboard when it does not exist in the backend ([141f7b1](https://github.com/sluiceway/sluiceway/commit/141f7b1e92b2054e44c929bc3394321d5cd9f472))
* **render:** the summary of a scan, every previewed stack in full ([b4965e9](https://github.com/sluiceway/sluiceway/commit/b4965e9feb32dc6ccbe4e2312f8cac78727904a2))
* **render:** the summary of an apply, and whether a deployment record is still open ([1ebe1e0](https://github.com/sluiceway/sluiceway/commit/1ebe1e0bdab90839eed9a3a8bd68cb2dbd4efc8f))
* **render:** the three marker kinds, value encoding and reading a body ([aefbe4f](https://github.com/sluiceway/sluiceway/commit/aefbe4fd42d16b1f4fef3cee0c9334b692619cba))
* **render:** the voice in two lines, and the plain lines around them ([d6aa5e6](https://github.com/sluiceway/sluiceway/commit/d6aa5e6474ce26e09f8b9473ceb2595cefab74ca))
* **scan:** log the number of GitHub API requests the scan made ([25425be](https://github.com/sluiceway/sluiceway/commit/25425be2954cf2754af194f3bf2f1dd6de60e09f))
* **scripts:** add the fixture recorder and its scenarios ([4eb95c2](https://github.com/sluiceway/sluiceway/commit/4eb95c2190d5eabfd08c23034d435e54fb6d14c6))
* slice 1.3, the example project and the fixture recorder ([695e454](https://github.com/sluiceway/sluiceway/commit/695e454ca39e0a027ee5f50810f8af884b416168))
* the outputs of record 0041 in action.yml, and the job glue that hands the modes RUNNER_TEMP and the event ([fc44971](https://github.com/sluiceway/sluiceway/commit/fc44971a72617a2bb95aa7066b02a67dc3a506c8))
* the scan wired into the entry point, with its inputs, job facts and job log ([134c3e3](https://github.com/sluiceway/sluiceway/commit/134c3e3f3a30b9fc7398ff851523e178faddcd75))


### Bug Fixes

* **adapters:** an empty detailed diff falls back to the tool's list of names ([acb9142](https://github.com/sluiceway/sluiceway/commit/acb91422b7b49b8ff5d0185e877e03fe0f0fcb49))
* **core:** one form of the failure reason, the lower case one of record 0027 ([59a3a26](https://github.com/sluiceway/sluiceway/commit/59a3a266b7498f8390eb8040446defb6693f261c))
* make the first release 0.1.0 instead of 1.0.0 ([b8a9b81](https://github.com/sluiceway/sluiceway/commit/b8a9b81caa17765b1c0bd359949d30ddfa9f4ac8))
* make the first release 0.1.0 instead of 1.0.0 ([bff83a8](https://github.com/sluiceway/sluiceway/commit/bff83a85d98155bd9fef1dc0ccf5dd1d76708d0c))
* **modes:** one full stop after GitHub's words in the attribution log line ([9766956](https://github.com/sluiceway/sluiceway/commit/97669561f9eb8f63ff55439c346c12d86a311f1a))
