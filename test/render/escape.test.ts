import { describe, expect, test } from "bun:test";
import { escapeText } from "../../src/render/escape.ts";

// Types, names, property names and stack ids come from the user's code and the
// provider's schema. They are never trusted as markup (record 0027).
describe("escaping text for a row", () => {
  test("ordinary names read as themselves", () => {
    expect(escapeText("aws:s3/bucketPolicy:BucketPolicy")).toBe("aws:s3/bucketPolicy:BucketPolicy");
    expect(escapeText("uploads-public-read")).toBe("uploads-public-read");
    expect(escapeText("apps/grafana:prod")).toBe("apps/grafana:prod");
  });

  test("HTML cannot open a tag, an entity or a comment", () => {
    expect(escapeText('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escapeText("a&amp;b")).toBe("a&amp;amp;b");
    expect(escapeText("</details><!-- /sluiceway:row -->")).toBe(
      "&lt;/details&gt;&lt;!-- /sluiceway:row --&gt;",
    );
  });

  // A change line outside the fold is Markdown, the same line inside the fold
  // is an HTML block. A character reference is literal text in both.
  test("Markdown cannot start emphasis, code, a link or a table", () => {
    expect(escapeText("*bold* _em_ `code` ~~gone~~")).toBe(
      "&#42;bold&#42; &#95;em&#95; &#96;code&#96; &#126;&#126;gone&#126;&#126;",
    );
    expect(escapeText("[click](https://example.com)")).toBe(
      "&#91;click&#93;(https&#58;//example.com)",
    );
    expect(escapeText("a|b\\c")).toBe("a&#124;b&#92;c");
  });

  // GitHub turns #1 into a link to an issue and @name into a mention after it
  // decoded the character references, so &#35; and &#64; are linked still. A
  // span around the character splits the token, and the text reads and copies
  // as itself (record 0112).
  test("an issue reference and a mention are split, so GitHub links neither", () => {
    expect(escapeText("#1 @octocat")).toBe("<span>#</span>1 <span>@</span>octocat");
    expect(escapeText("octo/repo#12 a@b.com")).toBe(
      "octo/repo<span>#</span>12 a<span>@</span>b.com",
    );
  });

  // GitHub finds a web address in the Markdown source, before references are
  // decoded, so one character reference in www. or :// is enough. GH-1 is an
  // issue reference too, and a reference in it is decoded first like #.
  test("a web address and a GH- reference are not linked", () => {
    expect(escapeText("www.example.com WWW.Example.com")).toBe(
      "www&#46;example.com WWW&#46;Example.com",
    );
    expect(escapeText("https://example.com ftp://x")).toBe("https&#58;//example.com ftp&#58;//x");
    expect(escapeText("GH-1 gh-12 gh-x")).toBe("GH<span>-</span>1 gh<span>-</span>12 gh-x");
  });

  // The line of the release verification that found it (issue 271).
  test("the name the verification used is plain text", () => {
    expect(escapeText("#1 @sluiceway www.example.com *x*")).toBe(
      "<span>#</span>1 <span>@</span>sluiceway www&#46;example.com &#42;x&#42;",
    );
  });

  test("a line break or another control character becomes a space, so a name never starts a line", () => {
    expect(escapeText("x\n- [x] y\r\nz\tw\u0000\u007f\u2028\u2029.")).toBe(
      "x - &#91;x&#93; y  z w    .",
    );
  });
});
