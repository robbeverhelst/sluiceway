import { describe, expect, test } from "bun:test";
import type { Change, Diff } from "../../src/core/diff.ts";
import { diffHash } from "../../src/core/diff-hash.ts";
import {
  changeFingerprint,
  differingLeaves,
  differsEveryRun,
  hiddenDocument,
  SECRET_MARK,
  valueFingerprint,
} from "../../src/core/value-fingerprint.ts";

// Slice 5.37 (record 0102): the value fingerprint of a change and of a row.
// The fixed vectors were hashed outside this code base:
//   printf '%s' '<document>' | shasum -a 256 | cut -c1-16
// A change of the shapes, the sorting or the escaping breaks them, and every
// outstanding tick is refused once, so say so in the pull request.
describe("the change fingerprint, fixed vectors", () => {
  test("an update of one hidden value, both sides", () => {
    const values = [{ path: "image", old: "v2", new: "v3" }];
    expect(hiddenDocument(values)).toBe('[{"new":"v3","old":"v2","path":"image"}]');
    expect(changeFingerprint(values)).toBe("f65a69fe79dd93c3");
  });

  test("a value the tool marks secret enters as its mark and nothing else", () => {
    const values = [{ path: "password", secret: true as const }];
    expect(hiddenDocument(values)).toBe('[{"path":"password","secret":true}]');
    expect(changeFingerprint(values)).toBe("75c007241b3af9a8");
  });

  test("numbers and booleans as JSON, entries sorted by path, an absent side left out", () => {
    const values = [
      { path: "tls", old: false, new: true },
      { path: "replicas", new: 3 },
    ];
    expect(hiddenDocument(values)).toBe(
      '[{"new":3,"path":"replicas"},{"new":true,"old":false,"path":"tls"}]',
    );
    expect(changeFingerprint(values)).toBe("f70c1a2d4e06c779");
  });

  test("a leaf on the old side only and one on the new side only", () => {
    const values = [
      { path: "b", new: "x" },
      { path: "a", old: "gone" },
    ];
    expect(changeFingerprint(values)).toBe("57fa7906b312cbd4");
  });

  test("null is an absent side, and no values is no fingerprint", () => {
    expect(hiddenDocument([{ path: "a", old: null, new: "x" }])).toBe('[{"new":"x","path":"a"}]');
    expect(changeFingerprint([])).toBeUndefined();
    expect(changeFingerprint([{ path: "a", old: null, new: null }])).toBeUndefined();
  });
});

describe("the leaf walk", () => {
  test("writes paths as record 0046 does and lists only the leaves that differ", () => {
    const before = { image: "v2", replicas: 2, labels: { "app.kubernetes.io/name": "web" } };
    const after = { image: "v3", replicas: 2, labels: { "app.kubernetes.io/name": "web2" } };
    expect(differingLeaves(before, after)).toEqual([
      { path: "image", old: "v2", new: "v3" },
      { path: 'labels["app.kubernetes.io/name"]', old: "web", new: "web2" },
    ]);
  });

  test("a create is every leaf of the new side, lists by index", () => {
    expect(differingLeaves(undefined, { ports: [80, 443], tls: true })).toEqual([
      { path: "ports[0]", new: 80 },
      { path: "ports[1]", new: 443 },
      { path: "tls", new: true },
    ]);
  });

  test("a scalar against an object: the scalar at the path, the leaves under it", () => {
    expect(differingLeaves("plain", { a: 1 })).toEqual([
      { path: "", old: "plain" },
      { path: "a", new: 1 },
    ]);
  });

  test("a prefix puts the leaves under the changed path, and an empty object has no leaf", () => {
    expect(differingLeaves({ a: {} }, { a: { b: "x" } }, { prefix: "values" })).toEqual([
      { path: "values.a.b", new: "x" },
    ]);
    expect(differingLeaves(undefined, {}, { prefix: "values" })).toEqual([]);
    expect(differingLeaves(undefined, "v", { prefix: "values" })).toEqual([
      { path: "values", new: "v" },
    ]);
  });

  test("a secret on either side is one entry at the mark and nothing under it", () => {
    const before = { token: SECRET_MARK, plain: "a" };
    const after = { token: { nested: "read-me" }, plain: "b" };
    expect(differingLeaves(before, after).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "plain", old: "a", new: "b" },
      { path: "token", secret: true },
    ]);
    expect(
      differingLeaves(
        { token: "[secret]" },
        { token: "[secret]" },
        {
          isSecret: (node) => node === "[secret]",
        },
      ),
    ).toEqual([{ path: "token", secret: true }]);
  });

  test("null and absent are the same, so neither is a difference", () => {
    expect(differingLeaves({ a: null }, {})).toEqual([]);
    expect(differingLeaves({ a: null }, { a: "x" })).toEqual([{ path: "a", new: "x" }]);
  });
});

function change(address: string, fingerprint?: string): Change {
  return {
    address,
    type: "apps:Deployment",
    name: address,
    op: "update",
    changedKeys: ["image"],
    replaceKeys: [],
    ...(fingerprint === undefined ? {} : { fingerprint }),
  };
}

describe("the fingerprint of a row", () => {
  test("is over the changes that have one, sorted by address, and the stack id", () => {
    const diff: Diff = {
      stackId: "apps/web:prod",
      changes: [change("a2", "2222222222222222"), change("a3"), change("a1", "1111111111111111")],
    };
    expect(valueFingerprint(diff)).toBe("f070cfa386d62cae");
  });

  test("covers drift under its own key", () => {
    const diff: Diff = {
      stackId: "apps/web:prod",
      changes: [change("a1", "1111111111111111")],
      drift: [change("d1", "3333333333333333"), change("d2")],
    };
    expect(valueFingerprint(diff)).toBe("ddaa2268cce4c88d");
  });

  test("is nothing when no change and no drift change has one", () => {
    expect(
      valueFingerprint({ stackId: "s", changes: [change("a1")], drift: [change("d1")] }),
    ).toBeUndefined();
    expect(valueFingerprint({ stackId: "s", changes: [] })).toBeUndefined();
  });

  test("leaves the diff hash exactly as it was", () => {
    const without: Diff = { stackId: "s", changes: [change("a1")] };
    const withOne: Diff = { stackId: "s", changes: [change("a1", "1111111111111111")] };
    expect(diffHash(withOne)).toBe(diffHash(without));
  });
});

describe("a value that differs on every run", () => {
  const approved = { hash: "h", fingerprint: "f1" };
  test("is the same hash with another fingerprint at the commit of the last scan", () => {
    expect(differsEveryRun(approved, { hash: "h", fingerprint: "f2" }, true)).toBe(true);
  });

  test("is not that at another commit, with the same fingerprint, or without one on a side", () => {
    expect(differsEveryRun(approved, { hash: "h", fingerprint: "f2" }, false)).toBe(false);
    expect(differsEveryRun(approved, { hash: "h", fingerprint: "f1" }, true)).toBe(false);
    expect(differsEveryRun(approved, { hash: "h2", fingerprint: "f2" }, true)).toBe(false);
    expect(differsEveryRun({ hash: "h" }, { hash: "h", fingerprint: "f2" }, true)).toBe(false);
    expect(differsEveryRun(approved, { hash: "h" }, true)).toBe(false);
  });
});
