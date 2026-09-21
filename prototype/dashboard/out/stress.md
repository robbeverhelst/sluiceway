<!-- sluiceway:dashboard v="1" scan-sha="8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c" scan-run="17034455121" scan-at="2026-09-21T10:02:41Z" full-scan-at="2026-09-21T06:00:12Z" full-scan-run="17031200455" -->

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://placehold.co/880x140/0d1117/8b949e/png?text=mascot+placeholder+(dark,+state:+destroys+pending)">
  <img alt="Mascot placeholder" width="440" src="https://placehold.co/880x140/f6f8fa/57606a/png?text=mascot+placeholder+(light,+state:+destroys+pending)">
</picture>

**45 pending** · 2 deploying · 2 preview failed · 43 in sync · :warning: **11 pending stacks destroy resources** · 2 failed deploys

Scanned [`8c41f0e`](https://github.com/example-org/infra/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](https://github.com/example-org/infra/actions/runs/17034455121) · <sub>last full scan 2026-09-21 06:00 UTC</sub>

> [!NOTE]
> This dashboard is too large for one issue, so 29 of 45 pending rows are shortened. The [summary](https://github.com/example-org/infra/actions/runs/17034455121) of the scan shows every change. Deletes and replaces are the last thing to be cut.

## Pending

Tick a box to deploy that stack exactly as its row shows it.

> [!CAUTION]
> 11 pending stacks would destroy resources: **apps/legacy-worker:prod** (deletes 3), **data/postgres:prod** (replaces 1), **platform/ingress:prod** (replaces 1), **services/svc-06:staging** (deletes 1), **services/svc-09:prod** (replaces 1), **services/svc-12:staging** (deletes 451), **services/svc-18:staging** (deletes 1, replaces 1), **services/svc-24:staging** (deletes 451), **services/svc-27:prod** (replaces 1), **services/svc-30:staging** (deletes 1), **storage/buckets:prod** (deletes 1, replaces 1).

- [ ] **apps/api:prod** · `+0 ~1 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/api:prod" state="pending" hash="8e707da8ed87a742" -->
  from #5 by alice, #4 by renovate[bot] · [compare](https://github.com/example-org/infra/compare/ec10144...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apps/v1:Deployment  api  [spec]
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **apps/billing:staging** · `+9 ~0 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/billing:staging" state="pending" hash="edfe61deb7377f37" -->
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

- [ ] **apps/legacy-worker:prod** · `+0 ~0 +-0 -3` · 1 tracking only · :warning: **deletes 3** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/legacy-worker:prod" state="pending" hash="c602c5a2be643260" -->
  from #427 by dave · [compare](https://github.com/example-org/infra/compare/e128352...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  -  delete   aws:sqs/queue:Queue  legacy-jobs
  -  delete   kubernetes:apps/v1:Deployment  legacy-worker
  -  delete   kubernetes:core/v1:Service  legacy-worker
     forget   aws:iam/role:Role  legacy-worker
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **apps/notifications:prod** · `+1 ~1 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/notifications:prod" state="pending" hash="2594c3fa3cbe3351" -->
  from #428 by dave, and 3 changes outside this stack, and earlier changes · [compare](https://github.com/example-org/infra/compare/a542ef7...8c41f0e)
  :information_source: a tick on this row was not picked up. Tick again to deploy.
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apps/v1:Deployment  notifications  [spec]
  +  create   kubernetes:batch/v1:CronJob  digest
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **apps/search:prod** · `+0 ~2 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/search:prod" state="pending" hash="c0196c2258a3de3d" -->
  from #432 by carol, #426 by carol · [compare](https://github.com/example-org/infra/compare/3f7648f...8c41f0e)
  :x: last deploy failed: the change moved since the tick · ticked by alice · 2026-09-21 08:52 UTC · [run](https://github.com/example-org/infra/actions/runs/17034120077)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apps/v1:StatefulSet  search  [spec]
  ~  update   kubernetes:core/v1:ConfigMap  search-config  [data]
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **apps/web:prod** · `+2 ~1 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/web:prod" state="pending" hash="ba350a8b0926a7fc" -->
  from #418 by carol, and 2 changes outside this stack · [compare](https://github.com/example-org/infra/compare/d5888b8...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apps/v1:Deployment  web  [spec, metadata]
  +  create   kubernetes:autoscaling/v2:HorizontalPodAutoscaler  web
  +  create   kubernetes:core/v1:ConfigMap  web-feature-flags
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **data/postgres:prod** · `+0 ~2 +-1 -0` · :warning: **replaces 1** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="data/postgres:prod" state="pending" hash="70dcfb2395a3c9fb" -->
  from #431 by bob · [compare](https://github.com/example-org/infra/compare/a8603ed...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  -+ replace  aws:rds/instance:Instance  main  [engineVersion (forces replace), instanceClass, storageType (forces replace)]
  ~  update   aws:cloudwatch/metricAlarm:MetricAlarm  main-cpu  [dimensions]
  ~  update   aws:rds/parameterGroup:ParameterGroup  main  [parameters]
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **infra/dns:prod** · `+0 ~1 +-0 -0` · 2 tracking only · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="infra/dns:prod" state="pending" hash="571a5053e6a1ff18" -->
  from 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/b69ddd2...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   cloudflare:index/record:Record  api  [ttl]
     import   cloudflare:index/record:Record  docs
     import   cloudflare:index/record:Record  status-page
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **monitoring/dashboards:prod** · `+44 ~76 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="monitoring/dashboards:prod" state="pending" hash="75c74f6496dd272a" -->
  from 1 pull request · [compare](https://github.com/example-org/infra/compare/24f5b22...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  120 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **platform/ingress:prod** · `+12 ~33 +-1 -0` · :warning: **replaces 1** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="platform/ingress:prod" state="pending" hash="d1a9c35401b57ada" -->
  from 7 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/22d5477...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  -+ replace  kubernetes:batch/v1:Job  ingress-admission-patch  [spec (forces replace)]
  ```

  45 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-01:prod** · `+13 ~21 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-01:prod" state="pending" hash="86a535de6426b991" -->
  from #441 by bob, #401 by renovate[bot], #381 by dave, and 1 more, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/dc2307e...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc1-canary-15  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc1-controller-22
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc1-leader-election-14  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc1-webhook-11  [spec]
  ~  update   kubernetes:apps/v1:Deployment  svc1-config-1  [spec]
  ~  update   kubernetes:apps/v1:Deployment  svc1-config-26  [spec]
  +  create   kubernetes:apps/v1:Deployment  svc1-default-backend-10
  +  create   kubernetes:apps/v1:Deployment  svc1-metrics-5
  ~  update   kubernetes:apps/v1:Deployment  svc1-private-29  [spec]
  +  create   kubernetes:apps/v1:Deployment  svc1-public-7
  +  create   kubernetes:apps/v1:Deployment  svc1-tcp-services-33
  ~  update   kubernetes:apps/v1:Deployment  svc1-webhook-4  [spec]
  ~  update   kubernetes:core/v1:ConfigMap  svc1-admission-19  [data]
  ~  update   kubernetes:core/v1:ConfigMap  svc1-external-8  [data]
  ~  update   kubernetes:core/v1:ConfigMap  svc1-leader-election-27  [data]
  ~  update   kubernetes:core/v1:ConfigMap  svc1-metrics-32  [data]
  +  create   kubernetes:core/v1:ServiceAccount  svc1-private-16
  +  create   kubernetes:core/v1:ServiceAccount  svc1-private-28
  ~  update   kubernetes:core/v1:ServiceAccount  svc1-udp-services-6  [metadata]
  +  create   kubernetes:core/v1:Service  svc1-canary-20
  +  create   kubernetes:core/v1:Service  svc1-default-backend-23
  ~  update   kubernetes:core/v1:Service  svc1-leader-election-30  [spec]
  +  create   kubernetes:core/v1:Service  svc1-metrics-25
  ~  update   kubernetes:core/v1:Service  svc1-public-12  [spec]
  +  create   kubernetes:core/v1:Service  svc1-tcp-services-3
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc1-config-17  [spec, metadata]
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc1-public-31
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc1-tcp-services-13  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc1-udp-services-18  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc1-udp-services-24  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc1-webhook-21  [spec, metadata]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc1-canary-2  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc1-udp-services-34  [rules]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc1-webhook-9
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-02:staging** · `+15 ~36 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-02:staging" state="pending" hash="612fda5dd2e2377e" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/a83e99d...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  51 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-03:prod** · `+16 ~40 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-03:prod" state="pending" hash="9c15f0758caaa3b8" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/12e7a9a...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  56 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-04:staging** · `+21 ~35 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-04:staging" state="pending" hash="f709e014cfb2295b" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/eb7258a...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  56 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-05:prod** · `+16 ~17 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-05:prod" state="pending" hash="3a221e380132b4df" -->
  from #445 by bob, #405 by renovate[bot], #385 by dave, and 2 more, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/9554636...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc5-config-5  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc5-controller-30
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc5-default-backend-14
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc5-public-33
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc5-tcp-services-31
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc5-udp-services-22
  +  create   kubernetes:apps/v1:Deployment  svc5-default-backend-29
  +  create   kubernetes:apps/v1:Deployment  svc5-external-10
  ~  update   kubernetes:apps/v1:Deployment  svc5-public-28  [spec]
  +  create   kubernetes:apps/v1:Deployment  svc5-webhook-15
  ~  update   kubernetes:core/v1:ConfigMap  svc5-canary-24  [data]
  ~  update   kubernetes:core/v1:ConfigMap  svc5-controller-3  [data]
  +  create   kubernetes:core/v1:ConfigMap  svc5-metrics-7
  +  create   kubernetes:core/v1:ServiceAccount  svc5-metrics-23
  ~  update   kubernetes:core/v1:ServiceAccount  svc5-tcp-services-19  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  svc5-udp-services-4  [metadata]
  +  create   kubernetes:core/v1:Service  svc5-config-32
  ~  update   kubernetes:core/v1:Service  svc5-default-backend-8  [spec]
  ~  update   kubernetes:core/v1:Service  svc5-leader-election-16  [spec]
  ~  update   kubernetes:core/v1:Service  svc5-public-26  [spec]
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc5-leader-election-2
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc5-leader-election-25
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc5-metrics-13
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc5-private-21
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc5-udp-services-11  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc5-webhook-9  [spec, metadata]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc5-config-6  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc5-default-backend-18  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc5-internal-12  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc5-leader-election-20  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc5-metrics-1  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc5-metrics-27  [rules]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc5-public-17
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-06:staging** · `+15 ~28 +-0 -1` · :warning: **deletes 1** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-06:staging" state="pending" hash="520673a7d48757c1" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/b91e63b...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  -  delete   aws:sqs/queue:Queue  svc6-dead-letter
  ```

  43 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-07:prod** · `+18 ~41 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-07:prod" state="pending" hash="2f8b5681effbee22" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/ba453a6...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  59 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-08:staging** · `+23 ~22 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-08:staging" state="pending" hash="4ac20d34a5c4869d" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/1ef0df1...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  45 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-09:prod** · `+11 ~21 +-1 -0` · :warning: **replaces 1** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-09:prod" state="pending" hash="ab66ed98957211c1" -->
  from #449 by carol, #409 by renovate[bot], #389 by dave, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/3bac70d...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  -+ replace  aws:elasticache/cluster:Cluster  svc9-cache  [nodeType (forces replace), engineVersion]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc9-external-22
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc9-metrics-11  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc9-metrics-26
  +  create   kubernetes:apps/v1:Deployment  svc9-canary-30
  ~  update   kubernetes:apps/v1:Deployment  svc9-canary-6  [spec]
  ~  update   kubernetes:apps/v1:Deployment  svc9-public-18  [spec]
  ~  update   kubernetes:core/v1:ConfigMap  svc9-controller-3  [data]
  ~  update   kubernetes:core/v1:ConfigMap  svc9-controller-8  [data]
  +  create   kubernetes:core/v1:ConfigMap  svc9-internal-1
  ~  update   kubernetes:core/v1:ConfigMap  svc9-leader-election-20  [data]
  ~  update   kubernetes:core/v1:ConfigMap  svc9-tcp-services-5  [data]
  +  create   kubernetes:core/v1:ConfigMap  svc9-udp-services-21
  ~  update   kubernetes:core/v1:ServiceAccount  svc9-controller-17  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  svc9-controller-4  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  svc9-default-backend-16
  +  create   kubernetes:core/v1:ServiceAccount  svc9-metrics-9
  ~  update   kubernetes:core/v1:ServiceAccount  svc9-private-12  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  svc9-udp-services-2  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  svc9-udp-services-24  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  svc9-webhook-25  [metadata]
  +  create   kubernetes:core/v1:Service  svc9-internal-10
  ~  update   kubernetes:core/v1:Service  svc9-internal-14  [spec]
  +  create   kubernetes:core/v1:Service  svc9-internal-29
  ~  update   kubernetes:core/v1:Service  svc9-metrics-31  [spec]
  ~  update   kubernetes:core/v1:Service  svc9-private-15  [spec]
  ~  update   kubernetes:core/v1:Service  svc9-udp-services-19  [spec]
  ~  update   kubernetes:core/v1:Service  svc9-webhook-28  [spec]
  ~  update   kubernetes:core/v1:Service  svc9-webhook-7  [spec]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc9-default-backend-13
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc9-default-backend-32  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc9-public-23  [rules]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc9-udp-services-27
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-10:staging** · `+18 ~36 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-10:staging" state="pending" hash="c431e02b2153c009" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/18a11e3...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  54 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-11:prod** · `+22 ~42 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-11:prod" state="pending" hash="a95cc5dbdc259357" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/a81379e...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  64 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-12:staging** · `+34 ~42 +-0 -451` · :warning: **deletes 451 (451 not listed here, see the summary)** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-12:staging" state="pending" hash="922076b7814de267" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/b9b4b72...8c41f0e)

  Changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->

- [ ] **services/svc-13:prod** · `+16 ~50 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-13:prod" state="pending" hash="28a93d14e71c6e5d" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/cdcf27b...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  66 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-14:staging** · `+14 ~27 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-14:staging" state="pending" hash="1b7271afd7f1e0cc" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/4c32099...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  41 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-15:prod** · `+9 ~31 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-15:prod" state="pending" hash="f542168d4f30457e" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/8207a10...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  40 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-16:staging** · `+28 ~42 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-16:staging" state="pending" hash="db98bd2f18b75986" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/c1ebbd4...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  70 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-17:prod** · `+17 ~26 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-17:prod" state="pending" hash="d0ac494bf2d756a3" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/8756524...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  43 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-18:staging** · `+16 ~32 +-1 -1` · :warning: **deletes 1, replaces 1** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-18:staging" state="pending" hash="3011f768e24058e9" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/95ea7c1...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  -  delete   aws:sqs/queue:Queue  svc18-dead-letter
  -+ replace  aws:elasticache/cluster:Cluster  svc18-cache  [nodeType (forces replace), engineVersion]
  ```

  48 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-19:prod** · `+13 ~31 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-19:prod" state="pending" hash="0c9af9e698ceecc7" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/d5b973c...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  44 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-20:staging** · `+23 ~44 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-20:staging" state="pending" hash="e57e84991303204b" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/d5929d0...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  67 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-21:prod** · `+13 ~22 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-21:prod" state="pending" hash="4a52a9facfd52aae" -->
  from #461 by alice, #421 by renovate[bot], #401 by dave, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/d15ac33...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc21-admission-29  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc21-config-22
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc21-default-backend-25
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc21-external-1
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc21-internal-26  [spec]
  ~  update   kubernetes:apps/v1:Deployment  svc21-admission-6  [spec]
  ~  update   kubernetes:apps/v1:Deployment  svc21-controller-13  [spec]
  ~  update   kubernetes:apps/v1:Deployment  svc21-leader-election-12  [spec]
  ~  update   kubernetes:apps/v1:Deployment  svc21-public-30  [spec]
  ~  update   kubernetes:apps/v1:Deployment  svc21-tcp-services-5  [spec]
  +  create   kubernetes:apps/v1:Deployment  svc21-udp-services-16
  +  create   kubernetes:apps/v1:Deployment  svc21-udp-services-8
  ~  update   kubernetes:core/v1:ConfigMap  svc21-internal-9  [data]
  +  create   kubernetes:core/v1:ConfigMap  svc21-public-11
  ~  update   kubernetes:core/v1:ConfigMap  svc21-udp-services-10  [data]
  ~  update   kubernetes:core/v1:ConfigMap  svc21-udp-services-14  [data]
  +  create   kubernetes:core/v1:ServiceAccount  svc21-admission-27
  ~  update   kubernetes:core/v1:ServiceAccount  svc21-admission-34  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  svc21-leader-election-21  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  svc21-private-3  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  svc21-tcp-services-31  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  svc21-webhook-18  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  svc21-webhook-23
  +  create   kubernetes:core/v1:Service  svc21-canary-24
  ~  update   kubernetes:core/v1:Service  svc21-canary-28  [spec]
  +  create   kubernetes:core/v1:Service  svc21-config-15
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc21-config-20  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc21-controller-19  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc21-internal-2  [spec, metadata]
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc21-metrics-33
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc21-public-7
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc21-tcp-services-32
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc21-tcp-services-35  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc21-tcp-services-4  [spec, metadata]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc21-metrics-17  [rules]
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-22:staging** · `+18 ~35 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-22:staging" state="pending" hash="740ba88af025c6ca" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/a29b2e2...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  53 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-23:prod** · `+19 ~36 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-23:prod" state="pending" hash="12d57f5c9dbb4d47" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/f02b1fd...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  55 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-24:staging** · `+19 ~43 +-0 -451` · :warning: **deletes 451 (451 not listed here, see the summary)** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-24:staging" state="pending" hash="1b120ffb1b2188e5" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/92e060a...8c41f0e)

  Changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->

- [ ] **services/svc-25:prod** · `+26 ~46 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-25:prod" state="pending" hash="d4e105a1a48aea0e" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/6a518b6...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  72 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-26:staging** · `+7 ~24 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-26:staging" state="pending" hash="ede20ea46b1338c2" -->
  from #466 by carol, #426 by renovate[bot], #406 by dave, and 2 more, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/4bebf4b...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc26-admission-10  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc26-canary-17  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc26-config-21  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc26-leader-election-14  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc26-leader-election-9  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc26-metrics-7  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc26-private-25  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc26-udp-services-13
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc26-udp-services-19  [spec]
  ~  update   kubernetes:apps/v1:Deployment  svc26-admission-24  [spec]
  +  create   kubernetes:apps/v1:Deployment  svc26-config-6
  ~  update   kubernetes:apps/v1:Deployment  svc26-external-28  [spec]
  ~  update   kubernetes:apps/v1:Deployment  svc26-udp-services-20  [spec]
  ~  update   kubernetes:core/v1:ConfigMap  svc26-controller-11  [data]
  ~  update   kubernetes:core/v1:ServiceAccount  svc26-canary-8  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  svc26-udp-services-3  [metadata]
  ~  update   kubernetes:core/v1:Service  svc26-admission-12  [spec]
  ~  update   kubernetes:core/v1:Service  svc26-config-1  [spec]
  ~  update   kubernetes:core/v1:Service  svc26-default-backend-15  [spec]
  ~  update   kubernetes:core/v1:Service  svc26-default-backend-27  [spec]
  ~  update   kubernetes:core/v1:Service  svc26-default-backend-4  [spec]
  ~  update   kubernetes:core/v1:Service  svc26-private-22  [spec]
  +  create   kubernetes:core/v1:Service  svc26-public-23
  ~  update   kubernetes:core/v1:Service  svc26-public-5  [spec]
  +  create   kubernetes:core/v1:Service  svc26-tcp-services-18
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc26-canary-31  [spec, metadata]
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc26-config-2
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc26-external-16  [spec, metadata]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc26-config-30  [rules]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc26-external-29
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc26-internal-26
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-27:prod** · `+19 ~39 +-1 -0` · :warning: **replaces 1** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-27:prod" state="pending" hash="a3964947b05ee6ee" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/e9547e8...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  -+ replace  aws:elasticache/cluster:Cluster  svc27-cache  [nodeType (forces replace), engineVersion]
  ```

  58 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-28:staging** · `+22 ~42 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-28:staging" state="pending" hash="f7190d4d7210f979" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/c2ee5d1...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  64 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-29:prod** · `+15 ~19 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-29:prod" state="pending" hash="2bee43ae566a6acd" -->
  from #469 by bob, #429 by renovate[bot], #409 by dave, and 2 more, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/ff1071d...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc29-config-20  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc29-default-backend-13
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc29-external-18  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc29-private-14  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc29-public-22  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc29-public-28  [spec]
  +  create   kubernetes:apps/v1:Deployment  svc29-default-backend-21
  +  create   kubernetes:apps/v1:Deployment  svc29-tcp-services-11
  ~  update   kubernetes:core/v1:ConfigMap  svc29-admission-34  [data]
  +  create   kubernetes:core/v1:ConfigMap  svc29-canary-30
  +  create   kubernetes:core/v1:ConfigMap  svc29-controller-19
  +  create   kubernetes:core/v1:ConfigMap  svc29-leader-election-27
  +  create   kubernetes:core/v1:ConfigMap  svc29-metrics-15
  +  create   kubernetes:core/v1:ConfigMap  svc29-metrics-33
  ~  update   kubernetes:core/v1:ConfigMap  svc29-tcp-services-17  [data]
  ~  update   kubernetes:core/v1:ServiceAccount  svc29-admission-12  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  svc29-config-7
  ~  update   kubernetes:core/v1:ServiceAccount  svc29-external-2  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  svc29-leader-election-1  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  svc29-leader-election-32
  ~  update   kubernetes:core/v1:ServiceAccount  svc29-metrics-23  [metadata]
  ~  update   kubernetes:core/v1:ServiceAccount  svc29-tcp-services-25  [metadata]
  +  create   kubernetes:core/v1:Service  svc29-controller-4
  +  create   kubernetes:core/v1:Service  svc29-default-backend-31
  ~  update   kubernetes:core/v1:Service  svc29-internal-5  [spec]
  ~  update   kubernetes:core/v1:Service  svc29-webhook-29  [spec]
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc29-canary-24
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc29-external-26
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc29-leader-election-3  [spec, metadata]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc29-canary-6  [rules]
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc29-controller-16
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc29-internal-8  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc29-public-10  [rules]
  ~  update   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc29-public-9  [rules]
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-30:staging** · `+27 ~47 +-0 -1` · :warning: **deletes 1** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-30:staging" state="pending" hash="f323a19aeb5eeeb9" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/6609ba4...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  -  delete   aws:sqs/queue:Queue  svc30-dead-letter
  ```

  74 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-31:prod** · `+16 ~29 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-31:prod" state="pending" hash="6ae656b06af733ef" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/2863c5d...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  45 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-32:staging** · `+15 ~18 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-32:staging" state="pending" hash="a8c94c972e97e6c6" -->
  from #472 by alice, #432 by renovate[bot], #412 by dave, and 2 more, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/e35128c...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc32-controller-21  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc32-external-17
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc32-internal-8  [spec]
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc32-leader-election-2
  +  create   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc32-tcp-services-4
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc32-udp-services-12  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc32-udp-services-13  [spec]
  ~  update   kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition  svc32-udp-services-5  [spec]
  ~  update   kubernetes:apps/v1:Deployment  svc32-config-23  [spec]
  +  create   kubernetes:apps/v1:Deployment  svc32-metrics-15
  ~  update   kubernetes:apps/v1:Deployment  svc32-metrics-26  [spec]
  +  create   kubernetes:apps/v1:Deployment  svc32-private-10
  +  create   kubernetes:core/v1:ConfigMap  svc32-admission-27
  ~  update   kubernetes:core/v1:ConfigMap  svc32-config-31  [data]
  ~  update   kubernetes:core/v1:ConfigMap  svc32-leader-election-14  [data]
  ~  update   kubernetes:core/v1:ConfigMap  svc32-leader-election-7  [data]
  +  create   kubernetes:core/v1:ConfigMap  svc32-metrics-33
  +  create   kubernetes:core/v1:ConfigMap  svc32-tcp-services-19
  ~  update   kubernetes:core/v1:ServiceAccount  svc32-config-9  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  svc32-external-20
  ~  update   kubernetes:core/v1:ServiceAccount  svc32-internal-16  [metadata]
  +  create   kubernetes:core/v1:ServiceAccount  svc32-private-3
  ~  update   kubernetes:core/v1:Service  svc32-config-1  [spec]
  ~  update   kubernetes:core/v1:Service  svc32-internal-22  [spec]
  ~  update   kubernetes:core/v1:Service  svc32-metrics-24  [spec]
  ~  update   kubernetes:core/v1:Service  svc32-metrics-28  [spec]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc32-config-6  [spec, metadata]
  ~  update   kubernetes:networking.k8s.io/v1:Ingress  svc32-controller-29  [spec, metadata]
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc32-private-25
  +  create   kubernetes:networking.k8s.io/v1:Ingress  svc32-public-30
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc32-admission-18
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc32-leader-election-32
  +  create   kubernetes:rbac.authorization.k8s.io/v1:ClusterRole  svc32-public-11
  ```

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-33:prod** · `+10 ~39 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-33:prod" state="pending" hash="0427b9e1938efe43" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/6574550...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  49 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **services/svc-34:staging** · `+15 ~24 +-0 -0` · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-34:staging" state="pending" hash="a84c3f05591c10cf" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/faa3cc5...8c41f0e)
  <details><summary>Show changes</summary>

  ```diff
  ```

  39 more changes not shown here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)

  </details>
  <!-- /sluiceway:row -->

- [ ] **storage/buckets:prod** · `+1 ~1 +-1 -1` · 1 tracking only · :warning: **deletes 1, replaces 1** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="storage/buckets:prod" state="pending" hash="e98569622514e127" -->
  from #433 by alice, #429 by alice, [3fa9c1e](https://github.com/example-org/infra/commit/3fa9c1e) by bob, and 1 change outside this stack · [compare](https://github.com/example-org/infra/compare/c2d9b6e...8c41f0e)
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
  from #437 by renovate[bot] · [compare](https://github.com/example-org/infra/compare/44201bc...8c41f0e)
  <!-- /sluiceway:row -->

- **apps/web:staging** · deploying, waiting for a reviewer · ticked by alice · [run](https://github.com/example-org/infra/actions/runs/17034502113) <!-- sluiceway:row stack="apps/web:staging" state="deploying" -->
  from #418 by carol, and 2 changes outside this stack · [compare](https://github.com/example-org/infra/compare/3bdeede...8c41f0e)
  <!-- /sluiceway:row -->

## Preview failed

These stacks could not be previewed, so they cannot be deployed from here until a scan succeeds.

- **monitoring/loki:prod** · preview failed: the preview timed out after 10 minutes · [run](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="monitoring/loki:prod" state="preview-failed" -->
  <!-- /sluiceway:row -->

- **data/redis:staging** · preview failed: the tool exited with an error (exit code 255) · [run](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="data/redis:staging" state="preview-failed" -->
  <!-- /sluiceway:row -->

<details><summary><b>In sync (43)</b></summary>

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
- data/warehouse:prod <!-- sluiceway:row stack="data/warehouse:prod" state="in-sync" -->
  :x: last deploy failed: the run ended without reporting a result · ticked by bob · 2026-09-19 16:03 UTC · [run](https://github.com/example-org/infra/actions/runs/17019884120)
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

---

- [ ] Rescan all stacks <!-- sluiceway:rescan -->

<sub>[Sluiceway](https://github.com/sluiceway/sluiceway) v0.0.0-prototype · [docs](https://github.com/sluiceway/sluiceway#readme)</sub>
