<!-- sluiceway:dashboard v="1" scan-sha="8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c" scan-run="17034455121" scan-at="2026-09-21T10:02:41Z" full-scan-at="2026-09-21T06:00:12Z" full-scan-run="17031200455" -->

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://placehold.co/880x140/0d1117/8b949e/png?text=mascot+placeholder+(dark,+state:+destroys+pending)">
  <img alt="Mascot placeholder" width="440" src="https://placehold.co/880x140/f6f8fa/57606a/png?text=mascot+placeholder+(light,+state:+destroys+pending)">
</picture>

**11 pending** · 2 deploying · 2 preview failed · 43 in sync · :warning: **4 pending stacks destroy resources** · 2 failed deploys

Scanned [`8c41f0e`](https://github.com/example-org/infra/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](https://github.com/example-org/infra/actions/runs/17034455121) · <sub>last full scan 2026-09-21 06:00 UTC</sub>

## Pending

Tick a box to deploy that stack exactly as its row shows it.

- [ ] **apps/api:prod** · 1 update · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/api:prod" state="pending" hash="39e0a1b2be3d3e32" -->
  from #5 by alice, #4 by renovate[bot] · [compare](https://github.com/example-org/infra/compare/b772f25...8c41f0e)
  Changes are listed in the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **apps/billing:staging** · 9 creates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/billing:staging" state="pending" hash="90b0b8c6b1b3721e" -->
  not deployed from this dashboard yet
  Changes are listed in the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **apps/legacy-worker:prod** · **3 deletes**, 1 tracking only · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/legacy-worker:prod" state="pending" hash="152798b7876b5b75" -->
  from #427 by dave · [compare](https://github.com/example-org/infra/compare/96eea80...8c41f0e)
  :warning: **deletes 3.** Read the [summary](https://github.com/example-org/infra/actions/runs/17034455121) before you tick.
  <!-- /sluiceway:row -->
- [ ] **apps/notifications:prod** · 1 create, 1 update · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/notifications:prod" state="pending" hash="289a5929db2c0b5f" -->
  from #428 by dave, and 3 changes outside this stack, and earlier changes · [compare](https://github.com/example-org/infra/compare/41f372f...8c41f0e)
  :information_source: a tick on this row was not picked up. Tick again to deploy.
  Changes are listed in the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **apps/search:prod** · 2 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/search:prod" state="pending" hash="4c3f613df560fff6" -->
  from #432 by carol, #426 by carol · [compare](https://github.com/example-org/infra/compare/c64461a...8c41f0e)
  :x: last deploy failed: the change moved since the tick · ticked by alice · 2026-09-21 08:52 UTC · [run](https://github.com/example-org/infra/actions/runs/17034120077)
  Changes are listed in the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **apps/web:prod** · 2 creates, 1 update · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/web:prod" state="pending" hash="bef5d89ef68174d1" -->
  from #418 by carol, and 2 changes outside this stack · [compare](https://github.com/example-org/infra/compare/cb1ad7d...8c41f0e)
  Changes are listed in the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **data/postgres:prod** · 2 updates, **1 replace** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="data/postgres:prod" state="pending" hash="7883ed5dcb875c42" -->
  from #431 by bob · [compare](https://github.com/example-org/infra/compare/f24988d...8c41f0e)
  :warning: **replaces 1.** Read the [summary](https://github.com/example-org/infra/actions/runs/17034455121) before you tick.
  <!-- /sluiceway:row -->
- [ ] **infra/dns:prod** · 1 update, 2 tracking only · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="infra/dns:prod" state="pending" hash="82c0db2ee98745f4" -->
  from 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/3e2b0d4...8c41f0e)
  Changes are listed in the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **monitoring/dashboards:prod** · 44 creates, 76 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="monitoring/dashboards:prod" state="pending" hash="24cea8e2c0d497b6" -->
  from #435 by erin · [compare](https://github.com/example-org/infra/compare/1316f8f...8c41f0e)
  Changes are listed in the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **platform/ingress:prod** · 12 creates, 33 updates, **1 replace** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="platform/ingress:prod" state="pending" hash="8586825b57f4a953" -->
  from #436 by renovate[bot], #434 by carol, #430 by renovate[bot], #425 by bob, #421 by renovate[bot], and 2 more, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/8ebfb49...8c41f0e)
  :warning: **replaces 1.** Read the [summary](https://github.com/example-org/infra/actions/runs/17034455121) before you tick.
  <!-- /sluiceway:row -->
- [ ] **storage/buckets:prod** · 1 create, 1 update, **1 replace**, **1 delete**, 1 tracking only · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="storage/buckets:prod" state="pending" hash="2b44350653e84be9" -->
  from #433 by alice, #429 by alice, [3fa9c1e](https://github.com/example-org/infra/commit/3fa9c1e) by bob, and 1 change outside this stack · [compare](https://github.com/example-org/infra/compare/c7dbfa5...8c41f0e)
  :warning: **deletes 1, replaces 1.** Read the [summary](https://github.com/example-org/infra/actions/runs/17034455121) before you tick.
  <!-- /sluiceway:row -->

## Deploying

- **platform/cert-manager:prod** · deploying · ticked by carol · [run](https://github.com/example-org/infra/actions/runs/17034501999) <!-- sluiceway:row stack="platform/cert-manager:prod" state="deploying" -->
  from #437 by renovate[bot] · [compare](https://github.com/example-org/infra/compare/06ed191...8c41f0e)
  <!-- /sluiceway:row -->
- **apps/web:staging** · waiting to start · ticked by alice · [run](https://github.com/example-org/infra/actions/runs/17034502113) <!-- sluiceway:row stack="apps/web:staging" state="deploying" -->
  from #418 by carol, and 2 changes outside this stack · [compare](https://github.com/example-org/infra/compare/8429482...8c41f0e)
  <!-- /sluiceway:row -->

## Preview failed

These stacks could not be previewed, so they cannot be deployed from here until a scan succeeds.

- **monitoring/loki:prod** · preview failed: the preview timed out after 10 minutes · [run](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="monitoring/loki:prod" state="preview-failed" -->
  <!-- /sluiceway:row -->
- **data/redis:staging** · preview failed: the tool exited with an error (exit code 255) · [run](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="data/redis:staging" state="preview-failed" -->
  <!-- /sluiceway:row -->

## In sync

- data/warehouse:prod <!-- sluiceway:row stack="data/warehouse:prod" state="in-sync" -->
  :x: last deploy failed: the run ended without reporting a result · ticked by bob · 2026-09-19 16:03 UTC · [run](https://github.com/example-org/infra/actions/runs/17019884120)
  <!-- /sluiceway:row -->

<details><summary>42 more in sync</summary>

- apps/admin:prod <!-- sluiceway:row stack="apps/admin:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/admin:staging <!-- sluiceway:row stack="apps/admin:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/api:staging <!-- sluiceway:row stack="apps/api:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/auth:prod <!-- sluiceway:row stack="apps/auth:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/auth:staging <!-- sluiceway:row stack="apps/auth:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/billing:prod <!-- sluiceway:row stack="apps/billing:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/docs:prod <!-- sluiceway:row stack="apps/docs:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/notifications:staging <!-- sluiceway:row stack="apps/notifications:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/search:staging <!-- sluiceway:row stack="apps/search:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/worker:prod <!-- sluiceway:row stack="apps/worker:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- apps/worker:staging <!-- sluiceway:row stack="apps/worker:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- data/kafka:prod <!-- sluiceway:row stack="data/kafka:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- data/kafka:staging <!-- sluiceway:row stack="data/kafka:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- data/postgres:staging <!-- sluiceway:row stack="data/postgres:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- data/redis:prod <!-- sluiceway:row stack="data/redis:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- infra/bastion:prod <!-- sluiceway:row stack="infra/bastion:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- infra/cluster:prod <!-- sluiceway:row stack="infra/cluster:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- infra/cluster:staging <!-- sluiceway:row stack="infra/cluster:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- infra/dns:staging <!-- sluiceway:row stack="infra/dns:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- infra/iam:prod <!-- sluiceway:row stack="infra/iam:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- infra/kms:prod <!-- sluiceway:row stack="infra/kms:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- infra/network:prod <!-- sluiceway:row stack="infra/network:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- infra/network:staging <!-- sluiceway:row stack="infra/network:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- infra/registry:prod <!-- sluiceway:row stack="infra/registry:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- infra/vpn:prod <!-- sluiceway:row stack="infra/vpn:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- monitoring/alertmanager:prod <!-- sluiceway:row stack="monitoring/alertmanager:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- monitoring/grafana:prod <!-- sluiceway:row stack="monitoring/grafana:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- monitoring/prometheus:prod <!-- sluiceway:row stack="monitoring/prometheus:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- monitoring/prometheus:staging <!-- sluiceway:row stack="monitoring/prometheus:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- monitoring/tempo:prod <!-- sluiceway:row stack="monitoring/tempo:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- monitoring/uptime:prod <!-- sluiceway:row stack="monitoring/uptime:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- platform/argo-workflows:prod <!-- sluiceway:row stack="platform/argo-workflows:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- platform/cert-manager:staging <!-- sluiceway:row stack="platform/cert-manager:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- platform/external-dns:prod <!-- sluiceway:row stack="platform/external-dns:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- platform/external-secrets:prod <!-- sluiceway:row stack="platform/external-secrets:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- platform/ingress:staging <!-- sluiceway:row stack="platform/ingress:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- platform/karpenter:prod <!-- sluiceway:row stack="platform/karpenter:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- platform/policy:prod <!-- sluiceway:row stack="platform/policy:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- platform/service-mesh:prod <!-- sluiceway:row stack="platform/service-mesh:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- storage/backups:prod <!-- sluiceway:row stack="storage/backups:prod" state="in-sync" -->
  <!-- /sluiceway:row -->
- storage/buckets:staging <!-- sluiceway:row stack="storage/buckets:staging" state="in-sync" -->
  <!-- /sluiceway:row -->
- storage/cdn:prod <!-- sluiceway:row stack="storage/cdn:prod" state="in-sync" -->
  <!-- /sluiceway:row -->

</details>

## Recently deployed

- apps/auth:prod · ticked by alice · 2026-09-21 09:41 UTC · [run](https://github.com/example-org/infra/actions/runs/17034388102)
- apps/auth:staging · ticked by alice · 2026-09-21 09:12 UTC · [run](https://github.com/example-org/infra/actions/runs/17034120455)
- platform/external-dns:prod · ticked by carol · 2026-09-20 17:30 UTC · [run](https://github.com/example-org/infra/actions/runs/17029910331)
- infra/network:staging · ticked by bob · 2026-09-20 14:02 UTC · [run](https://github.com/example-org/infra/actions/runs/17027745120)
- apps/worker:prod · ticked by dave · 2026-09-19 11:47 UTC · [run](https://github.com/example-org/infra/actions/runs/17018803377)
- apps/worker:staging · ticked by dave · 2026-09-19 11:20 UTC · [run](https://github.com/example-org/infra/actions/runs/17018650912)
- monitoring/grafana:prod · ticked by erin · 2026-09-18 15:55 UTC · [run](https://github.com/example-org/infra/actions/runs/17009921140)
- storage/cdn:prod · ticked by bob · 2026-09-18 10:08 UTC · [run](https://github.com/example-org/infra/actions/runs/17007112054)

---

- [ ] Rescan all stacks <!-- sluiceway:rescan -->

<sub>[Sluiceway](https://github.com/sluiceway/sluiceway) v0.0.0-prototype · [docs](https://github.com/sluiceway/sluiceway#readme)</sub>
