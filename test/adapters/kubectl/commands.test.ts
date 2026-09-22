import { describe, expect, test } from "bun:test";
import {
  applyCommand,
  deleteCommand,
  diffCommand,
  inventoryCommand,
  liveCommand,
} from "../../../src/adapters/kubectl/commands.ts";

// The command lines of part 2 (record 0070). The options of a server-side
// apply go to the preview, the drift check and the deploy alike, so the
// preview meets the conflicts the deploy would meet.

const ALL = {
  context: "prod",
  namespace: "web",
  forceConflicts: true,
  fieldManager: "sluiceway-web",
};

describe("forceConflicts and fieldManager", () => {
  test("reach the diff and the apply, after the target", () => {
    expect(diffCommand("/set/manifests.yaml", ALL)).toEqual([
      "kubectl",
      "diff",
      "--server-side",
      "--context=prod",
      "--namespace=web",
      "--force-conflicts",
      "--field-manager=sluiceway-web",
      "-f",
      "/set/manifests.yaml",
    ]);
    expect(applyCommand("/set/manifests.yaml", ALL)).toEqual([
      "kubectl",
      "apply",
      "--server-side",
      "--context=prod",
      "--namespace=web",
      "--force-conflicts",
      "--field-manager=sluiceway-web",
      "-f",
      "/set/manifests.yaml",
    ]);
  });

  test("without them the command lines are the ones of record 0060", () => {
    expect(diffCommand("s.yaml", {})).toEqual(["kubectl", "diff", "--server-side", "-f", "s.yaml"]);
    expect(applyCommand("s.yaml", {})).toEqual([
      "kubectl",
      "apply",
      "--server-side",
      "-f",
      "s.yaml",
    ]);
  });

  test("the drift check's diff shows who holds each field", () => {
    expect(diffCommand("s.yaml", {}, { managedFields: true })).toEqual([
      "kubectl",
      "diff",
      "--server-side",
      "--show-managed-fields",
      "-f",
      "s.yaml",
    ]);
  });
});

describe("pruning", () => {
  test("reads the inventory by name, and nothing when there is none", () => {
    expect(inventoryCommand("sluiceway-0123456789abcdef", ALL)).toEqual([
      "kubectl",
      "get",
      "configmap",
      "sluiceway-0123456789abcdef",
      "--context=prod",
      "--namespace=web",
      "--ignore-not-found",
      "--output=json",
    ]);
  });

  test("reads the live objects of a file, with their field managers", () => {
    expect(liveCommand("/set/prune.yaml", { namespace: "web" })).toEqual([
      "kubectl",
      "get",
      "--namespace=web",
      "--ignore-not-found",
      "--show-managed-fields",
      "--output=json",
      "-f",
      "/set/prune.yaml",
    ]);
  });

  test("deletes the objects of a file, and one that is gone already is no error", () => {
    expect(deleteCommand("/set/prune.yaml", ALL)).toEqual([
      "kubectl",
      "delete",
      "--context=prod",
      "--namespace=web",
      "--ignore-not-found",
      "-f",
      "/set/prune.yaml",
    ]);
  });
});
