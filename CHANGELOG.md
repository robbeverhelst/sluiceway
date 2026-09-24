# Changelog

## [0.30.0](https://github.com/sluiceway/sluiceway/compare/v0.29.0...v0.30.0) (2026-09-24)


### Features

* the payload of a deployment record has a published schema, and the result file says where its one kind of value may be ([24cf141](https://github.com/sluiceway/sluiceway/commit/24cf141e921cdb001bfe341e3e9fa1fb1d370cf2))

## [0.29.0](https://github.com/sluiceway/sluiceway/compare/v0.28.0...v0.29.0) (2026-09-23)


### Features

* a record opened on merge says so, and a queued one keeps it ([323da17](https://github.com/sluiceway/sluiceway/commit/323da17482816cf436814a935baed8559b766490))
* decide which stacks set to on-merge deploy after a scan, and which wait for a tick ([f5edfad](https://github.com/sluiceway/sluiceway/commit/f5edfad80f8949a3f064852f5837c922831755da))
* rows, the trail and apply say merged by for a deploy on merge ([5c11366](https://github.com/sluiceway/sluiceway/commit/5c11366e8a26028baf9f576e2fef3c7995886c08))
* stacks[].deploy, on-tick by default or on-merge ([ccc08a2](https://github.com/sluiceway/sluiceway/commit/ccc08a2941e790904610356aee712e18cb0debbc))
* the check lists stacks that deploy on merge and the apply job they need ([212ba7e](https://github.com/sluiceway/sluiceway/commit/212ba7e6e7b6e8f2e1b3dd8584340741a62cc9d6))
* the scan of a merge hands stacks set to on-merge to apply ([5a69960](https://github.com/sluiceway/sluiceway/commit/5a6996041c92ab956a93d64d0c256e0e28602ae3))

## [0.28.0](https://github.com/sluiceway/sluiceway/compare/v0.27.0...v0.28.0) (2026-09-23)


### Features

* a run that waits long for a runner gets a line under the scan line ([bf12184](https://github.com/sluiceway/sluiceway/commit/bf12184d6de238f781052826f03637063390a5b0))
* **apply:** a drift repair that found nothing to repair says drift gone ([3d6ac0a](https://github.com/sluiceway/sluiceway/commit/3d6ac0aaeac99c98090dbcba5269ad29909fdc43))
* dashboard.timeZone in sluiceway.yaml, checked against the runtime's zones ([362f28a](https://github.com/sluiceway/sluiceway/commit/362f28a110b933719959f992e7de267d68bfda7c))
* every scan looks for a run of its workflow that waits for a runner ([c4a9021](https://github.com/sluiceway/sluiceway/commit/c4a90216a8cd9b7fca12331db505fe39447fcfab))
* find OpenTofu and Terraform root modules from the repo's own files ([de4b22c](https://github.com/sluiceway/sluiceway/commit/de4b22cf725a0e3a94a75de0bef3a3621bbf16b8))
* init --force writes the workflow again, and init names npx sluiceway check ([583bf22](https://github.com/sluiceway/sluiceway/commit/583bf22cb8508a75a72bebe7754318b5bc58cacb))
* render a time in a named zone, with its offset when it stands alone ([46c3b5e](https://github.com/sluiceway/sluiceway/commit/46c3b5ecfa0f976e39ceb4c79bfcea868d2b5f5f))
* **resolve:** one line in the job log says where resolve's time went ([f34b01a](https://github.com/sluiceway/sluiceway/commit/f34b01aca0803430e4a035770f50d15461e07e47))
* the body and its rows take the dashboard's zone ([110b171](https://github.com/sluiceway/sluiceway/commit/110b171a0ac11585539a42dc7b4843dabad59784))
* the check lists what root module discovery found and left out, and why ([8a1b75a](https://github.com/sluiceway/sluiceway/commit/8a1b75a111d5d75cde3ad04df50b6b1c101df632))
* the check reads the environment a Sluiceway job names ([2a6406d](https://github.com/sluiceway/sluiceway/commit/2a6406d4213327b1d55a531957e6302f18cf8fbe))
* the check says who decides who may deploy, for each job that deploys ([0f5fd30](https://github.com/sluiceway/sluiceway/commit/0f5fd309b2bf7695368e4187e2c49ea9e97972ff))
* the command line, sluiceway init and sluiceway check ([d6aed35](https://github.com/sluiceway/sluiceway/commit/d6aed35195d4b47ea3c8ecfa7dc27c69c4591c52))
* the port lists the queued runs of a workflow ([548dfd0](https://github.com/sluiceway/sluiceway/commit/548dfd0f2a7632ffd6279b3789280d5ddf432211))


### Bug Fixes

* README example breaks its lines, header signs get room, queued rows stand still ([#217](https://github.com/sluiceway/sluiceway/issues/217)) ([1093c22](https://github.com/sluiceway/sluiceway/commit/1093c223648ee2abcbd9c33d259cb56eade61eec))
* **resolve:** a queued drift repair is started as a drift repair ([23666c3](https://github.com/sluiceway/sluiceway/commit/23666c3f80132a984360bb32276984731f24e2d2))
* the check job lists the root modules discovery found and left out ([e7929e2](https://github.com/sluiceway/sluiceway/commit/e7929e2a0331e566fb0fe6229ce010dac76a72cc))

## [0.27.0](https://github.com/sluiceway/sluiceway/compare/v0.26.2...v0.27.0) (2026-09-23)


### Features

* **core:** the pool size follows the cores, from 1 to 8, unless the input sets it ([fdbafb4](https://github.com/sluiceway/sluiceway/commit/fdbafb4ed809005ae8c3ce41adb6fcf410e176e9))
* **render:** a log line that names the pool size and where it came from ([683c3e8](https://github.com/sluiceway/sluiceway/commit/683c3e89a584cb84fe9171a65aad4240215c73a1))
* **scan:** without concurrency the pool is the machine's cores, said once in the job log ([f12bc21](https://github.com/sluiceway/sluiceway/commit/f12bc21692bf9b25dc61bda9146afea223471668))

## [0.26.2](https://github.com/sluiceway/sluiceway/compare/v0.26.1...v0.26.2) (2026-09-23)


### Bug Fixes

* an empty optional input means the action's default ([d1b38fd](https://github.com/sluiceway/sluiceway/commit/d1b38fd87ee6b57d9ad4fb7ac05e1d87bfd0e2d2))
* the shortened note counts drifted rows too ([b06d399](https://github.com/sluiceway/sluiceway/commit/b06d3991ad7b0460cdb9a8c58db88641b4aeee7b))

## [0.26.1](https://github.com/sluiceway/sluiceway/compare/v0.26.0...v0.26.1) (2026-09-22)


### Bug Fixes

* init names pages on the docs site, not files in docs/ ([45801dd](https://github.com/sluiceway/sluiceway/commit/45801ddf1edea478c7cf7201431277113e17769b))
* the dashboard footer's docs link goes to the docs site ([15c2055](https://github.com/sluiceway/sluiceway/commit/15c2055464f5ba399f8cd73e67a735c56dd95161))

## [0.26.0](https://github.com/sluiceway/sluiceway/compare/v0.25.0...v0.26.0) (2026-09-22)


### Features

* every writer draws the bulk lines, and the scan sweeps them like orphan ticks ([29e94ff](https://github.com/sluiceway/sluiceway/commit/29e94ff167e9adbec4f04bf356e27b6788832436))
* resolve turns a bulk tick into a confirm box, and hands a confirmed box on as one tick per stack ([85db133](https://github.com/sluiceway/sluiceway/commit/85db133050d74e11d9e6a51eaea020e9de0f5c53))
* the bulk box and its confirm box, their marker and the rule of which one a section gets ([2b7faa4](https://github.com/sluiceway/sluiceway/commit/2b7faa4bfe02704549ad8088e0ab6f5700b0d32b))

## [0.25.0](https://github.com/sluiceway/sluiceway/compare/v0.24.1...v0.25.0) (2026-09-22)


### Features

* a failed check under a pending combined state reads as failed ([0a4194e](https://github.com/sluiceway/sluiceway/commit/0a4194ef25f9374b437a3723b1e3a17920e8872f))
* a pull request that qualifies but for checks still running waits on them ([4b88089](https://github.com/sluiceway/sluiceway/commit/4b880895aea811f9caa0a4934ec8d2174a3cc787))
* the line of an update waiting on its checks, with no box and a marker of its own ([aa13736](https://github.com/sluiceway/sluiceway/commit/aa13736603ab87199b215808490dd10715ae3c58))
* the scan draws the waiting lines, and resolve and apply carry them ([ce99def](https://github.com/sluiceway/sluiceway/commit/ce99def6814f0a60941aa6cf34477c97684d8513))

## [0.24.1](https://github.com/sluiceway/sluiceway/compare/v0.24.0...v0.24.1) (2026-09-22)


### Bug Fixes

* a stack that was never deployed does not count its root stack resource ([0bf23ac](https://github.com/sluiceway/sluiceway/commit/0bf23ac6e0696443ddb55274f21b39926f02bbb9)), closes [#165](https://github.com/sluiceway/sluiceway/issues/165)
* the unclaimed files leave the config file out and the hint names the shared files to keep off scan.unrelated ([929613a](https://github.com/sluiceway/sluiceway/commit/929613abb77657e0518de28beae5edd9f168f6ef))
* two stacks with one id name the tool of each side ([fd09948](https://github.com/sluiceway/sluiceway/commit/fd099481bc8e6cd6a99c20dde7913648d4f789b2))

## [0.24.0](https://github.com/sluiceway/sluiceway/compare/v0.23.0...v0.24.0) (2026-09-22)


### Features

* auto mode, a step with no mode picks what to run from the event ([947769d](https://github.com/sluiceway/sluiceway/commit/947769d560625f40177ad888dfb8f4e78217575d))
* init writes the one-step workflow ([c165dc9](https://github.com/sluiceway/sluiceway/commit/c165dc9f2351f59cdc610356afefd9025634a2a9))
* the check reads a step with no mode as auto, from its file's triggers ([14299d5](https://github.com/sluiceway/sluiceway/commit/14299d5e7f6d4e33f8aa2965103af58b81c6e27a))


### Bug Fixes

* the summary is written to the file the runner names at every write ([c846537](https://github.com/sluiceway/sluiceway/commit/c84653734e0053e6f0efe62b30cc7147aefe9175))

## [0.23.0](https://github.com/sluiceway/sluiceway/compare/v0.22.0...v0.23.0) (2026-09-22)


### Features

* a later deploy, outside deploys included, ends a failure line in the core ([fe1f04a](https://github.com/sluiceway/sluiceway/commit/fe1f04ae1e1d6ba9369baeff16a950af4a20efea))
* notify.events in sluiceway.yaml, and which stacks a scan and an apply tell (slice 5.13) ([e7e8809](https://github.com/sluiceway/sluiceway/commit/e7e88093f5c77725282672f8de63c2f08cd73b4a))
* scan, resolve and apply send the built-in notifications (slice 5.13) ([41c4b21](https://github.com/sluiceway/sluiceway/commit/41c4b2102dea4b3d93fbd0d4c4254b64559135e4))
* the scan and apply drop a failure line that a later outside deploy ended ([18a3765](https://github.com/sluiceway/sluiceway/commit/18a376517b074d1c9fe239a6429eaa9388ec4293))
* the words and the sender of the built-in notifications (slice 5.13) ([f214e57](https://github.com/sluiceway/sluiceway/commit/f214e57f93d7188031f99037b935b172b129eb6e))

## [0.22.0](https://github.com/sluiceway/sluiceway/compare/v0.21.0...v0.22.0) (2026-09-22)


### Features

* header art for a delete sign, 20 crates and a queued state ([66700e3](https://github.com/sluiceway/sluiceway/commit/66700e363e1507c48e0372548dfa428c31424ec2))
* the header tells a delete from a replace, counts to 20 and shows a queue ([f23e497](https://github.com/sluiceway/sluiceway/commit/f23e497e008774fe3140352fb0a3ca837723ab76))
* the queued header snapshot follows the trail's wording from main ([a1c1e4d](https://github.com/sluiceway/sluiceway/commit/a1c1e4d1428dcac83ae79532f1985b500b8b370a))

## [0.21.0](https://github.com/sluiceway/sluiceway/compare/v0.20.1...v0.21.0) (2026-09-22)


### Features

* kubernetes manifests part 2, pruning, a drift check, -R and two apply options ([bc48e1e](https://github.com/sluiceway/sluiceway/commit/bc48e1eaf4183eb668e3029ae1f70b4b6667969a))
* the kubectl fixtures from CI run 35738442226 ([64036b3](https://github.com/sluiceway/sluiceway/commit/64036b347fef7a439082b6a990ae22c4b68286ce))


### Bug Fixes

* a deploy-timeout input gives the deploy a time limit of Sluiceway's (slice 5.9) ([de833e9](https://github.com/sluiceway/sluiceway/commit/de833e922697c4619e377066886b53873c1cc705))
* a failed permission lookup is tried once more in the same resolve run (slice 5.9) ([1d00538](https://github.com/sluiceway/sluiceway/commit/1d00538cc33bc8d88f0885d6ac66b4b49e2f93a9))
* a fault inside Sluiceway during a preview is that stack's preview failure row, and the job still goes red (slice 5.9) ([d695f2b](https://github.com/sluiceway/sluiceway/commit/d695f2bb62bee39ea5c3320d3a8be8f9f7877f58))
* a preview failure reason of its own for Pulumi's exit codes 2, 3, 4 and 9 (slice 5.9) ([bc8af91](https://github.com/sluiceway/sluiceway/commit/bc8af911e32a4a831ce22fef1da41ac57b28eaed))
* a push past the 300 files of a comparison is narrowed by the trees of the two commits (slice 5.9) ([4d52b1e](https://github.com/sluiceway/sluiceway/commit/4d52b1eb341f62d46e179e8cadbae17dce69be7c))
* a refusal comment names at most ten people of a tick rule (slice 5.9) ([1d00538](https://github.com/sluiceway/sluiceway/commit/1d00538cc33bc8d88f0885d6ac66b4b49e2f93a9))
* a renaming pull request over the walk's 100 files is read too (slice 5.9) ([05d3054](https://github.com/sluiceway/sluiceway/commit/05d30540d3fea755c61ea4e1fa01c6b3c0ae52eb))
* a row's link to the run of a deploy lands on the attempt that created its record (slice 5.9) ([a39d81e](https://github.com/sluiceway/sluiceway/commit/a39d81e5c17242088cbfca01dd1f9b854d86d3fb))
* a scan pins a dashboard that exists when it is not pinned (slice 5.9) ([7bc04b3](https://github.com/sluiceway/sluiceway/commit/7bc04b3e93d412059f648fc4bf8b2dcadd9afad9))
* a scan renames the dashboard when dashboard.title changes (slice 5.9) ([7bc04b3](https://github.com/sluiceway/sluiceway/commit/7bc04b3e93d412059f648fc4bf8b2dcadd9afad9))
* a stacks entry may give its stack an id with id: (slice 5.9) ([4bc32ee](https://github.com/sluiceway/sluiceway/commit/4bc32ee7101042745438cb840fa632c6c2663b66))
* a strict input turns the scan job red on any preview failure (slice 5.9) ([76e48e7](https://github.com/sluiceway/sluiceway/commit/76e48e7a94642cc62ac1148ef02638216584e6a1))
* a tick by an account GitHub no longer has is refused, not unverified (slice 5.9) ([1d00538](https://github.com/sluiceway/sluiceway/commit/1d00538cc33bc8d88f0885d6ac66b4b49e2f93a9))
* attribution reads every file of a pull request past 100 and of a direct push past 300 (slice 5.9) ([e72fd15](https://github.com/sluiceway/sluiceway/commit/e72fd15f2a949d69aef8c0c333b239b9ddc4a19f))
* docs and tooling files that no stack claims force no full scan by default (slice 5.9) ([ae32b7b](https://github.com/sluiceway/sluiceway/commit/ae32b7b29654a2c7b43baf91dfcb2b24be4cb70d))
* looking for a closed dashboard reads one page of the closed issues that changed last (slice 5.9) ([7bc04b3](https://github.com/sluiceway/sluiceway/commit/7bc04b3e93d412059f648fc4bf8b2dcadd9afad9))
* merge and deploy reads the open pull requests past the oldest 1,000 (slice 5.9) ([88a5887](https://github.com/sluiceway/sluiceway/commit/88a58870ed522aee2168cb5b6d8fffab2263528d))
* resolve links to the scan it started, by the run GitHub names for the dispatch (slice 5.9) ([ddc868a](https://github.com/sluiceway/sluiceway/commit/ddc868ac77d696674baee719eab5301cc0322490))
* resolve writes a job summary of what happened to every tick (slice 5.9) ([ddc868a](https://github.com/sluiceway/sluiceway/commit/ddc868ac77d696674baee719eab5301cc0322490))
* sluiceway.yml is read as a second spelling of sluiceway.yaml (slice 5.9) ([19dd5d6](https://github.com/sluiceway/sluiceway/commit/19dd5d6c54185aaed942f260b03ce2fca27d17c2))
* the process runner holds at most 128 MB of each stream of the tool's output (slice 5.9) ([aad4630](https://github.com/sluiceway/sluiceway/commit/aad463067436e0465d9a523cde10edfc0ce6874c))
* the tool's stderr reaches the job log while a preview runs, each line behind its stack id (slice 5.9) ([aad4630](https://github.com/sluiceway/sluiceway/commit/aad463067436e0465d9a523cde10edfc0ce6874c))

## [0.20.1](https://github.com/sluiceway/sluiceway/compare/v0.20.0...v0.20.1) (2026-09-22)


### Bug Fixes

* a Recently deployed line fits on one line ([fca5fa2](https://github.com/sluiceway/sluiceway/commit/fca5fa21cdbc80a8832e83f685ac7d0005b608d9))

## [0.20.0](https://github.com/sluiceway/sluiceway/compare/v0.19.0...v0.20.0) (2026-09-22)


### Features

* a paged walk for the lookback and the files of a renaming pull request over REST (slice 5.5) ([e8989ba](https://github.com/sluiceway/sluiceway/commit/e8989ba542c2bf29cccb28e27f875fd9508079d2))
* attribution settings, the outside fold on a row and what a deploy shipped on the trail (slice 5.5) ([c72296b](https://github.com/sluiceway/sluiceway/commit/c72296bc00058712c0fefe8992abf74ff7c6601e))
* Helm part 2, drift, createNamespace, the deploy flag per helm version and nested charts ([807be66](https://github.com/sluiceway/sluiceway/commit/807be66223546a26d46675e00d443f97279e4a5a))
* record the Helm drift, deploy flag, namespace and nested chart scenarios ([3a89ae9](https://github.com/sluiceway/sluiceway/commit/3a89ae952c24db9a92e7de35ac9c5b4dabb4d838))
* scan, resolve and apply write what each deploy on the trail shipped (slice 5.5) ([49e246e](https://github.com/sluiceway/sluiceway/commit/49e246e501884484a00b45feb9ac1574280b3097))
* the Helm fixtures as CI recorded them (run 35738572765) ([65d52dd](https://github.com/sluiceway/sluiceway/commit/65d52ddb5397dedfb138afd8c7f3c70554fb58c9))
* the Helm fixtures of the new scenarios, on helm v3.18.0 and v4.3.0 ([d3534ff](https://github.com/sluiceway/sluiceway/commit/d3534ff505beebddbfc374fe758c770245d160b3))

## [0.19.0](https://github.com/sluiceway/sluiceway/compare/v0.18.0...v0.19.0) (2026-09-22)


### Features

* fixtures recorded on CI, a Terraform plan must be complete, the mixed e2e with seven tools ([5b8022a](https://github.com/sluiceway/sluiceway/commit/5b8022a55a3502fb6582fd56b17d072f3423bba1))
* the terraform binary, terragrunt and cdktf behind the OpenTofu adapter ([01c56f8](https://github.com/sluiceway/sluiceway/commit/01c56f8039a11fd0badd188becea6a281556ab38))

## [0.18.0](https://github.com/sluiceway/sluiceway/compare/v0.17.0...v0.18.0) (2026-09-22)


### Features

* a deploy made outside the dashboard is a line of the trail ([bac73f9](https://github.com/sluiceway/sluiceway/commit/bac73f90d7a70a209cea89f9c446583edd966b2d))
* a full scan reads each stack's history and puts outside deploys on the trail ([29c085e](https://github.com/sluiceway/sluiceway/commit/29c085e47911b6fc24f4b88ba848e633441a398e))
* the e2e checks that a stack deployed by hand is on the trail ([610bb99](https://github.com/sluiceway/sluiceway/commit/610bb99f642268d1abc867566dbb53e756b19ae5))
* the history fixtures as the CI fixtures job recorded them ([8e3c821](https://github.com/sluiceway/sluiceway/commit/8e3c821ed4a1eeda58b57c1a563d5db54f909da0))
* the Pulumi adapter reads the tool's own history of a stack ([1b7cc61](https://github.com/sluiceway/sluiceway/commit/1b7cc6123028779202859137f19004cec031ec9b))

## [0.17.0](https://github.com/sluiceway/sluiceway/compare/v0.16.0...v0.17.0) (2026-09-22)


### Features

* record the stacks the backend holds, for the check with backend: true ([ad1cfd6](https://github.com/sluiceway/sluiceway/commit/ad1cfd6f1bb7cf1e8ff3ca235864097d13cb7793))
* the check asks the backend with backend: true and gives one ignore block ([4206025](https://github.com/sluiceway/sluiceway/commit/42060258db6a9915a5be297df06ff685d3618477))
* the check reads concurrency groups, status checks and the second apply job ([74aee7f](https://github.com/sluiceway/sluiceway/commit/74aee7fc1f9710b8779fd22ee64565718014763f))
* the check suggests inputs from the files a stack's own files name ([6ad2a56](https://github.com/sluiceway/sluiceway/commit/6ad2a561314ee096020b6e5e975911a9cf4a22e2))
* wire the check part 3 into the check mode, its words and the backend input ([f9822fc](https://github.com/sluiceway/sluiceway/commit/f9822fc9e5497b5731b2054d5a81888b23efaba8))

## [0.16.0](https://github.com/sluiceway/sluiceway/compare/v0.15.0...v0.16.0) (2026-09-22)


### Features

* a pull request that two stacks claim qualifies, more than 30 updates, presets outside the repo (slice 5.4) ([ce0126e](https://github.com/sluiceway/sluiceway/commit/ce0126e49af02354c67d41796fa1639dd18d8995))
* mergeAndDeploy.preview shows what the merge of an update would change on its row (slice 5.4) ([5abfd29](https://github.com/sluiceway/sluiceway/commit/5abfd2989bdcdd14a0f93ad0ae1b6700b843919c))
* the whole loop on the fake for an update that two stacks claim (slice 5.4) ([f77db49](https://github.com/sluiceway/sluiceway/commit/f77db49d2351caa77f110a1146be8a9f4e17618a))

## [0.15.0](https://github.com/sluiceway/sluiceway/compare/v0.14.0...v0.15.0) (2026-09-22)


### Features

* phases in sluiceway.yaml, a phase per stack or read from its project file (slice 4.16) ([0109546](https://github.com/sluiceway/sluiceway/commit/010954675aa9ef40477200748e3b25b37bb085d1))
* resolve names the phase in a refusal, and the check lists phases and their edges (slice 4.16) ([ab6ba96](https://github.com/sluiceway/sluiceway/commit/ab6ba96ba3fb4bcdb3ce48845dcb55bbaf6276d6))

## [0.14.0](https://github.com/sluiceway/sluiceway/compare/v0.13.0...v0.14.0) (2026-09-22)


### Features

* init installs kubectl for the Kubernetes manifests stacks a kept sluiceway.yaml declares ([ded0e60](https://github.com/sluiceway/sluiceway/commit/ded0e60713e8e066d04ee8eb775d62c491abe6e1))
* init mode writes a starter workflow and sluiceway.yaml from the repo's files (slice 4.14) ([f2d2b53](https://github.com/sluiceway/sluiceway/commit/f2d2b53edd6a085c943860c943fc449ef5055965))
* init writes the merge and deploy workflow for a kept sluiceway.yaml with mergeAndDeploy.authors ([b0d902e](https://github.com/sluiceway/sluiceway/commit/b0d902ed40a3ba9d4f4feb7ba5e0c59092ba8350))
* rebuild dist with init after slice 4.13 ([e9e9c0c](https://github.com/sluiceway/sluiceway/commit/e9e9c0ce877338178081c49d552a969679caa083))
* rebuild dist with init after the Kubernetes adapter ([774564d](https://github.com/sluiceway/sluiceway/commit/774564df22dff9cf9376f91a62e5f0505a6f0366))
* rebuild dist with the init mode ([b971136](https://github.com/sluiceway/sluiceway/commit/b971136ed6d41fed46db07f2b69c590497cf3474))
* record 0065 and docs/init.md name the Kubernetes manifests adapter ([a72edaa](https://github.com/sluiceway/sluiceway/commit/a72edaa70845001999af73ce25abd097668e6601))
* record 0065, docs/init.md, the glossary, later.md and the onboarding log for init ([6e74edc](https://github.com/sluiceway/sluiceway/commit/6e74edcb2aeab1373c87d8aeddc6a5fed49489c6))
* the failing and deploying pictures show one crate per pending stack ([b47b9db](https://github.com/sluiceway/sluiceway/commit/b47b9db07d6133a17db50d03981c88835f63984a))

## [0.13.0](https://github.com/sluiceway/sluiceway/compare/v0.12.0...v0.13.0) (2026-09-22)


### Features

* a merge row whose tick was cleared without a comment gets a note, and more than ten updates are folded ([ae6770a](https://github.com/sluiceway/sluiceway/commit/ae6770a4d81529801033f76e07682d6486ef198d))
* record 0064 and the docs for merge and deploy, part 2, and dist rebuilt (slice 4.13) ([eb9b095](https://github.com/sluiceway/sluiceway/commit/eb9b095ad9d2d6b8d8e999b4c5485b01b7462a24))
* the merge method follows Renovate's config as Renovate reads it on GitHub ([85a5267](https://github.com/sluiceway/sluiceway/commit/85a5267669925a19bcd700ea1709fbd94f5d9ed2))
* the scan resolve dispatches after a merge is narrowed, through a dispatch input the workflow declares ([44fa60e](https://github.com/sluiceway/sluiceway/commit/44fa60e18096aa2ca73b40bcad6adf01612e2876))
* up to thirty updates waiting to merge, and open pull requests paged past the oldest 100 ([40b0ad0](https://github.com/sluiceway/sluiceway/commit/40b0ad07f866b0f9dffe72753e1b57124da2a3c3))

## [0.12.0](https://github.com/sluiceway/sluiceway/compare/v0.11.0...v0.12.0) (2026-09-22)


### Features

* deploying sits at the top, and its rows start with a spinner (slice 4.12) ([d977c4a](https://github.com/sluiceway/sluiceway/commit/d977c4a723f7571f1de3a3892a3a5b966aa72def))

## [0.11.0](https://github.com/sluiceway/sluiceway/compare/v0.10.0...v0.11.0) (2026-09-22)


### Features

* record 0060, the docs, CI recording of the kubectl fixtures, and the e2e with four tools ([15937c3](https://github.com/sluiceway/sluiceway/commit/15937c387a1f3ef942993406e87c662cee483013))
* the Kubernetes manifests adapter: declared stacks, kubectl diff and apply of one rendered set (slice 4.9) ([ea1a1e1](https://github.com/sluiceway/sluiceway/commit/ea1a1e1fb494e2e08f8adf0e24038b52f2d5f649))

## [0.10.0](https://github.com/sluiceway/sluiceway/compare/v0.9.0...v0.10.0) (2026-09-22)


### Features

* the check reads the workflow, and the result file gets a schema (slice 4.10) ([63e8d92](https://github.com/sluiceway/sluiceway/commit/63e8d923d4fd9c20ddfe7132c47db307ac9364ae))
* the trail lists failed deploys at the time each really ended, its length is a setting, and a destroy alert names pending destroys ([7a3f06c](https://github.com/sluiceway/sluiceway/commit/7a3f06c02e99f2a04424e754c15725dfa686c93f))

## [0.9.0](https://github.com/sluiceway/sluiceway/compare/v0.8.0...v0.9.0) (2026-09-22)


### Features

* a credential-free Helm example and the fixture recorder for it ([ec5e9a6](https://github.com/sluiceway/sluiceway/commit/ec5e9a635d3f1b3ccd839e242e5493ca9b22c0ce))
* a deploy the adapter refuses as moved ends like any moved change ([9304790](https://github.com/sluiceway/sluiceway/commit/930479061891aa8d244b25c860f5d276997e4221))
* CI records the Helm fixtures and the e2e runs three adapters ([f0444b1](https://github.com/sluiceway/sluiceway/commit/f0444b1e56ecd627445da6c53320e0a99c3f16c1))
* dependsOn: auto and drift per stack in sluiceway.yaml, and the check lists dependsOn ([a01f805](https://github.com/sluiceway/sluiceway/commit/a01f805dcea772cffffb5b4729a164ca70c81093))
* rebuild dist with the Helm adapter ([777cc7e](https://github.com/sluiceway/sluiceway/commit/777cc7e1a2ec5337f0669531e5ff2475d44670a9))
* record 0058 and the docs of the Helm adapter ([80046e6](https://github.com/sluiceway/sluiceway/commit/80046e6936deadbb9f32101ed3225d001ae16d7b))
* rows carry what a preview read, resolve waits on it, and drift gets a preview page and a trail line ([e7c2a6b](https://github.com/sluiceway/sluiceway/commit/e7c2a6b0e17740cd24ef822a419f647f4e6e3b18))
* the headlines of the job log start with the dot of the result (slice 4.5) ([7e2d61e](https://github.com/sluiceway/sluiceway/commit/7e2d61ee9ae96ddd4a74c5f26840188e646b433a))
* the Helm adapter: a release in a namespace is a stack ([288f454](https://github.com/sluiceway/sluiceway/commit/288f4549249100038bd2610899031fd584d39f0e))
* the Helm fixtures as the fixtures-helm job of CI recorded them ([79dd36d](https://github.com/sluiceway/sluiceway/commit/79dd36d1e3e46a10883de5e133157155db9cb29a))
* the Pulumi adapter reads the stacks a stack depends on from its stack references ([374f965](https://github.com/sluiceway/sluiceway/commit/374f9658ce5e79c18ff9314c5a92e426bfffaf65))
* the recently deployed list starts each line with the dot of its result (slice 4.5) ([4111fca](https://github.com/sluiceway/sluiceway/commit/4111fcac2df3789a86cd6d09526f6e8053ecae5a))
* the roadmap and the build plan count the Helm adapter as built ([24cb963](https://github.com/sluiceway/sluiceway/commit/24cb963eb42b15836424e0745d6f10ba3b0cdcd1))

## [0.8.0](https://github.com/sluiceway/sluiceway/compare/v0.7.0...v0.8.0) (2026-09-22)


### Features

* a tick on a drifted row that nothing picked up is swept like any other ([6d0d3b3](https://github.com/sluiceway/sluiceway/commit/6d0d3b349d16641ba1453fa661a99e1ed783f8fe))
* drift in the diff, the hash, config and the Pulumi adapter (record 0055) ([8904add](https://github.com/sluiceway/sluiceway/commit/8904addc77b9bdabc33817ae489e9acb40bdef1c))
* fixture scenarios with real drift, recorded through a streamed preview-only refresh ([8d99135](https://github.com/sluiceway/sluiceway/commit/8d99135c631039865a32f558ca6c261c2c8c9240))
* rebuild dist for drift ([61f8d2c](https://github.com/sluiceway/sluiceway/commit/61f8d2cfbc9e0ebfa33a6cf199c905cc0617a0d1))
* record 0055 and the docs for drift ([03ac9e6](https://github.com/sluiceway/sluiceway/commit/03ac9e6f62e22fd6cf1b8fd1e37388fd42507ac8))
* scans check drift, resolve carries it, apply checks it again and repairs it ([af58921](https://github.com/sluiceway/sluiceway/commit/af58921519d2c531207d0c8a1745b314cc4adcaa))
* the check summary lists drift among the known keys ([d27e459](https://github.com/sluiceway/sluiceway/commit/d27e4598b7484a3754fb2a81eda1353209c6179f))
* the deploy a merge hands to apply carries drift when its hash covers it ([037d93a](https://github.com/sluiceway/sluiceway/commit/037d93a02b243152ccb32327c43382b08039c822))
* the drift row, the Drifted section and the drift header picture ([5d103f5](https://github.com/sluiceway/sluiceway/commit/5d103f5ab27a634db2fb267ff213a8741b5269b8))

## [0.7.0](https://github.com/sluiceway/sluiceway/compare/v0.6.0...v0.7.0) (2026-09-22)


### Features

* a tick on an update waiting to merge merges it and opens a record that deploys after the merge (slice 4.2) ([f554990](https://github.com/sluiceway/sluiceway/commit/f55499017e353204f196c534171591304be4a016))
* merge and deploy in the e2e, the docs, record 0054, and dist (slice 4.2) ([d2cc931](https://github.com/sluiceway/sluiceway/commit/d2cc931e4cb6d60523a9cf10b01465197a8a508b))
* merge and deploy next to stack dependencies: no merge while a dependency waits, and an apply job for the scan's matrix (slice 4.2) ([aeacf17](https://github.com/sluiceway/sluiceway/commit/aeacf17a756ff61fe1ff6a965e13c5fb3a180434))
* mergeAndDeploy.authors, the qualification rule and the merge row (slice 4.2) ([3e704e8](https://github.com/sluiceway/sluiceway/commit/3e704e86deb10af4a4d1d71d028d071b0ae70cbf))
* the merge record, merge ticks in the edit history, and the pull request calls of the port (slice 4.2) ([ed01f0d](https://github.com/sluiceway/sluiceway/commit/ed01f0daa2ff71e13246fe6bf4beb754d1210b85))
* the scan lists updates waiting to merge and hands a merged change to apply (slice 4.2) ([cacf7aa](https://github.com/sluiceway/sluiceway/commit/cacf7aa0e45bb76fd010e75d03b74fad94e659cb))

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
