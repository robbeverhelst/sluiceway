import { describe, expect, test } from "bun:test";
import { CANARY_VALUE } from "../../scripts/fixtures/example.ts";
import type { PreviewOptions, PreviewResult } from "../../src/adapters/adapter.ts";
import { helm } from "../../src/adapters/helm/index.ts";
import { kubectl } from "../../src/adapters/kubectl/index.ts";
import { opentofu } from "../../src/adapters/opentofu/index.ts";
import { pulumi } from "../../src/adapters/pulumi/index.ts";
import { VERSIONS as HELM_VERSIONS, replay as replayHelm } from "./helm/replay.ts";
import { WEB as CHART } from "./helm/stacks.ts";
import {
  ROOT as KUBECTL_ROOT,
  VERSIONS as KUBECTL_VERSIONS,
  replay as replayKubectl,
} from "./kubectl/replay.ts";
import { WEB as MANIFESTS } from "./kubectl/stacks.ts";
import { replay as replayTofu, VERSIONS as TOFU_VERSIONS } from "./opentofu/replay.ts";
import { DEV } from "./opentofu/stacks.ts";
import { VERSIONS as PULUMI_VERSIONS, ROOT, replay as replayPulumi } from "./pulumi/replay.ts";

// The preview document (record 0106): the tool's own preview, which the
// policies of a stack are tested against. An adapter hands it back only when
// asked, so every preview that does not ask reads as it always did, and it
// holds the values the tool printed, which is why nothing but the policy
// runner may take it (record 0021).

const SITE = { path: "network", name: "dev", options: {} };

function document(result: PreviewResult) {
  if (!result.ok) throw new Error(`The preview failed: ${JSON.stringify(result.reason)}`);
  return result.document;
}

const base = (run: PreviewOptions["run"]): PreviewOptions => ({
  root: ROOT,
  env: { PATH: "/usr/bin", KUBECONFIG: "/kube/config" },
  run,
  timeoutMinutes: 10,
});

describe("a preview that is not asked for its document", () => {
  test.each(PULUMI_VERSIONS)("pulumi %s hands back none", async (version) => {
    const result = await pulumi.preview(SITE, base(replayPulumi(version, "update").run));
    expect(document(result)).toBeUndefined();
  });

  test.each(TOFU_VERSIONS)("tofu %s hands back none", async (version) => {
    const result = await opentofu.preview(DEV, base(replayTofu(version, "update").run));
    expect(document(result)).toBeUndefined();
  });
});

describe("a preview asked for its document", () => {
  test.each(PULUMI_VERSIONS)(
    "pulumi %s: the preview JSON as the tool printed it",
    async (version) => {
      const { run, runs } = replayPulumi(version, "update");
      const result = await pulumi.preview(SITE, { ...base(run), keepDocument: true });
      const found = document(result);
      expect(found?.format).toBe("json");
      // The document is the tool's, values included.
      const parsed = JSON.parse(found?.text ?? "") as { steps: unknown[] };
      expect(parsed.steps.length).toBeGreaterThan(0);
      expect(found?.text).toContain(CANARY_VALUE);
      // No second run of the tool.
      expect(runs.length).toBe(1);
    },
  );

  test.each(TOFU_VERSIONS)("tofu %s: the plan JSON of the saved plan", async (version) => {
    const { run } = replayTofu(version, "update");
    const result = await opentofu.preview(DEV, { ...base(run), keepDocument: true });
    const found = document(result);
    expect(found?.format).toBe("json");
    const parsed = JSON.parse(found?.text ?? "") as { resource_changes: unknown[] };
    expect(parsed.resource_changes.length).toBeGreaterThan(0);
  });

  test.each(HELM_VERSIONS)(
    "helm %s: the manifests the chart renders, one more run",
    async (version) => {
      const { run, runs } = replayHelm(version, "deploy");
      const result = await helm.preview(CHART, { ...base(run), keepDocument: true });
      const found = document(result);
      expect(found?.format).toBe("yaml");
      expect(found?.text).toContain("kind:");
      expect(runs.map(({ argv }) => argv[1])).toEqual(["diff", "template"]);
    },
  );

  test.each(HELM_VERSIONS)("helm %s: without asking, the diff alone", async (version) => {
    const { run, runs } = replayHelm(version, "update");
    const result = await helm.preview(CHART, base(run));
    expect(document(result)).toBeUndefined();
    expect(runs.map(({ argv }) => argv[1])).toEqual(["diff"]);
  });

  test.each(KUBECTL_VERSIONS)("kubectl %s: the rendered set", async (version) => {
    const { run } = replayKubectl(version, "update");
    const result = await kubectl.preview(MANIFESTS, {
      ...base(run),
      root: KUBECTL_ROOT,
      keepDocument: true,
    });
    const found = document(result);
    expect(found?.format).toBe("yaml");
    expect(found?.text).toContain("kind: Deployment");
  });
});
