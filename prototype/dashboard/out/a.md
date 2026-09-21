<!-- sluiceway:dashboard v="1" scan-sha="8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c" scan-run="17034455121" scan-at="2026-09-21T10:02:41Z" full-scan-at="2026-09-21T06:00:12Z" full-scan-run="17031200455" -->

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://placehold.co/880x140/0d1117/8b949e/png?text=mascot+placeholder+(dark,+state:+destroys+pending)">
  <img alt="Mascot placeholder" width="440" src="https://placehold.co/880x140/f6f8fa/57606a/png?text=mascot+placeholder+(light,+state:+destroys+pending)">
</picture>

**11 pending** · 2 deploying · 2 preview failed · 43 in sync · :warning: **4 pending stacks destroy resources** · 2 failed deploys

Scanned [`8c41f0e`](https://github.com/example-org/infra/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](https://github.com/example-org/infra/actions/runs/17034455121) · <sub>last full scan 2026-09-21 06:00 UTC</sub>

## Pending

Tick a box to deploy that stack exactly as its row shows it.

> [!CAUTION]
> 4 pending stacks would destroy resources: **apps/legacy-worker:prod** (deletes 3), **data/postgres:prod** (replaces 1), **platform/ingress:prod** (replaces 1), **storage/buckets:prod** (deletes 1, replaces 1).

- [ ] **apps/api:prod** · `+0 ~1 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/api:prod" state="pending" hash="39e0a1b2be3d3e32" -->
  from #5 by alice, #4 by renovate[bot] · [compare](https://github.com/example-org/infra/compare/b772f25...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apps/v1:Deployment  api  [spec]
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **apps/billing:staging** · `+9 ~0 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/billing:staging" state="pending" hash="90b0b8c6b1b3721e" -->
  not deployed from this dashboard yet
  <details><summary>Show changes</summary>

  ```diff
  +  create   kubernetes:core/v1:ConfigMap  billing-canary-6
  +  create   kubernetes:core/v1:ConfigMap  billing-leader-election-1
  +  create   kubernetes:core/v1:ConfigMap  billing-private-7
  +  create   kubernetes:core/v1:Service  billing-default-backend-2
  +  create   kubernetes:core/v1:Service  billing-metrics-5
  +  create   kubernetes:core/v1:Service  billing-tcp-services-9
  +  create   kubernetes:networking.k8s.io/v1:Ingress  billing-config-3
  +  create   kubernetes:networking.k8s.io/v1:Ingress  billing-udp-services-4
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  billing-udp-services-8
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **apps/legacy-worker:prod** · `+0 ~0 +-0 -3` · 1 tracking only · :warning: **deletes 3** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/legacy-worker:prod" state="pending" hash="152798b7876b5b75" destroys="3" -->
  from #427 by dave · [compare](https://github.com/example-org/infra/compare/96eea80...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  -  delete   aws:sqs/queue:Queue  legacy-jobs
  -  delete   kubernetes:apps/v1:Deployment  legacy-worker
  -  delete   kubernetes:core/v1:Service  legacy-worker
     forget   aws:iam/role:Role  legacy-worker
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **apps/notifications:prod** · `+1 ~1 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/notifications:prod" state="pending" hash="289a5929db2c0b5f" -->
  from #428 by dave, and 3 changes outside this stack, and earlier changes · [compare](https://github.com/example-org/infra/compare/41f372f...8c41f0e)
  :information_source: a tick on this row was not picked up. Tick again to deploy.
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apps/v1:Deployment  notifications  [spec]
  +  create   kubernetes:batch/v1:CronJob  digest
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **apps/search:prod** · `+0 ~2 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/search:prod" state="pending" hash="4c3f613df560fff6" failed="true" -->
  from #432 by carol, #426 by carol · [compare](https://github.com/example-org/infra/compare/c64461a...8c41f0e)
  :x: last deploy failed: the change moved since the tick · ticked by alice · 2026-09-21 08:52 UTC · [run](https://github.com/example-org/infra/actions/runs/17034120077)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apps/v1:StatefulSet  search  [spec]
  ~  update   kubernetes:core/v1:ConfigMap  search-config  [data]
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **apps/web:prod** · `+2 ~1 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/web:prod" state="pending" hash="bef5d89ef68174d1" -->
  from #418 by carol, and 2 changes outside this stack · [compare](https://github.com/example-org/infra/compare/cb1ad7d...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apps/v1:Deployment  web  [spec, metadata]
  +  create   kubernetes:autoscaling/v2:HorizontalPodAutoscaler  web
  +  create   kubernetes:core/v1:ConfigMap  web-feature-flags
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **data/postgres:prod** · `+0 ~2 +-1 -0` · :warning: **replaces 1** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="data/postgres:prod" state="pending" hash="7883ed5dcb875c42" destroys="1" -->
  from #431 by bob · [compare](https://github.com/example-org/infra/compare/f24988d...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  -+ replace  aws:rds/instance:Instance  main  [engineVersion (forces replace), instanceClass, storageType (forces replace)]
  ~  update   aws:cloudwatch/metricAlarm:MetricAlarm  main-cpu  [dimensions]
  ~  update   aws:rds/parameterGroup:ParameterGroup  main  [parameters]
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **infra/dns:prod** · `+0 ~1 +-0 -0` · 2 tracking only · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="infra/dns:prod" state="pending" hash="82c0db2ee98745f4" -->
  from 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/3e2b0d4...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   cloudflare:index/record:Record  api  [ttl]
     import   cloudflare:index/record:Record  docs
     import   cloudflare:index/record:Record  status-page
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **monitoring/dashboards:prod** · `+44 ~76 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="monitoring/dashboards:prod" state="pending" hash="24cea8e2c0d497b6" -->
  from #435 by erin · [compare](https://github.com/example-org/infra/compare/1316f8f...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-admission-26
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-canary-8  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-config-45
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-config-85  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-config-92  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-controller-3
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-controller-6  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-external-118
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-external-40  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-external-69  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-internal-96  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-leader-election-119  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-leader-election-47  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-private-50  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-private-7
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-public-23  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-public-27
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-tcp-services-74  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  dashboard-udp-services-111  [spec]
  ~  update   kubernetes:apps/v1:Deployment  dashboard-admission-15  [spec]
  +  create   kubernetes:apps/v1:Deployment  dashboard-admission-55
  ~  update   kubernetes:apps/v1:Deployment  dashboard-config-70  [spec]
  +  create   kubernetes:apps/v1:Deployment  dashboard-controller-109
  +  create   kubernetes:apps/v1:Deployment  dashboard-external-104
  ~  update   kubernetes:apps/v1:Deployment  dashboard-external-106  [spec]
  ~  update   kubernetes:apps/v1:Deployment  dashboard-external-72  [spec]
  ~  update   kubernetes:apps/v1:Deployment  dashboard-external-91  [spec]
  +  create   kubernetes:apps/v1:Deployment  dashboard-internal-43
  ~  update   kubernetes:apps/v1:Deployment  dashboard-leader-election-100  [spec]
  ~  update   kubernetes:apps/v1:Deployment  dashboard-leader-election-2  [spec]
  ~  update   kubernetes:apps/v1:Deployment  dashboard-leader-election-22  [spec]
  +  create   kubernetes:apps/v1:Deployment  dashboard-leader-election-53
  +  create   kubernetes:apps/v1:Deployment  dashboard-metrics-57
  ~  update   kubernetes:apps/v1:Deployment  dashboard-public-103  [spec]
  ~  update   kubernetes:apps/v1:Deployment  dashboard-udp-services-10  [spec]
  ~  update   kubernetes:apps/v1:Deployment  dashboard-udp-services-112  [spec]
  ~  update   kubernetes:core/v1:ConfigMap  dashboard-admission-21  [data]
  ~  update   kubernetes:core/v1:ConfigMap  dashboard-canary-31  [data]
  +  create   kubernetes:core/v1:ConfigMap  dashboard-canary-64
  ~  update   kubernetes:core/v1:ConfigMap  dashboard-config-42  [data]
  +  create   kubernetes:core/v1:ConfigMap  dashboard-controller-11
  +  create   kubernetes:core/v1:ConfigMap  dashboard-default-backend-101
  ~  update   kubernetes:core/v1:ConfigMap  dashboard-default-backend-51  [data]
  ~  update   kubernetes:core/v1:ConfigMap  dashboard-default-backend-81  [data]
  +  create   kubernetes:core/v1:ConfigMap  dashboard-default-backend-94
  ~  update   kubernetes:core/v1:ConfigMap  dashboard-external-88  [data]
  +  create   kubernetes:core/v1:ConfigMap  dashboard-internal-56
  ~  update   kubernetes:core/v1:ConfigMap  dashboard-leader-election-16  [data]
  +  create   kubernetes:core/v1:ConfigMap  dashboard-leader-election-89
  +  create   kubernetes:core/v1:ConfigMap  dashboard-metrics-58
  ~  update   kubernetes:core/v1:ConfigMap  dashboard-metrics-76  [data]
  +  create   kubernetes:core/v1:ConfigMap  dashboard-private-36
  ~  update   kubernetes:core/v1:ConfigMap  dashboard-public-34  [data]
  ~  update   kubernetes:core/v1:ConfigMap  dashboard-tcp-services-61  [data]
  ~  update   kubernetes:core/v1:ConfigMap  dashboard-udp-services-41  [data]
  ~  update   kubernetes:core/v1:ConfigMap  dashboard-webhook-44  [data]
  ~  update   kubernetes:core/v1:ServiceAccount  dashboard-default-backend-12  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  dashboard-external-9  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  dashboard-internal-54  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  dashboard-internal-86
  +  create   kubernetes:core/v1:ServiceAccount  dashboard-leader-election-52
  ~  update   kubernetes:core/v1:ServiceAccount  dashboard-leader-election-98  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  dashboard-private-110
  ~  update   kubernetes:core/v1:ServiceAccount  dashboard-private-99  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  dashboard-public-93  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  dashboard-tcp-services-19
  ~  update   kubernetes:core/v1:ServiceAccount  dashboard-udp-services-102  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  dashboard-udp-services-17
  ~  update   kubernetes:core/v1:ServiceAccount  dashboard-udp-services-28  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  dashboard-udp-services-75  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  dashboard-webhook-115  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  dashboard-webhook-35
  +  create   kubernetes:core/v1:ServiceAccount  dashboard-webhook-37
  ~  update   kubernetes:core/v1:ServiceAccount  dashboard-webhook-82  [metadata]
  +  create   kubernetes:core/v1:Service  dashboard-admission-18
  ~  update   kubernetes:core/v1:Service  dashboard-canary-49  [spec]
  +  create   kubernetes:core/v1:Service  dashboard-canary-78
  +  create   kubernetes:core/v1:Service  dashboard-config-24
  ~  update   kubernetes:core/v1:Service  dashboard-controller-14  [spec]
  ~  update   kubernetes:core/v1:Service  dashboard-controller-97  [spec]
  +  create   kubernetes:core/v1:Service  dashboard-external-59
  ~  update   kubernetes:core/v1:Service  dashboard-external-66  [spec]
  ~  update   kubernetes:core/v1:Service  dashboard-internal-1  [spec]
  ~  update   kubernetes:core/v1:Service  dashboard-leader-election-73  [spec]
  ~  update   kubernetes:core/v1:Service  dashboard-metrics-87  [spec]
  ~  update   kubernetes:core/v1:Service  dashboard-private-95  [spec]
  +  create   kubernetes:core/v1:Service  dashboard-tcp-services-25
  +  create   kubernetes:core/v1:Service  dashboard-udp-services-63
  +  create   kubernetes:core/v1:Service  dashboard-udp-services-80
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  dashboard-admission-71  [spec, metadata]
  +  create   kubernetes:networking.k8s.io/v1:Ingress  dashboard-admission-79
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  dashboard-canary-33  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  dashboard-canary-77  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  dashboard-controller-107  [spec, metadata]
  +  create   kubernetes:networking.k8s.io/v1:Ingress  dashboard-controller-29
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  dashboard-default-backend-108  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  dashboard-external-60  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  dashboard-metrics-84  [spec, metadata]
  +  create   kubernetes:networking.k8s.io/v1:Ingress  dashboard-private-116
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  dashboard-public-30  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  dashboard-webhook-46  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  dashboard-webhook-67  [spec, metadata]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-admission-105  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-admission-5  [rules]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-admission-62
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-canary-65  [rules]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-canary-83
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-controller-13  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-default-backend-117  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-default-backend-120  [rules]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-external-39
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-external-48  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-internal-4  [rules]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-internal-68
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-metrics-113  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-private-114  [rules]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-udp-services-20
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-udp-services-38
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-webhook-32  [rules]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  dashboard-webhook-90
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **platform/ingress:prod** · `+12 ~33 +-1 -0` · :warning: **replaces 1** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="platform/ingress:prod" state="pending" hash="8586825b57f4a953" destroys="1" -->
  from #436 by renovate[bot], #434 by carol, #430 by renovate[bot], #425 by bob, #421 by renovate[bot], and 2 more, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/8ebfb49...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  -+ replace  kubernetes:batch/v1:Job  ingress-admission-patch  [spec (forces replace)]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  ingress-admission-17  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  ingress-config-12  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  ingress-controller-10  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  ingress-internal-23  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  ingress-leader-election-14
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  ingress-metrics-35
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  ingress-public-28  [spec]
  ~  update   kubernetes:apps/v1:Deployment  ingress-canary-6  [spec]
  ~  update   kubernetes:apps/v1:Deployment  ingress-leader-election-15  [spec]
  ~  update   kubernetes:apps/v1:Deployment  ingress-public-11  [spec]
  ~  update   kubernetes:apps/v1:Deployment  ingress-public-32  [spec]
  +  create   kubernetes:apps/v1:Deployment  ingress-udp-services-16
  ~  update   kubernetes:apps/v1:Deployment  ingress-udp-services-25  [spec]
  ~  update   kubernetes:core/v1:ConfigMap  ingress-admission-18  [data]
  ~  update   kubernetes:core/v1:ConfigMap  ingress-admission-8  [data]
  ~  update   kubernetes:core/v1:ConfigMap  ingress-controller-2  [data]
  ~  update   kubernetes:core/v1:ConfigMap  ingress-private-27  [data]
  ~  update   kubernetes:core/v1:ConfigMap  ingress-udp-services-1  [data]
  +  create   kubernetes:core/v1:ConfigMap  ingress-udp-services-20
  ~  update   kubernetes:core/v1:ServiceAccount  ingress-admission-43  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  ingress-leader-election-4
  +  create   kubernetes:core/v1:ServiceAccount  ingress-metrics-33
  +  create   kubernetes:core/v1:ServiceAccount  ingress-metrics-9
  ~  update   kubernetes:core/v1:ServiceAccount  ingress-private-22  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  ingress-public-45  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  ingress-tcp-services-42
  +  create   kubernetes:core/v1:ServiceAccount  ingress-tcp-services-7
  ~  update   kubernetes:core/v1:Service  ingress-admission-36  [spec]
  ~  update   kubernetes:core/v1:Service  ingress-admission-38  [spec]
  +  create   kubernetes:core/v1:Service  ingress-admission-41
  +  create   kubernetes:core/v1:Service  ingress-canary-19
  ~  update   kubernetes:core/v1:Service  ingress-internal-37  [spec]
  ~  update   kubernetes:core/v1:Service  ingress-leader-election-31  [spec]
  ~  update   kubernetes:core/v1:Service  ingress-leader-election-34  [spec]
  ~  update   kubernetes:core/v1:Service  ingress-tcp-services-24  [spec]
  ~  update   kubernetes:core/v1:Service  ingress-webhook-21  [spec]
  ~  update   kubernetes:core/v1:Service  ingress-webhook-29  [spec]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  ingress-canary-30  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  ingress-canary-44  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  ingress-private-3  [spec, metadata]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  ingress-config-40  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  ingress-internal-13  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  ingress-metrics-26  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  ingress-tcp-services-39  [rules]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  ingress-udp-services-5
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **storage/buckets:prod** · `+1 ~1 +-1 -1` · 1 tracking only · :warning: **deletes 1, replaces 1** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="storage/buckets:prod" state="pending" hash="2b44350653e84be9" destroys="2" -->
  from #433 by alice, #429 by alice, [3fa9c1e](https://github.com/example-org/infra/commit/3fa9c1e) by bob, and 1 change outside this stack · [compare](https://github.com/example-org/infra/compare/c7dbfa5...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  -  delete   aws:s3/bucketPolicy:BucketPolicy  uploads-public-read
  -+ replace  aws:s3/bucket:Bucket  uploads  [bucket (forces replace), tags]
     move     aws:s3/bucket:Bucket  archive
  ~  update   aws:s3/bucketLifecycleConfiguration:BucketLifecycleConfiguration  logs  [rules]
  +  create   aws:s3/bucketVersioning:BucketVersioning  uploads
  ```

  </details>
  <!-- /sluiceway:row -->

## Deploying

- **platform/cert-manager:prod** · deploying · ticked by carol · [run](https://github.com/example-org/infra/actions/runs/17034501999) <!-- sluiceway:row stack="platform/cert-manager:prod" state="deploying" -->
  from #437 by renovate[bot] · [compare](https://github.com/example-org/infra/compare/ee94c0b...8c41f0e)
  <!-- /sluiceway:row -->

- **apps/web:staging** · waiting to start · ticked by alice · [run](https://github.com/example-org/infra/actions/runs/17034502113) <!-- sluiceway:row stack="apps/web:staging" state="deploying" -->
  from #418 by carol, and 2 changes outside this stack · [compare](https://github.com/example-org/infra/compare/04cc4c1...8c41f0e)
  <!-- /sluiceway:row -->

## Preview failed

These stacks could not be previewed, so they cannot be deployed from here until a scan succeeds.

- **monitoring/loki:prod** · preview failed: the preview timed out after 10 minutes · [run](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="monitoring/loki:prod" state="preview-failed" -->
  <!-- /sluiceway:row -->

- **data/redis:staging** · preview failed: the tool exited with an error (exit code 255) · [run](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="data/redis:staging" state="preview-failed" -->
  <!-- /sluiceway:row -->

## In sync

- data/warehouse:prod <!-- sluiceway:row stack="data/warehouse:prod" state="in-sync" failed="true" -->
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

| Stack | Ticked by | When | |
|---|---|---|---|
| apps/auth:prod | alice | 2026-09-21 09:41 UTC | [run](https://github.com/example-org/infra/actions/runs/17034388102) |
| apps/auth:staging | alice | 2026-09-21 09:12 UTC | [run](https://github.com/example-org/infra/actions/runs/17034120455) |
| platform/external-dns:prod | carol | 2026-09-20 17:30 UTC | [run](https://github.com/example-org/infra/actions/runs/17029910331) |
| infra/network:staging | bob | 2026-09-20 14:02 UTC | [run](https://github.com/example-org/infra/actions/runs/17027745120) |
| apps/worker:prod | dave | 2026-09-19 11:47 UTC | [run](https://github.com/example-org/infra/actions/runs/17018803377) |
| apps/worker:staging | dave | 2026-09-19 11:20 UTC | [run](https://github.com/example-org/infra/actions/runs/17018650912) |
| monitoring/grafana:prod | erin | 2026-09-18 15:55 UTC | [run](https://github.com/example-org/infra/actions/runs/17009921140) |
| storage/cdn:prod | bob | 2026-09-18 10:08 UTC | [run](https://github.com/example-org/infra/actions/runs/17007112054) |
| infra/iam:prod | alice | 2026-09-17 13:31 UTC | [run](https://github.com/example-org/infra/actions/runs/16998120433) |
| platform/policy:prod | carol | 2026-09-17 09:05 UTC | [run](https://github.com/example-org/infra/actions/runs/16995530871) |

---

- [ ] Rescan all stacks <!-- sluiceway:rescan -->

<sub>[Sluiceway](https://github.com/sluiceway/sluiceway) v0.0.0-prototype · [docs](https://github.com/sluiceway/sluiceway#readme)</sub>
