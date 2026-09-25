<!-- sluiceway:dashboard v="1" scan-sha="34e410f2ce7bd7cfd94d9a2f1d5bc0b2dcc6aa91" scan-run="17034455121" scan-at="2026-09-21T10:02:41Z" full-scan-at="2026-09-21T06:00:12Z" full-scan-run="17031200455" -->

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/sluiceway/sluiceway/v0.43.0/assets/mascot/deploying-4-deletes-replaces-dark.svg">
    <img alt="Sluiceway: deploying, 4 stacks are pending, some changes delete or replace resources" width="880" src="https://raw.githubusercontent.com/sluiceway/sluiceway/v0.43.0/assets/mascot/deploying-4-deletes-replaces-light.svg">
  </picture>
</p>

<div align="center">

🟡&nbsp;**4 pending** · 🟠&nbsp;2 drifted · 🔵&nbsp;2 deploying · ⚪&nbsp;0 preview failed · 🟢&nbsp;8 in sync · :warning: **2 pending stacks delete or replace resources**

Scanned [`34e410f`](https://github.com/example-org/infra/commit/34e410f2ce7bd7cfd94d9a2f1d5bc0b2dcc6aa91) on 2026-09-21 10:02 UTC · [run](https://github.com/example-org/infra/actions/runs/17034455121) · <sub>last full scan 2026-09-21 06:00 UTC</sub>

</div>

## Deploying

- <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/sluiceway/sluiceway/v0.43.0/assets/mascot/spinner-dark.svg"><img alt="" width="16" height="16" src="https://raw.githubusercontent.com/sluiceway/sluiceway/v0.43.0/assets/mascot/spinner-light.svg"></picture> **apps/api:prod** · deploying · ticked by alice · [run](https://github.com/example-org/infra/actions/runs/17034467330) <!-- sluiceway:row stack="apps/api:prod" state="deploying" -->
  from #512 by alice · [compare](https://github.com/example-org/infra/compare/e27f50794430...34e410f2ce7b)
  <!-- /sluiceway:row -->
- <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/sluiceway/sluiceway/v0.43.0/assets/mascot/spinner-queued-dark.svg"><img alt="" width="16" height="16" src="https://raw.githubusercontent.com/sluiceway/sluiceway/v0.43.0/assets/mascot/spinner-queued-light.svg"></picture> **apps/worker:prod** · queued behind **apps/api:prod** · ticked by alice · [run](https://github.com/example-org/infra/actions/runs/17034467330) <!-- sluiceway:row stack="apps/worker:prod" state="queued" behind="apps/api:prod" -->
  from #509 by bob · [compare](https://github.com/example-org/infra/compare/ae93aa6a808a...34e410f2ce7b)
  <!-- /sluiceway:row -->

## Updates waiting to merge

Tick a box to merge that pull request. Its stack is then previewed again and deployed as that preview shows it.

- [ ] **platform/ingress-nginx:prod** · Update Helm release ingress-nginx to v4.13 · #519 by renovate&#91;bot&#93; · preview after the merge: 1 update <!-- sluiceway:merge pr="519" stack="platform/ingress-nginx:prod" head="32d634bb4e4fcf75f93bccbc43860dc17b62c088" -->

These wait on their own checks. Each gets a box here once its checks are green.

- **apps/web:prod** · Update dependency next to v15.5 · #521 by renovate&#91;bot&#93; · waits on its checks <!-- sluiceway:waiting pr="521" stack="apps/web:prod" -->

## Pending

Tick a box to deploy that stack exactly as its row shows it.

> [!CAUTION]
> 2 pending stacks delete or replace resources: **apps/legacy-worker:prod**, **infra/network:prod**
>
> 1 drifted stack has resources gone outside the code: **platform/external-dns:prod**

- [ ] **apps/billing:prod** · 1 create, 1 update · [preview](https://github.com/example-org/infra/runs/48213301) <!-- sluiceway:row stack="apps/billing:prod" state="pending" hash="1d0a03db50bc7070" creates="1" updates="1" -->
  from #514 by erin, #511 by renovate&#91;bot&#93; · [compare](https://github.com/example-org/infra/compare/92a260fb62d8...34e410f2ce7b)
  <details><summary>2 changes</summary>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>billing</b> · <code>spec.replicas</code> <code>2</code> → <code>3</code><br>
  <kbd>create</kbd> <code>kubernetes:monitoring.coreos.com/v1:ServiceMonitor</code> <b>billing</b><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **apps/legacy-worker:prod** · **3 deletes**, 1 tracking only · [preview](https://github.com/example-org/infra/runs/48213302) <!-- sluiceway:row stack="apps/legacy-worker:prod" state="pending" hash="63a63bc225aca792" destroys="3" deletes="3" tracking="1" -->
  from #498 by dave · [compare](https://github.com/example-org/infra/compare/461a661f5643...34e410f2ce7b)
  :warning: <kbd>DELETE</kbd> <code>aws:sqs/queue:Queue</code> <b>legacy-jobs</b>
  :warning: <kbd>DELETE</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>legacy-worker</b>
  :warning: <kbd>DELETE</kbd> <code>kubernetes:core/v1:Service</code> <b>legacy-worker</b>
  <details><summary>1 other change</summary>
  <kbd>forget</kbd> <code>aws:iam/role:Role</code> <b>legacy-worker</b><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **apps/web:staging** · 2 creates, 1 update · [preview](https://github.com/example-org/infra/runs/48213303) <!-- sluiceway:row stack="apps/web:staging" state="pending" hash="ec5ef272e21b14c0" creates="2" updates="1" -->
  from #516 by carol, #510 by bob, and 1 change outside this stack · [compare](https://github.com/example-org/infra/compare/aa6e427d334b...34e410f2ce7b)
  <details><summary>3 changes</summary>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>web</b> · <code>metadata.labels&#91;&quot;app.kubernetes.io/version&quot;&#93;</code>, <code>spec.template.spec.containers&#91;0&#93;.image</code><br>
  <kbd>create</kbd> <code>kubernetes:autoscaling/v2:HorizontalPodAutoscaler</code> <b>web</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>web-feature-flags</b><br>
  </details>
  <details><summary>changes outside this stack</summary>
  <a href="https://github.com/example-org/infra/pull/497">#497</a> by frank<br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **infra/network:prod** · 1 update, **1 replace** · [preview](https://github.com/example-org/infra/runs/48213304) <!-- sluiceway:row stack="infra/network:prod" state="pending" hash="32cbe8fae705b3a9" destroys="1" deletes="0" updates="1" replaces="1" -->
  from [11fa403](https://github.com/example-org/infra/commit/11fa403908e7cf940afa4635f39fb7d8bf5f0eaa) by gina · [compare](https://github.com/example-org/infra/compare/55050087957c...34e410f2ce7b)
  :warning: <kbd>REPLACE</kbd> <code>aws:ec2/subnet:Subnet</code> <b>private-b</b> · forced by <code>cidrBlock</code>
  <details><summary>1 other change</summary>
  <kbd>update</kbd> <code>aws:ec2/routeTable:RouteTable</code> <b>private</b> · <code>routes&#91;1&#93;.natGatewayId</code><br>
  </details>
  <!-- /sluiceway:row -->

- [ ] Deploy all 4 pending stacks <!-- sluiceway:bulk section="pending" -->

## Drifted

Real infrastructure changed outside the code. Deploying a stack puts it back as its code says.

- [ ] **monitoring/grafana:prod** · 1 changed outside the code · [preview](https://github.com/example-org/infra/runs/48213305) <!-- sluiceway:row stack="monitoring/grafana:prod" state="drift" hash="3317badb7e6c946b" drift="true" changed="1" -->
  <details><summary>1 change outside the code</summary>
  <kbd>changed</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>grafana</b> · <code>spec.replicas</code><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **platform/external-dns:prod** · 1 gone outside the code · [preview](https://github.com/example-org/infra/runs/48213306) <!-- sluiceway:row stack="platform/external-dns:prod" state="drift" hash="78b602d7bc070d24" drift="true" gone="1" -->
  <details><summary>1 change outside the code</summary>
  <kbd>gone</kbd> <code>aws:route53/record:Record</code> <b>status-cname</b><br>
  </details>
  <!-- /sluiceway:row -->

- [ ] **Confirm:** repair all 2 drifted stacks: **monitoring/grafana:prod**, **platform/external-dns:prod** · asked by carol <!-- sluiceway:bulk section="drift" confirm="carol" stacks="monitoring/grafana:prod,platform/external-dns:prod" hashes="3317badb7e6c946b,78b602d7bc070d24" scan-run="17034455121" -->
  Ticking this deploys each stack as its row shows it, in dependency order. A change to these rows first takes it back.

## In sync

<details><summary>8 stacks in sync</summary>

- apps/api:staging <!-- sluiceway:row stack="apps/api:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/auth:prod <!-- sluiceway:row stack="apps/auth:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/auth:staging <!-- sluiceway:row stack="apps/auth:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/billing:staging <!-- sluiceway:row stack="apps/billing:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/web:prod <!-- sluiceway:row stack="apps/web:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- data/postgres:prod <!-- sluiceway:row stack="data/postgres:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- data/postgres:staging <!-- sluiceway:row stack="data/postgres:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- platform/ingress-nginx:prod <!-- sluiceway:row stack="platform/ingress-nginx:prod" state="in-sync" -->
  <!-- /sluiceway:row -->

</details>

<details><summary>1 stack left out by ignore</summary>

- sandbox/playground:dev · a scratch stack, deployed by hand

</details>

## Recently deployed

Times are in UTC.

- 🟢&nbsp;apps/auth:prod · alice · 09-21 09:41 · [run](https://github.com/example-org/infra/actions/runs/17034388102)
  shipped #513 by alice · [compare](https://github.com/example-org/infra/compare/ae93aa6a808a...4a35e6dd48fe)
- 🟢&nbsp;data/postgres:prod · deployed outside the dashboard, from [`35bf0b7`](https://github.com/example-org/infra/commit/35bf0b7251cdfd47085dc72ea2ba4c6aff3b7237) · 09-21 09:30 <!-- sluiceway:outside stack="data/postgres:prod" kind="deploy" at="2026-09-21T09:30:18.000Z" commit="35bf0b7251cdfd47085dc72ea2ba4c6aff3b7237" -->
- ⚪&nbsp;apps/auth:staging · no changes · alice · 09-21 09:12 · [run](https://github.com/example-org/infra/actions/runs/17034120455)
- 🟢&nbsp;platform/ingress-nginx:prod · drift fixed · carol · 09-20 18:05 · [run](https://github.com/example-org/infra/actions/runs/17030044170)
- 🟢&nbsp;apps/web:prod · bob · 09-20 16:52 · [run](https://github.com/example-org/infra/actions/runs/17029910331)
  shipped #510 by bob · [compare](https://github.com/example-org/infra/compare/ae93aa6a808a...92a260fb62d8)
- 🔴&nbsp;apps/web:prod · failed · bob · 09-20 16:40 · [run](https://github.com/example-org/infra/actions/runs/17029855012)

---

- [ ] Rescan all stacks <!-- sluiceway:rescan -->

<sub>[Sluiceway](https://github.com/sluiceway/sluiceway) v0.43.0 · [docs](https://docs.sluiceway.dev/)</sub>
