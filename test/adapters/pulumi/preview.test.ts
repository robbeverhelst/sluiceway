import { describe, expect, test } from "bun:test";
import type { PreviewResult } from "../../../src/adapters/adapter.ts";
import { pulumi } from "../../../src/adapters/pulumi/index.ts";
import type { Change } from "../../../src/core/diff.ts";
import { diffHash } from "../../../src/core/diff-hash.ts";
import type { Stack } from "../../../src/core/stack.ts";
import { answering, type Replay, ROOT, replay, VERSIONS } from "./replay.ts";

// The adapter's preview against what the real CLI printed, replayed through
// the process runner. Expected diffs are written out by hand from what each
// scenario of scripts/fixtures/scenarios.ts does to the example project.

const NETWORK_DEV: Stack = { path: "network", name: "dev", options: {} };

function previewWith(stack: Stack, { run }: Replay, env = {}): Promise<PreviewResult> {
  return pulumi.preview(stack, { root: ROOT, env, run, timeoutMinutes: 10 });
}

function changesOf(result: PreviewResult): Change[] {
  if (!result.ok) throw new Error(`expected a diff, got the failure ${result.reason.kind}`);
  return result.diff.changes;
}

const network = (type: string, name: string) => `urn:pulumi:dev::network::${type}::${name}`;

// The scenario gives the file new content. The provider names the hashes of
// the content and the id as changed too, and the content as what forced it.
const FILE_REPLACE: Change = {
  address: network("local:index/file:File", "notes"),
  type: "local:index/file:File",
  name: "notes",
  op: "replace",
  changedKeys: [
    "content",
    "contentBase64sha256",
    "contentBase64sha512",
    "contentMd5",
    "contentSha1",
    "contentSha256",
    "contentSha512",
    "id",
  ],
  replaceKeys: ["content"],
};

const PET_REPLACE: Change = {
  address: network("random:index/randomPet:RandomPet", "name"),
  type: "random:index/randomPet:RandomPet",
  name: "name",
  op: "replace",
  changedKeys: ["prefix"],
  replaceKeys: ["prefix"],
};

const SUBNET_DELETE: Change = {
  address: network("random:index/randomString:RandomString", "subnet"),
  type: "random:index/randomString:RandomString",
  name: "subnet",
  op: "delete",
  changedKeys: [],
  replaceKeys: [],
};

for (const version of VERSIONS) {
  describe(`preview, replaying pulumi ${version}`, () => {
    // The tool also creates the root stack resource, pulumi:pulumi:Stack. That
    // is the stack coming into being, not a resource of the program, so it is
    // not a change (record 0079): two resources read as two creates.
    test("a stack that was never deployed gives one create per resource, with no keys", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "new-stack"));

      expect(result.ok && result.diff.stackId).toBe("network:dev");
      expect(changesOf(result)).toEqual([
        {
          address: network("command:local:Command", "banner"),
          type: "command:local:Command",
          name: "banner",
          op: "create",
          changedKeys: [],
          replaceKeys: [],
        },
        {
          address: network("local:index/file:File", "notes"),
          type: "local:index/file:File",
          name: "notes",
          op: "create",
          changedKeys: [],
          replaceKeys: [],
        },
        {
          address: network("random:index/randomPet:RandomPet", "name"),
          type: "random:index/randomPet:RandomPet",
          name: "name",
          op: "create",
          changedKeys: [],
          replaceKeys: [],
        },
        {
          address: network("random:index/randomString:RandomString", "subnet"),
          type: "random:index/randomString:RandomString",
          name: "subnet",
          op: "create",
          changedKeys: [],
          replaceKeys: [],
        },
      ]);
    });

    // The root stack step is "same" and is dropped, so nothing is left.
    test("a deployed stack with no edit gives an empty diff", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "no-changes"));

      expect(result).toEqual({
        ok: true,
        diff: { stackId: "network:dev", changes: [] },
        toolLog: "",
      });
    });

    // Record 0036. If a CLI starts to report output changes, this goes red.
    test("a change that touches only outputs gives an empty diff", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "outputs-only"));

      expect(changesOf(result)).toEqual([]);
    });

    // The tool's document holds no step for a resource that only moves to a
    // new address through an alias, so there is nothing to fold into "move".
    test("a resource renamed with an alias gives an empty diff", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "renamed-with-alias"));

      expect(changesOf(result)).toEqual([]);
    });

    test("an update lists the paths of the changed properties, as the tool writes them", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "update"));

      expect(changesOf(result)).toEqual([
        {
          address: network("command:local:Command", "banner"),
          type: "command:local:Command",
          name: "banner",
          op: "update",
          changedKeys: ["environment.STAGE"],
          replaceKeys: [],
        },
      ]);
    });

    // A changed secret reads as a changed key, like any other (record 0021).
    test("a changed secret is a changed key and nothing marks it", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "changed-secret"));

      expect(changesOf(result)).toEqual([
        {
          address: network("command:local:Command", "banner"),
          type: "command:local:Command",
          name: "banner",
          op: "update",
          changedKeys: ["environment.TOKEN"],
          replaceKeys: [],
        },
      ]);
    });

    // The pet is replaced create first, the file delete first. The tool
    // gives one "replace" step for either order.
    test("both replace orders are a replace, with what changed and what forced it", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "replace"));

      expect(changesOf(result)).toEqual([FILE_REPLACE, PET_REPLACE]);
    });

    // Record 0046: a path names properties, list indexes and map keys, as
    // the tool writes them, and never a value. The canary value sits in both
    // places that change.
    test("changes deep inside properties list their whole paths", async () => {
      const stack: Stack = { path: "generated/nested", name: "dev", options: {} };
      const result = await previewWith(stack, replay(version, "nested-paths"));
      const nested = (type: string, name: string) => `urn:pulumi:dev::nested::${type}::${name}`;

      expect(changesOf(result)).toEqual([
        {
          address: nested("kubernetes:apps/v1:Deployment", "web"),
          type: "kubernetes:apps/v1:Deployment",
          name: "web",
          op: "update",
          changedKeys: [
            'metadata.annotations["example.com/revision"]',
            "spec.template.spec.containers[0].env[0].value",
            "spec.template.spec.containers[0].image",
          ],
          replaceKeys: [],
        },
        {
          address: nested("kubernetes:core/v1:ConfigMap", "settings"),
          type: "kubernetes:core/v1:ConfigMap",
          name: "settings",
          op: "replace",
          changedKeys: ['data["app.properties"]'],
          replaceKeys: ['data["app.properties"]'],
        },
      ]);
    });

    test("a delete lists no keys", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "delete"));

      expect(changesOf(result)).toEqual([SUBNET_DELETE]);
    });

    test("a preview with every op gives every op, sorted by address", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "mixed"));

      expect(changesOf(result)).toEqual([
        {
          address: network("command:local:Command", "banner"),
          type: "command:local:Command",
          name: "banner",
          op: "update",
          changedKeys: ["environment.STAGE"],
          replaceKeys: [],
        },
        FILE_REPLACE,
        {
          address: network("random:index/randomPet:RandomPet", "extra"),
          type: "random:index/randomPet:RandomPet",
          name: "extra",
          op: "create",
          changedKeys: [],
          replaceKeys: [],
        },
        PET_REPLACE,
        SUBNET_DELETE,
      ]);
    });

    test("an import leaves the real object alone and starts tracking it", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "import"));

      expect(changesOf(result)).toEqual([
        {
          address: network("random:index/randomId:RandomId", "adopted"),
          type: "random:index/randomId:RandomId",
          name: "adopted",
          op: "none",
          tracking: "import",
          changedKeys: [],
          replaceKeys: [],
        },
      ]);
    });

    // The tool calls it a delete. The real object stays, so it must not
    // raise a destroy warning (record 0007).
    test("a resource dropped with retainOnDelete is forgotten, not deleted", async () => {
      const result = await previewWith(NETWORK_DEV, replay(version, "dropped-but-kept"));

      expect(changesOf(result)).toEqual([
        {
          address: network("random:index/randomString:RandomString", "subnet"),
          type: "random:index/randomString:RandomString",
          name: "subnet",
          op: "none",
          tracking: "forget",
          changedKeys: [],
          replaceKeys: [],
        },
      ]);
    });

    // Dropping the root stack create here would leave an empty diff, a row in
    // sync with no box, while a deploy still has work: the stack's state and
    // outputs, which another stack may read. So it stays (record 0079).
    test("a stack that was never deployed and holds no resource has one change, the create of the stack", async () => {
      const stack: Stack = { path: "generated/empty", name: "dev", options: {} };
      const result = await previewWith(stack, replay(version, "new-stack-without-resources"));

      expect(changesOf(result)).toEqual([
        {
          address: "urn:pulumi:dev::empty::pulumi:pulumi:Stack::empty-dev",
          type: "pulumi:pulumi:Stack",
          name: "empty-dev",
          op: "create",
          changedKeys: [],
          replaceKeys: [],
        },
      ]);
    });

    test("a project file spelled Pulumi.yml previews the same way", async () => {
      const stack: Stack = { path: "app", name: "prod", options: {} };
      const result = await previewWith(stack, replay(version, "new-stack-yml-project"));

      expect(result.ok && result.diff.stackId).toBe("app:prod");
      expect(changesOf(result).map((change) => [change.op, change.type, change.name])).toEqual([
        ["create", "command:local:Command", "start"],
        ["create", "random:index/randomPet:RandomPet", "release"],
      ]);
    });

    test("the same preview twice gives the same diff, whatever order the steps came in", async () => {
      const stack: Stack = { path: "site", name: "prod", options: {} };
      const twice = replay(version, "same-preview-twice");
      const first = await previewWith(stack, twice);
      const second = await previewWith(stack, twice);

      expect(
        changesOf(first)
          .map((change) => change.name)
          .sort(),
      ).toEqual(["page-about", "page-contact", "page-home", "publish"]);
      expect(second).toEqual(first);
      expect(first.ok && second.ok && diffHash(second.diff) === diffHash(first.diff)).toBe(true);
    });

    test("a stack of several hundred resources gives one change for each", async () => {
      const stack: Stack = { path: "generated/many", name: "big", options: {} };
      const changes = changesOf(await previewWith(stack, replay(version, "many-resources")));

      expect(changes).toHaveLength(300);
      expect(changes[0]?.name).toBe("item001");
      expect(changes[299]?.name).toBe("item300");
      expect(new Set(changes.map((change) => change.op))).toEqual(new Set(["create"]));
    });
  });
}

// Steps of the root stack resource that no recording holds, because a preview
// of the example project never gives them (record 0079). Written as the
// recordings write the other steps.
describe("the root stack resource, in steps no recording holds", () => {
  const ROOT_STACK = network("pulumi:pulumi:Stack", "network-dev");
  const PET = network("random:index/randomPet:RandomPet", "name");

  async function changesFor(...steps: { op: string; urn: string }[]): Promise<Change[]> {
    const { run } = answering({
      status: "exited",
      exitCode: 0,
      stdout: JSON.stringify({ steps }),
      stderr: "",
    });
    return changesOf(
      await pulumi.preview(NETWORK_DEV, { root: ROOT, env: {}, run, timeoutMinutes: 10 }),
    );
  }

  const rootStack = (op: Change["op"]): Change => ({
    address: ROOT_STACK,
    type: "pulumi:pulumi:Stack",
    name: "network-dev",
    op,
    changedKeys: [],
    replaceKeys: [],
  });

  // It holds nothing but the stack's outputs, and a change to outputs alone
  // is not shown (record 0036).
  test("an update of it is dropped, also when nothing else changes", async () => {
    expect(await changesFor({ op: "update", urn: ROOT_STACK })).toEqual([]);
    expect(
      (await changesFor({ op: "update", urn: ROOT_STACK }, { op: "delete", urn: PET })).map(
        (change) => change.address,
      ),
    ).toEqual([PET]);
  });

  // The whole stack would go. Record 0007: a destroy warning too many is the
  // safe side.
  test("a delete or a replace of it stays, as a destroy", async () => {
    expect(await changesFor({ op: "delete", urn: ROOT_STACK })).toEqual([rootStack("delete")]);
    expect(await changesFor({ op: "replace", urn: ROOT_STACK })).toEqual([rootStack("replace")]);
  });

  test("its create goes when any other change is left, a tracking change too", async () => {
    expect(
      (await changesFor({ op: "create", urn: ROOT_STACK }, { op: "import", urn: PET })).map(
        (change) => [change.op, change.tracking, change.address],
      ),
    ).toEqual([["none", "import", PET]]);
  });

  // A step that changes nothing does not count as work.
  test("its create stays when every other step changes nothing", async () => {
    expect(await changesFor({ op: "create", urn: ROOT_STACK }, { op: "same", urn: PET })).toEqual([
      rootStack("create"),
    ]);
  });

  // Only the stack's own resource is the root: its type stands alone in the
  // URN. A child of another type is a resource of the program.
  test("a resource with a parent is never the root stack resource", async () => {
    const child = network("my:index:Component$pulumi:pulumi:Stack", "inner");
    expect(
      (await changesFor({ op: "create", urn: child }, { op: "create", urn: PET })).map(
        (change) => change.address,
      ),
    ).toEqual([child, PET]);
  });
});

describe("the environment of the tool", () => {
  async function environmentFor(env: Record<string, string | undefined>) {
    const runner = replay(VERSIONS[0] ?? "", "no-changes");
    await previewWith(NETWORK_DEV, runner, env);
    return runner.runs[0]?.env;
  }

  // GitHub hands an action its inputs as INPUT_* variables, the token that
  // can edit the dashboard among them (record 0013).
  test("is the whole environment of the job, minus every INPUT_* variable", async () => {
    const env = await environmentFor({
      PATH: "/usr/bin",
      PULUMI_BACKEND_URL: "file:///state",
      ANYTHING_A_PROGRAM_READS: "kept",
      "INPUT_GITHUB-TOKEN": "the workflow token",
      INPUT_MODE: "scan",
      INPUT_: "",
      input_lowercase: "not how GitHub hands over an input",
      NOT_SET: undefined,
    });

    expect(env).toEqual({
      PATH: "/usr/bin",
      PULUMI_BACKEND_URL: "file:///state",
      ANYTHING_A_PROGRAM_READS: "kept",
      input_lowercase: "not how GitHub hands over an input",
      PULUMI_SKIP_UPDATE_CHECK: "true",
    });
  });

  test("sets nothing but what makes the tool behave in CI", async () => {
    expect(await environmentFor({})).toEqual({ PULUMI_SKIP_UPDATE_CHECK: "true" });
  });
});
