import { describe, expect, test } from "bun:test";
import type { Change, Diff } from "../../src/core/diff.ts";
import { canonicalDiff, diffHash } from "../../src/core/diff-hash.ts";

// Fixed vectors. Each canonical document was written by hand from record 0008
// and hashed outside this code base:
//   printf '%s' '<document>' | shasum -a 256 | cut -c1-16
// A change of algorithm, of field order or of escaping breaks them. If one of
// these has to change, every outstanding tick aborts once (0008), so say so in
// the pull request.
describe("fixed vectors", () => {
  test("a diff with no changes", () => {
    const diff: Diff = { stackId: "envs/prod", changes: [] };
    expect(canonicalDiff(diff)).toBe('{"changes":[],"stackId":"envs/prod"}');
    expect(diffHash(diff)).toBe("e0f919130abe4bf7");
  });

  test("every op and every tracking change, handed over out of order", () => {
    expect(canonicalDiff(everything)).toBe(
      '{"changes":[' +
        '{"address":"a1","changedKeys":[],"name":"bucket","op":"create","replaceKeys":[],"type":"storage:Bucket"},' +
        '{"address":"a2","changedKeys":["image","replicas"],"name":"grafana","op":"update","replaceKeys":[],"type":"apps:Deployment"},' +
        '{"address":"a3","changedKeys":["keepers","length"],"name":"pet","op":"replace","replaceKeys":["keepers"],"type":"random:Pet"},' +
        '{"address":"a4","changedKeys":[],"name":"old","op":"delete","replaceKeys":[],"type":"storage:Bucket"},' +
        '{"address":"a5","changedKeys":[],"name":"adopted","op":"none","replaceKeys":[],"tracking":"import","type":"dns:Record"},' +
        '{"address":"a6","changedKeys":["ttl"],"name":"renamed","op":"update","previousAddress":"a0","replaceKeys":[],"tracking":"move","type":"dns:Record"},' +
        '{"address":"a7","changedKeys":[],"name":"kept","op":"none","replaceKeys":[],"tracking":"forget","type":"dns:Record"}' +
        '],"stackId":"apps/grafana:prod"}',
    );
    expect(diffHash(everything)).toBe("d836bd15c81aa420");
  });

  // "B" < "a" rules out locale order. The emoji is two code units starting at
  // U+D83D, so it sorts before U+FF5E, which rules out code point order and
  // UTF-8 byte order. Non-ASCII text is written as is, control characters as
  // JSON.stringify escapes them.
  test("code unit sorting and string escaping", () => {
    const diff: Diff = {
      stackId: "s",
      changes: [
        {
          address: "a1",
          type: "t",
          name: 'say "hi"\\\n\u0001\u00e9',
          op: "update",
          changedKeys: ["\uff5e", "a", "\u{1f600}", "B"],
          replaceKeys: [],
        },
      ],
    };
    expect(canonicalDiff(diff)).toBe(
      '{"changes":[{"address":"a1","changedKeys":["B","a","\u{1f600}","\uff5e"],' +
        '"name":"say \\"hi\\"\\\\\\n\\u0001\u00e9","op":"update","replaceKeys":[],"type":"t"}],"stackId":"s"}',
    );
    expect(diffHash(diff)).toBe("c68be72f84c62e58");
  });

  // Record 0046: keys are property paths, written into the document as the
  // tool wrote them, quotes escaped like any other text. The same change told
  // by top-level names gives another hash, which is why every pending row got
  // a new hash once when paths came in.
  test("property paths with list indexes and quoted map keys", () => {
    const paths = (web: string[], settings: string[]): Diff => ({
      stackId: "apps/web:prod",
      changes: [
        change({
          address: "a2",
          type: "core:ConfigMap",
          name: "settings",
          op: "replace",
          changedKeys: settings,
          replaceKeys: settings,
        }),
        change({ address: "a1", type: "apps:Deployment", name: "web", changedKeys: web }),
      ],
    });
    const nested = paths(
      ["spec.template.spec.containers[0].image", 'metadata.annotations["example.com/revision"]'],
      ['data["app.properties"]'],
    );
    expect(canonicalDiff(nested)).toBe(
      '{"changes":[' +
        '{"address":"a1","changedKeys":["metadata.annotations[\\"example.com/revision\\"]","spec.template.spec.containers[0].image"],"name":"web","op":"update","replaceKeys":[],"type":"apps:Deployment"},' +
        '{"address":"a2","changedKeys":["data[\\"app.properties\\"]"],"name":"settings","op":"replace","replaceKeys":["data[\\"app.properties\\"]"],"type":"core:ConfigMap"}' +
        '],"stackId":"apps/web:prod"}',
    );
    expect(diffHash(nested)).toBe("4a831612a802540d");
    expect(diffHash(paths(["metadata", "spec"], ["data"]))).toBe("499ca3a5fae7b813");
  });
});

function change(fields: Partial<Change> = {}): Change {
  return {
    address: "a1",
    type: "t",
    name: "n",
    op: "update",
    changedKeys: ["k"],
    replaceKeys: [],
    ...fields,
  };
}

describe("the same diff always gives the same hash", () => {
  const base: Diff = { stackId: "s", changes: [change()] };

  test("whatever order the fields of an object were set in", () => {
    const reversed = {
      changes: [
        {
          replaceKeys: [],
          changedKeys: ["k"],
          op: "update",
          name: "n",
          type: "t",
          address: "a1",
        },
      ],
      stackId: "s",
    } satisfies Diff;
    expect(canonicalDiff(reversed)).toBe(canonicalDiff(base));
  });

  test("whatever order the changes and the keys come in", () => {
    const a = change({ address: "a", changedKeys: ["x", "y"], replaceKeys: ["x", "y"] });
    const b = change({ address: "b" });
    const swapped = change({ address: "a", changedKeys: ["y", "x"], replaceKeys: ["y", "x"] });
    expect(diffHash({ stackId: "s", changes: [b, swapped] })).toBe(
      diffHash({ stackId: "s", changes: [a, b] }),
    );
  });

  test("when a key is listed twice", () => {
    const twice = change({ changedKeys: ["k", "k"], replaceKeys: ["k", "k"] });
    const once = change({ changedKeys: ["k"], replaceKeys: ["k"] });
    expect(canonicalDiff({ stackId: "s", changes: [twice] })).toBe(
      canonicalDiff({ stackId: "s", changes: [once] }),
    );
  });

  test("when an absent optional field is spelled as undefined", () => {
    // exactOptionalPropertyTypes forbids this in typed code. Parsed tool output can still do it.
    const spelled = {
      ...change(),
      tracking: undefined,
      previousAddress: undefined,
    } as unknown as Change;
    const document = canonicalDiff({ stackId: "s", changes: [spelled] });
    expect(document).toBe(canonicalDiff(base));
    expect(document).not.toContain("tracking");
    expect(document).not.toContain("previousAddress");
    expect(document).not.toContain("null");
  });

  test("when an object carries a field the diff does not have", () => {
    const extra = { ...change(), after: "a value that must never count" } as Change;
    expect(canonicalDiff({ stackId: "s", changes: [extra] })).toBe(canonicalDiff(base));
  });

  test("and hashing leaves the diff as it was handed over", () => {
    const diff: Diff = {
      stackId: "s",
      changes: [change({ address: "b", changedKeys: ["y", "x", "y"] }), change({ address: "a" })],
    };
    const before = structuredClone(diff);
    diffHash(diff);
    expect(diff).toEqual(before);
  });

  test("when an adapter breaks the rule that an address is unique", () => {
    const one = change({ name: "one" });
    const two = change({ name: "two" });
    expect(diffHash({ stackId: "s", changes: [one, two] })).toBe(
      diffHash({ stackId: "s", changes: [two, one] }),
    );
  });
});

describe("a different diff gives a different hash", () => {
  const base = change({ op: "replace", changedKeys: ["k"], replaceKeys: ["k"] });
  const different: [string, Diff][] = [
    ["the stack id", { stackId: "other", changes: [base] }],
    ["the address", { stackId: "s", changes: [{ ...base, address: "a2" }] }],
    ["the type", { stackId: "s", changes: [{ ...base, type: "t2" }] }],
    ["the name", { stackId: "s", changes: [{ ...base, name: "n2" }] }],
    ["the op", { stackId: "s", changes: [{ ...base, op: "delete" }] }],
    ["a tracking change", { stackId: "s", changes: [{ ...base, tracking: "import" }] }],
    [
      "the previous address",
      { stackId: "s", changes: [{ ...base, tracking: "move", previousAddress: "a0" }] },
    ],
    ["a changed key", { stackId: "s", changes: [{ ...base, changedKeys: ["k", "k2"] }] }],
    ["a replace key", { stackId: "s", changes: [{ ...base, replaceKeys: [] }] }],
    ["one more change", { stackId: "s", changes: [base, { ...base, address: "a2" }] }],
    ["no changes", { stackId: "s", changes: [] }],
  ];

  test.each(different)("when %s differs", (_what, diff) => {
    expect(diffHash(diff)).not.toBe(diffHash({ stackId: "s", changes: [base] }));
  });

  test("and a move differs from the same move without its previous address", () => {
    const move = { ...base, tracking: "move" } satisfies Change;
    expect(diffHash({ stackId: "s", changes: [{ ...move, previousAddress: "a0" }] })).not.toBe(
      diffHash({ stackId: "s", changes: [move] }),
    );
  });
});

describe("the diff hash", () => {
  test("is 16 lower case hex characters", () => {
    expect(diffHash({ stackId: "s", changes: [change()] })).toMatch(/^[0-9a-f]{16}$/);
  });
});

const everything: Diff = {
  stackId: "apps/grafana:prod",
  changes: [
    {
      address: "a7",
      type: "dns:Record",
      name: "kept",
      op: "none",
      tracking: "forget",
      changedKeys: [],
      replaceKeys: [],
    },
    {
      address: "a3",
      type: "random:Pet",
      name: "pet",
      op: "replace",
      changedKeys: ["length", "keepers", "length"],
      replaceKeys: ["keepers", "keepers"],
    },
    {
      address: "a6",
      type: "dns:Record",
      name: "renamed",
      op: "update",
      tracking: "move",
      previousAddress: "a0",
      changedKeys: ["ttl"],
      replaceKeys: [],
    },
    {
      address: "a1",
      type: "storage:Bucket",
      name: "bucket",
      op: "create",
      changedKeys: [],
      replaceKeys: [],
    },
    {
      address: "a2",
      type: "apps:Deployment",
      name: "grafana",
      op: "update",
      changedKeys: ["replicas", "image"],
      replaceKeys: [],
    },
    {
      address: "a5",
      type: "dns:Record",
      name: "adopted",
      op: "none",
      tracking: "import",
      changedKeys: [],
      replaceKeys: [],
    },
    {
      address: "a4",
      type: "storage:Bucket",
      name: "old",
      op: "delete",
      changedKeys: [],
      replaceKeys: [],
    },
  ],
};
