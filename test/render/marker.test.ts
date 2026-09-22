import { describe, expect, test } from "bun:test";
import {
  decodeMarkerValue,
  encodeMarkerValue,
  parseDashboard,
  RESCAN_MARKER,
  ROW_CLOSE_MARKER,
  rootMarker,
  rowMarker,
} from "../../src/render/marker.ts";

describe("marker values", () => {
  test("an ordinary stack id reads as itself", () => {
    expect(encodeMarkerValue("apps/grafana:prod")).toBe("apps/grafana:prod");
  });

  // The set is written out from record 0009: `%`, `"`, `<`, `>`, every byte up
  // to 0x20, and 0x7F. Upper case hex.
  test("what could close the quote or the comment is percent-encoded", () => {
    expect(encodeMarkerValue('a%b"c<d>e f')).toBe("a%25b%22c%3Cd%3Ee%20f");
    expect(encodeMarkerValue("\u0000\t\n\r\u001f\u007f")).toBe("%00%09%0A%0D%1F%7F");
  });

  test("nothing else is encoded", () => {
    const plain = "--!#$&'()*+,-./:;=?@[\\]^_`{|}~é日本🌊";
    expect(encodeMarkerValue(plain)).toBe(plain);
  });

  test("an encoded value can never hold a quote, an angle bracket or a line break", () => {
    const encoded = encodeMarkerValue('x" --> <!-- sluiceway:row stack="y"\n- [x]');
    expect(encoded).not.toMatch(/["<>\s]/);
  });

  test("every value comes back as it went in", () => {
    const values = [
      "",
      "apps/grafana:prod",
      ".:prod",
      "100%",
      "%25",
      "%2",
      'say "hi" <b>',
      "tab\there\nnewline\r\nand\u007fdel",
      "dir with spaces/stack:dev",
      "日本/スタック:本番",
      "🌊/penny:prod",
      "a--b-->c",
    ];
    for (const value of values) {
      expect(decodeMarkerValue(encodeMarkerValue(value))).toBe(value);
    }
  });

  // Another writer may encode more than this one does. Bytes are UTF-8.
  test("decoding reads any percent-encoded byte, in either case of hex", () => {
    expect(decodeMarkerValue("caf%C3%A9%2fbar%2Fbaz")).toBe("café/bar/baz");
    expect(decodeMarkerValue("%F0%9F%8C%8A")).toBe("🌊");
  });

  test("a percent sign that starts no byte stays as it is", () => {
    expect(decodeMarkerValue("100%")).toBe("100%");
    expect(decodeMarkerValue("%zz%4")).toBe("%zz%4");
  });
});

// Expected lines are the examples of records 0009 and 0027.
describe("writing markers", () => {
  test("the root marker carries the version and the scan facts, in a fixed order", () => {
    expect(
      rootMarker({
        scanAt: "2026-09-20T06:00:12Z",
        scanRun: "1234567890",
        scanSha: "294bbc0",
      }),
    ).toBe(
      '<!-- sluiceway:dashboard v="1" scan-sha="294bbc0" scan-run="1234567890" scan-at="2026-09-20T06:00:12Z" -->',
    );
  });

  test("a pending row marker holds stack, state and hash", () => {
    expect(
      rowMarker({ stackId: "apps/grafana:prod", state: "pending", hash: "3fa9c1e2aabbccdd" }),
    ).toBe(
      '<!-- sluiceway:row stack="apps/grafana:prod" state="pending" hash="3fa9c1e2aabbccdd" -->',
    );
  });

  test("a row without a diff has no hash", () => {
    expect(rowMarker({ stackId: "apps/loki:prod", state: "deploying" })).toBe(
      '<!-- sluiceway:row stack="apps/loki:prod" state="deploying" -->',
    );
  });

  test("destroys and failed follow the hash, and are left out when there is nothing to say", () => {
    expect(
      rowMarker({
        stackId: "storage/buckets:prod",
        state: "pending",
        hash: "2b44350653e84a11",
        destroys: 2,
        failed: true,
      }),
    ).toBe(
      '<!-- sluiceway:row stack="storage/buckets:prod" state="pending" hash="2b44350653e84a11" destroys="2" failed="true" -->',
    );
    expect(rowMarker({ stackId: "a", state: "in-sync", destroys: 0, failed: false })).toBe(
      '<!-- sluiceway:row stack="a" state="in-sync" -->',
    );
  });

  // Record 0028, settled in slice 1.8: a writer that carries a row through
  // cannot read its text, and the note under the scan line counts these.
  test("shortened follows failed and holds the level, and is left out for a row in full", () => {
    expect(
      rowMarker({
        stackId: "storage/buckets:prod",
        state: "pending",
        hash: "2b44350653e84a11",
        destroys: 2,
        failed: true,
        shortened: 3,
      }),
    ).toBe(
      '<!-- sluiceway:row stack="storage/buckets:prod" state="pending" hash="2b44350653e84a11" destroys="2" failed="true" shortened="3" -->',
    );
    expect(rowMarker({ stackId: "a", state: "pending", hash: "00", shortened: 0 })).toBe(
      '<!-- sluiceway:row stack="a" state="pending" hash="00" -->',
    );
  });

  // Record 0055: the key record 0009 reserved, last, so every older key keeps
  // its place.
  test("drift says the hash includes drift, after every other key, and is left out otherwise", () => {
    expect(
      rowMarker({
        stackId: "site:prod",
        state: "pending",
        hash: "dd803ea1e69c7010",
        destroys: 1,
        failed: true,
        shortened: 2,
        drift: true,
      }),
    ).toBe(
      '<!-- sluiceway:row stack="site:prod" state="pending" hash="dd803ea1e69c7010" destroys="1" failed="true" shortened="2" drift="true" -->',
    );
    expect(
      rowMarker({ stackId: "site:prod", state: "drift", hash: "be148b80efa3bb8f", drift: true }),
    ).toBe(
      '<!-- sluiceway:row stack="site:prod" state="drift" hash="be148b80efa3bb8f" drift="true" -->',
    );
    expect(rowMarker({ stackId: "a", state: "pending", hash: "00", drift: false })).toBe(
      '<!-- sluiceway:row stack="a" state="pending" hash="00" -->',
    );
  });

  // Record 0059: the stacks a preview read from a program's stack references,
  // after drift, so every older key keeps its place.
  test("depends-on lists the stacks a preview read, last, and is left out when there are none", () => {
    expect(
      rowMarker({
        stackId: "app:prod",
        state: "pending",
        hash: "00",
        drift: true,
        dependsOn: ["network:prod", "db:prod"],
      }),
    ).toBe(
      '<!-- sluiceway:row stack="app:prod" state="pending" hash="00" drift="true" depends-on="network:prod,db:prod" -->',
    );
    expect(rowMarker({ stackId: "app:prod", state: "in-sync", dependsOn: [] })).toBe(
      '<!-- sluiceway:row stack="app:prod" state="in-sync" -->',
    );
  });

  test("an id with a comma, a percent sign or a space reads back as itself", () => {
    const ids = ["a,b:prod", "100%:prod", "my dir:prod"];
    const line = `- [ ] **x** ${rowMarker({ stackId: "x", state: "pending", hash: "00", dependsOn: ids })}`;
    const [row] = parseDashboard(line).rows;
    expect(row?.known && row.dependsOn).toEqual(ids);
  });

  test("a stack id is encoded on the marker", () => {
    expect(rowMarker({ stackId: 'my dir/"x":prod', state: "in-sync" })).toBe(
      '<!-- sluiceway:row stack="my%20dir/%22x%22:prod" state="in-sync" -->',
    );
  });

  test("the closing marker and the rescan marker have no payload", () => {
    expect(ROW_CLOSE_MARKER).toBe("<!-- /sluiceway:row -->");
    expect(RESCAN_MARKER).toBe("<!-- sluiceway:rescan -->");
  });
});
