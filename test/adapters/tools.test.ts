import { describe, expect, test } from "bun:test";
import { tools } from "../../src/adapters/tools.ts";
import type { Stack } from "../../src/core/stack.ts";

// The one adapter the modes use sends each stack to its tool (record 0053).
// Record 0107: a Pulumi stack an entry asks to create in the backend gets a
// preparation of its own, before the other tools' inits, and the stacks of
// the other tools are handed to their adapters as before.

const DEV: Stack = { path: "network", name: "dev", options: {} };
const MODULE: Stack = { path: "infra/network", options: { tool: "opentofu", varFiles: [] } };

describe("the preparations of every tool", () => {
  test("Pulumi's come first, only for the stacks to create, and OpenTofu's init stays", () => {
    const preparations = tools.prepare?.([MODULE, DEV], { createInBackend: [DEV] }) ?? [];
    expect(preparations.map((one) => [one.title, one.stacks])).toEqual([
      ["the stack network:dev in the backend", [DEV]],
      ["infra/network", [MODULE]],
    ]);
  });

  test("without a stack to create, a Pulumi stack has no preparation", () => {
    const preparations = tools.prepare?.([MODULE, DEV]) ?? [];
    expect(preparations.map((one) => one.title)).toEqual(["infra/network"]);
  });

  test("a stack of another tool named to create is not Pulumi's to create", () => {
    const preparations = tools.prepare?.([MODULE], { createInBackend: [MODULE] }) ?? [];
    expect(preparations.map((one) => one.title)).toEqual(["infra/network"]);
  });
});
