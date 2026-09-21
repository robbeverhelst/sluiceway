<!-- sluiceway:dashboard v="1" scan-sha="8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c" scan-run="17034455121" scan-at="2026-09-21T10:02:41Z" full-scan-at="2026-09-21T06:00:12Z" full-scan-run="17031200455" -->

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://placehold.co/880x140/0d1117/8b949e/png?text=mascot+placeholder+(dark,+state:+destroys+pending)">
  <img alt="Mascot placeholder" width="440" src="https://placehold.co/880x140/f6f8fa/57606a/png?text=mascot+placeholder+(light,+state:+destroys+pending)">
</picture>

**45 pending** · 2 deploying · 2 preview failed · 43 in sync · :warning: **11 pending stacks destroy resources** · 2 failed deploys

Scanned [`8c41f0e`](https://github.com/example-org/infra/commit/8c41f0e7d2b94a6f1e3c5d7a9b0c2e4f6a8b1d3c) on 2026-09-21 10:02 UTC · [run](https://github.com/example-org/infra/actions/runs/17034455121) · <sub>last full scan 2026-09-21 06:00 UTC</sub>

> [!NOTE]
> This dashboard is too large for one issue, so 31 of 45 pending rows are shortened. The [summary](https://github.com/example-org/infra/actions/runs/17034455121) of the scan shows every change. Deletes and replaces are the last thing to be cut.

## Pending

Tick a box to deploy that stack exactly as its row shows it.

- [ ] **apps/api:prod** · 1 update · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/api:prod" state="pending" hash="8e707da8ed87a742" -->
  from #5 by alice, #4 by renovate[bot] · [compare](https://github.com/example-org/infra/compare/ec10144...8c41f0e)
  <details><summary>1 change</summary>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>api</b> · <code>spec</code><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **apps/billing:staging** · 9 creates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/billing:staging" state="pending" hash="edfe61deb7377f37" -->
  not deployed from this dashboard yet
  <details><summary>9 changes</summary>
  <kbd>create</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>billing-canary-6</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>billing-leader-election-1</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>billing-private-7</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:Service</code> <b>billing-default-backend-2</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:Service</code> <b>billing-metrics-5</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:Service</code> <b>billing-tcp-services-9</b><br>
  <kbd>create</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>billing-config-3</b><br>
  <kbd>create</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>billing-udp-services-4</b><br>
  <kbd>create</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>billing-udp-services-8</b><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **apps/legacy-worker:prod** · **3 deletes**, 1 tracking only · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/legacy-worker:prod" state="pending" hash="c602c5a2be643260" -->
  from #427 by dave · [compare](https://github.com/example-org/infra/compare/e128352...8c41f0e)
  :warning: <kbd>DELETE</kbd> <code>aws:sqs/queue:Queue</code> <b>legacy-jobs</b>
  :warning: <kbd>DELETE</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>legacy-worker</b>
  :warning: <kbd>DELETE</kbd> <code>kubernetes:core/v1:Service</code> <b>legacy-worker</b>
  <details><summary>1 other change</summary>
  <kbd>forget</kbd> <code>aws:iam/role:Role</code> <b>legacy-worker</b><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **apps/notifications:prod** · 1 create, 1 update · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/notifications:prod" state="pending" hash="2594c3fa3cbe3351" -->
  from #428 by dave, and 3 changes outside this stack, and earlier changes · [compare](https://github.com/example-org/infra/compare/a542ef7...8c41f0e)
  :information_source: a tick on this row was not picked up. Tick again to deploy.
  <details><summary>2 changes</summary>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>notifications</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:batch/v1:CronJob</code> <b>digest</b><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **apps/search:prod** · 2 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/search:prod" state="pending" hash="c0196c2258a3de3d" -->
  from #432 by carol, #426 by carol · [compare](https://github.com/example-org/infra/compare/3f7648f...8c41f0e)
  :x: last deploy failed: the change moved since the tick · ticked by alice · 2026-09-21 08:52 UTC · [run](https://github.com/example-org/infra/actions/runs/17034120077)
  <details><summary>2 changes</summary>
  <kbd>update</kbd> <code>kubernetes:apps/v1:StatefulSet</code> <b>search</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>search-config</b> · <code>data</code><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **apps/web:prod** · 2 creates, 1 update · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="apps/web:prod" state="pending" hash="ba350a8b0926a7fc" -->
  from #418 by carol, and 2 changes outside this stack · [compare](https://github.com/example-org/infra/compare/d5888b8...8c41f0e)
  <details><summary>3 changes</summary>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>web</b> · <code>spec</code>, <code>metadata</code><br>
  <kbd>create</kbd> <code>kubernetes:autoscaling/v2:HorizontalPodAutoscaler</code> <b>web</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>web-feature-flags</b><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **data/postgres:prod** · 2 updates, **1 replace** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="data/postgres:prod" state="pending" hash="70dcfb2395a3c9fb" -->
  from #431 by bob · [compare](https://github.com/example-org/infra/compare/a8603ed...8c41f0e)
  :warning: <kbd>REPLACE</kbd> <code>aws:rds/instance:Instance</code> <b>main</b> · forced by <code>engineVersion</code>, <code>storageType</code> · also changes <code>instanceClass</code>
  <details><summary>2 other changes</summary>
  <kbd>update</kbd> <code>aws:cloudwatch/metricAlarm:MetricAlarm</code> <b>main-cpu</b> · <code>dimensions</code><br>
  <kbd>update</kbd> <code>aws:rds/parameterGroup:ParameterGroup</code> <b>main</b> · <code>parameters</code><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **infra/dns:prod** · 1 update, 2 tracking only · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="infra/dns:prod" state="pending" hash="571a5053e6a1ff18" -->
  from 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/b69ddd2...8c41f0e)
  <details><summary>3 changes</summary>
  <kbd>update</kbd> <code>cloudflare:index/record:Record</code> <b>api</b> · <code>ttl</code><br>
  <kbd>import</kbd> <code>cloudflare:index/record:Record</code> <b>docs</b><br>
  <kbd>import</kbd> <code>cloudflare:index/record:Record</code> <b>status-page</b><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **monitoring/dashboards:prod** · 44 creates, 76 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="monitoring/dashboards:prod" state="pending" hash="75c74f6496dd272a" -->
  from 1 pull request · [compare](https://github.com/example-org/infra/compare/24f5b22...8c41f0e)
  120 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **platform/ingress:prod** · 12 creates, 33 updates, **1 replace** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="platform/ingress:prod" state="pending" hash="d1a9c35401b57ada" -->
  from 7 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/22d5477...8c41f0e)
  :warning: <kbd>REPLACE</kbd> <code>kubernetes:batch/v1:Job</code> <b>ingress-admission-patch</b> · forced by <code>spec</code>
  45 other changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-01:prod** · 13 creates, 21 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-01:prod" state="pending" hash="86a535de6426b991" -->
  from #441 by bob, #401 by renovate[bot], #381 by dave, and 1 more, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/dc2307e...8c41f0e)
  <details><summary>34 changes</summary>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc1-canary-15</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc1-controller-22</b><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc1-leader-election-14</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc1-webhook-11</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc1-config-1</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc1-config-26</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc1-default-backend-10</b><br>
  <kbd>create</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc1-metrics-5</b><br>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc1-private-29</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc1-public-7</b><br>
  <kbd>create</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc1-tcp-services-33</b><br>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc1-webhook-4</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc1-admission-19</b> · <code>data</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc1-external-8</b> · <code>data</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc1-leader-election-27</b> · <code>data</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc1-metrics-32</b> · <code>data</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc1-private-16</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc1-private-28</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc1-udp-services-6</b> · <code>metadata</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:Service</code> <b>svc1-canary-20</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:Service</code> <b>svc1-default-backend-23</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc1-leader-election-30</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:Service</code> <b>svc1-metrics-25</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc1-public-12</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:Service</code> <b>svc1-tcp-services-3</b><br>
  <kbd>update</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc1-config-17</b> · <code>spec</code>, <code>metadata</code><br>
  <kbd>create</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc1-public-31</b><br>
  <kbd>update</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc1-tcp-services-13</b> · <code>spec</code>, <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc1-udp-services-18</b> · <code>spec</code>, <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc1-udp-services-24</b> · <code>spec</code>, <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc1-webhook-21</b> · <code>spec</code>, <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc1-canary-2</b> · <code>rules</code><br>
  <kbd>update</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc1-udp-services-34</b> · <code>rules</code><br>
  <kbd>create</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc1-webhook-9</b><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **services/svc-02:staging** · 15 creates, 36 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-02:staging" state="pending" hash="612fda5dd2e2377e" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/a83e99d...8c41f0e)
  51 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-03:prod** · 16 creates, 40 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-03:prod" state="pending" hash="9c15f0758caaa3b8" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/12e7a9a...8c41f0e)
  56 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-04:staging** · 21 creates, 35 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-04:staging" state="pending" hash="f709e014cfb2295b" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/eb7258a...8c41f0e)
  56 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-05:prod** · 16 creates, 17 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-05:prod" state="pending" hash="3a221e380132b4df" -->
  from #445 by bob, #405 by renovate[bot], #385 by dave, and 2 more, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/9554636...8c41f0e)
  <details><summary>33 changes</summary>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc5-config-5</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc5-controller-30</b><br>
  <kbd>create</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc5-default-backend-14</b><br>
  <kbd>create</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc5-public-33</b><br>
  <kbd>create</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc5-tcp-services-31</b><br>
  <kbd>create</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc5-udp-services-22</b><br>
  <kbd>create</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc5-default-backend-29</b><br>
  <kbd>create</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc5-external-10</b><br>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc5-public-28</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc5-webhook-15</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc5-canary-24</b> · <code>data</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc5-controller-3</b> · <code>data</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc5-metrics-7</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc5-metrics-23</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc5-tcp-services-19</b> · <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc5-udp-services-4</b> · <code>metadata</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:Service</code> <b>svc5-config-32</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc5-default-backend-8</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc5-leader-election-16</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc5-public-26</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc5-leader-election-2</b><br>
  <kbd>create</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc5-leader-election-25</b><br>
  <kbd>create</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc5-metrics-13</b><br>
  <kbd>create</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc5-private-21</b><br>
  <kbd>update</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc5-udp-services-11</b> · <code>spec</code>, <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc5-webhook-9</b> · <code>spec</code>, <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc5-config-6</b> · <code>rules</code><br>
  <kbd>update</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc5-default-backend-18</b> · <code>rules</code><br>
  <kbd>update</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc5-internal-12</b> · <code>rules</code><br>
  <kbd>update</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc5-leader-election-20</b> · <code>rules</code><br>
  <kbd>update</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc5-metrics-1</b> · <code>rules</code><br>
  <kbd>update</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc5-metrics-27</b> · <code>rules</code><br>
  <kbd>create</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc5-public-17</b><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **services/svc-06:staging** · 15 creates, 28 updates, **1 delete** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-06:staging" state="pending" hash="520673a7d48757c1" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/b91e63b...8c41f0e)
  :warning: <kbd>DELETE</kbd> <code>aws:sqs/queue:Queue</code> <b>svc6-dead-letter</b>
  43 other changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-07:prod** · 18 creates, 41 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-07:prod" state="pending" hash="2f8b5681effbee22" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/ba453a6...8c41f0e)
  59 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-08:staging** · 23 creates, 22 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-08:staging" state="pending" hash="4ac20d34a5c4869d" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/1ef0df1...8c41f0e)
  45 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-09:prod** · 11 creates, 21 updates, **1 replace** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-09:prod" state="pending" hash="ab66ed98957211c1" -->
  from #449 by carol, #409 by renovate[bot], #389 by dave, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/3bac70d...8c41f0e)
  :warning: <kbd>REPLACE</kbd> <code>aws:elasticache/cluster:Cluster</code> <b>svc9-cache</b> · forced by <code>nodeType</code> · also changes <code>engineVersion</code>
  <details><summary>32 other changes</summary>
  <kbd>create</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc9-external-22</b><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc9-metrics-11</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc9-metrics-26</b><br>
  <kbd>create</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc9-canary-30</b><br>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc9-canary-6</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc9-public-18</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc9-controller-3</b> · <code>data</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc9-controller-8</b> · <code>data</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc9-internal-1</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc9-leader-election-20</b> · <code>data</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc9-tcp-services-5</b> · <code>data</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc9-udp-services-21</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc9-controller-17</b> · <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc9-controller-4</b> · <code>metadata</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc9-default-backend-16</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc9-metrics-9</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc9-private-12</b> · <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc9-udp-services-2</b> · <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc9-udp-services-24</b> · <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc9-webhook-25</b> · <code>metadata</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:Service</code> <b>svc9-internal-10</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc9-internal-14</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:Service</code> <b>svc9-internal-29</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc9-metrics-31</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc9-private-15</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc9-udp-services-19</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc9-webhook-28</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc9-webhook-7</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc9-default-backend-13</b><br>
  <kbd>update</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc9-default-backend-32</b> · <code>rules</code><br>
  <kbd>update</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc9-public-23</b> · <code>rules</code><br>
  <kbd>create</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc9-udp-services-27</b><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **services/svc-10:staging** · 18 creates, 36 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-10:staging" state="pending" hash="c431e02b2153c009" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/18a11e3...8c41f0e)
  54 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-11:prod** · 22 creates, 42 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-11:prod" state="pending" hash="a95cc5dbdc259357" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/a81379e...8c41f0e)
  64 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-12:staging** · 34 creates, 42 updates, **451 deletes** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-12:staging" state="pending" hash="922076b7814de267" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/b9b4b72...8c41f0e)
  :warning: **deletes 451, too many to list here.** Read the [summary](https://github.com/example-org/infra/actions/runs/17034455121) before you tick.
  <!-- /sluiceway:row -->
- [ ] **services/svc-13:prod** · 16 creates, 50 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-13:prod" state="pending" hash="28a93d14e71c6e5d" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/cdcf27b...8c41f0e)
  66 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-14:staging** · 14 creates, 27 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-14:staging" state="pending" hash="1b7271afd7f1e0cc" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/4c32099...8c41f0e)
  41 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-15:prod** · 9 creates, 31 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-15:prod" state="pending" hash="f542168d4f30457e" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/8207a10...8c41f0e)
  40 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-16:staging** · 28 creates, 42 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-16:staging" state="pending" hash="db98bd2f18b75986" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/c1ebbd4...8c41f0e)
  70 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-17:prod** · 17 creates, 26 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-17:prod" state="pending" hash="d0ac494bf2d756a3" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/8756524...8c41f0e)
  43 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-18:staging** · 16 creates, 32 updates, **1 replace**, **1 delete** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-18:staging" state="pending" hash="3011f768e24058e9" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/95ea7c1...8c41f0e)
  :warning: <kbd>DELETE</kbd> <code>aws:sqs/queue:Queue</code> <b>svc18-dead-letter</b>
  :warning: <kbd>REPLACE</kbd> <code>aws:elasticache/cluster:Cluster</code> <b>svc18-cache</b> · forced by <code>nodeType</code> · also changes <code>engineVersion</code>
  48 other changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-19:prod** · 13 creates, 31 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-19:prod" state="pending" hash="0c9af9e698ceecc7" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/d5b973c...8c41f0e)
  44 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-20:staging** · 23 creates, 44 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-20:staging" state="pending" hash="e57e84991303204b" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/d5929d0...8c41f0e)
  67 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-21:prod** · 13 creates, 22 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-21:prod" state="pending" hash="4a52a9facfd52aae" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/d15ac33...8c41f0e)
  35 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-22:staging** · 18 creates, 35 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-22:staging" state="pending" hash="740ba88af025c6ca" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/a29b2e2...8c41f0e)
  53 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-23:prod** · 19 creates, 36 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-23:prod" state="pending" hash="12d57f5c9dbb4d47" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/f02b1fd...8c41f0e)
  55 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-24:staging** · 19 creates, 43 updates, **451 deletes** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-24:staging" state="pending" hash="1b120ffb1b2188e5" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/92e060a...8c41f0e)
  :warning: **deletes 451, too many to list here.** Read the [summary](https://github.com/example-org/infra/actions/runs/17034455121) before you tick.
  <!-- /sluiceway:row -->
- [ ] **services/svc-25:prod** · 26 creates, 46 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-25:prod" state="pending" hash="d4e105a1a48aea0e" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/6a518b6...8c41f0e)
  72 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-26:staging** · 7 creates, 24 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-26:staging" state="pending" hash="ede20ea46b1338c2" -->
  from #466 by carol, #426 by renovate[bot], #406 by dave, and 2 more, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/4bebf4b...8c41f0e)
  <details><summary>31 changes</summary>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc26-admission-10</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc26-canary-17</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc26-config-21</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc26-leader-election-14</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc26-leader-election-9</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc26-metrics-7</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc26-private-25</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc26-udp-services-13</b><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc26-udp-services-19</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc26-admission-24</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc26-config-6</b><br>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc26-external-28</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc26-udp-services-20</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc26-controller-11</b> · <code>data</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc26-canary-8</b> · <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc26-udp-services-3</b> · <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc26-admission-12</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc26-config-1</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc26-default-backend-15</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc26-default-backend-27</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc26-default-backend-4</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc26-private-22</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:Service</code> <b>svc26-public-23</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc26-public-5</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:Service</code> <b>svc26-tcp-services-18</b><br>
  <kbd>update</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc26-canary-31</b> · <code>spec</code>, <code>metadata</code><br>
  <kbd>create</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc26-config-2</b><br>
  <kbd>update</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc26-external-16</b> · <code>spec</code>, <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc26-config-30</b> · <code>rules</code><br>
  <kbd>create</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc26-external-29</b><br>
  <kbd>create</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc26-internal-26</b><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **services/svc-27:prod** · 19 creates, 39 updates, **1 replace** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-27:prod" state="pending" hash="a3964947b05ee6ee" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/e9547e8...8c41f0e)
  :warning: <kbd>REPLACE</kbd> <code>aws:elasticache/cluster:Cluster</code> <b>svc27-cache</b> · forced by <code>nodeType</code> · also changes <code>engineVersion</code>
  58 other changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-28:staging** · 22 creates, 42 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-28:staging" state="pending" hash="f7190d4d7210f979" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/c2ee5d1...8c41f0e)
  64 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-29:prod** · 15 creates, 19 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-29:prod" state="pending" hash="2bee43ae566a6acd" -->
  from 5 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/ff1071d...8c41f0e)
  34 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-30:staging** · 27 creates, 47 updates, **1 delete** · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-30:staging" state="pending" hash="f323a19aeb5eeeb9" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/6609ba4...8c41f0e)
  :warning: <kbd>DELETE</kbd> <code>aws:sqs/queue:Queue</code> <b>svc30-dead-letter</b>
  74 other changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-31:prod** · 16 creates, 29 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-31:prod" state="pending" hash="6ae656b06af733ef" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/2863c5d...8c41f0e)
  45 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-32:staging** · 15 creates, 18 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-32:staging" state="pending" hash="a8c94c972e97e6c6" -->
  from #472 by alice, #432 by renovate[bot], #412 by dave, and 2 more, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/e35128c...8c41f0e)
  <details><summary>33 changes</summary>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc32-controller-21</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc32-external-17</b><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc32-internal-8</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc32-leader-election-2</b><br>
  <kbd>create</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc32-tcp-services-4</b><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc32-udp-services-12</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc32-udp-services-13</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apiextensions.k8s.io/v1:CustomResourceDefinition</code> <b>svc32-udp-services-5</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc32-config-23</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc32-metrics-15</b><br>
  <kbd>update</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc32-metrics-26</b> · <code>spec</code><br>
  <kbd>create</kbd> <code>kubernetes:apps/v1:Deployment</code> <b>svc32-private-10</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc32-admission-27</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc32-config-31</b> · <code>data</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc32-leader-election-14</b> · <code>data</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc32-leader-election-7</b> · <code>data</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc32-metrics-33</b><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ConfigMap</code> <b>svc32-tcp-services-19</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc32-config-9</b> · <code>metadata</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc32-external-20</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc32-internal-16</b> · <code>metadata</code><br>
  <kbd>create</kbd> <code>kubernetes:core/v1:ServiceAccount</code> <b>svc32-private-3</b><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc32-config-1</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc32-internal-22</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc32-metrics-24</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:core/v1:Service</code> <b>svc32-metrics-28</b> · <code>spec</code><br>
  <kbd>update</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc32-config-6</b> · <code>spec</code>, <code>metadata</code><br>
  <kbd>update</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc32-controller-29</b> · <code>spec</code>, <code>metadata</code><br>
  <kbd>create</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc32-private-25</b><br>
  <kbd>create</kbd> <code>kubernetes:networking.k8s.io/v1:Ingress</code> <b>svc32-public-30</b><br>
  <kbd>create</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc32-admission-18</b><br>
  <kbd>create</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc32-leader-election-32</b><br>
  <kbd>create</kbd> <code>kubernetes:rbac.authorization.k8s.io/v1:ClusterRole</code> <b>svc32-public-11</b><br>
  </details>
  <!-- /sluiceway:row -->
- [ ] **services/svc-33:prod** · 10 creates, 39 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-33:prod" state="pending" hash="0427b9e1938efe43" -->
  from 3 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/6574550...8c41f0e)
  49 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **services/svc-34:staging** · 15 creates, 24 updates · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="services/svc-34:staging" state="pending" hash="a84c3f05591c10cf" -->
  from 4 pull requests, and 4 changes outside this stack · [compare](https://github.com/example-org/infra/compare/faa3cc5...8c41f0e)
  39 changes not listed here, see the [summary](https://github.com/example-org/infra/actions/runs/17034455121)
  <!-- /sluiceway:row -->
- [ ] **storage/buckets:prod** · 1 create, 1 update, **1 replace**, **1 delete**, 1 tracking only · [preview](https://github.com/example-org/infra/actions/runs/17034455121) <!-- sluiceway:row stack="storage/buckets:prod" state="pending" hash="e98569622514e127" -->
  from #433 by alice, #429 by alice, [3fa9c1e](https://github.com/example-org/infra/commit/3fa9c1e) by bob, and 1 change outside this stack · [compare](https://github.com/example-org/infra/compare/c2d9b6e...8c41f0e)
  :warning: <kbd>DELETE</kbd> <code>aws:s3/bucketPolicy:BucketPolicy</code> <b>uploads-public-read</b>
  :warning: <kbd>REPLACE</kbd> <code>aws:s3/bucket:Bucket</code> <b>uploads</b> · forced by <code>bucket</code> · also changes <code>tags</code>
  <details><summary>3 other changes</summary>
  <kbd>move</kbd> <code>aws:s3/bucket:Bucket</code> <b>archive</b><br>
  <kbd>update</kbd> <code>aws:s3/bucketLifecycleConfiguration:BucketLifecycleConfiguration</code> <b>logs</b> · <code>rules</code><br>
  <kbd>create</kbd> <code>aws:s3/bucketVersioning:BucketVersioning</code> <b>uploads</b><br>
  </details>
  <!-- /sluiceway:row -->

## Deploying

- **platform/cert-manager:prod** · deploying · ticked by carol · [run](https://github.com/example-org/infra/actions/runs/17034501999) <!-- sluiceway:row stack="platform/cert-manager:prod" state="deploying" -->
  from #437 by renovate[bot] · [compare](https://github.com/example-org/infra/compare/740ba86...8c41f0e)
  <!-- /sluiceway:row -->
- **apps/web:staging** · waiting to start · ticked by alice · [run](https://github.com/example-org/infra/actions/runs/17034502113) <!-- sluiceway:row stack="apps/web:staging" state="deploying" -->
  from #418 by carol, and 2 changes outside this stack · [compare](https://github.com/example-org/infra/compare/32443a6...8c41f0e)
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
