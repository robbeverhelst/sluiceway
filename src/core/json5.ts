// A small JSON5 reader (slice 4.13). Renovate reads its config files as JSONC
// and as JSON5, and Sluiceway reads them for one setting, so a reader of its
// own costs less than a runtime dependency (build plan, section 5). JSON and
// JSONC are subsets of JSON5, so this one reader serves every config file.
// Pure: it takes text and gives a value, or throws.

export class Json5Error extends Error {
  constructor(message: string, at: number) {
    super(`${message} at character ${at + 1}.`);
    this.name = "Json5Error";
  }
}

const ESCAPES: Record<string, string> = {
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "0": "\0",
};

// Line terminators JSON5 lets a backslash continue a string over.
const LINE_BREAKS = new Set(["\n", "\r", "\u2028", "\u2029"]);

const LITERALS: [string, unknown][] = [
  ["true", true],
  ["false", false],
  ["null", null],
];

const IDENTIFIER_START = /[\p{L}\p{Nl}$_]/u;
const IDENTIFIER_PART = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$_\u200c\u200d]/u;

export function parseJson5(text: string): unknown {
  let at = 0;

  const fail = (message: string): never => {
    throw new Json5Error(message, at);
  };

  const skip = () => {
    for (;;) {
      const char = text[at];
      if (char === undefined) return;
      if (/\s/.test(char) || char === "\ufeff") {
        at++;
      } else if (text.startsWith("//", at)) {
        while (at < text.length && !LINE_BREAKS.has(text[at] ?? "")) at++;
      } else if (text.startsWith("/*", at)) {
        const end = text.indexOf("*/", at + 2);
        if (end < 0) fail("A comment is not closed");
        at = end + 2;
      } else {
        return;
      }
    }
  };

  const hex = (length: number): string => {
    const digits = text.slice(at, at + length);
    if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(digits)) fail("A bad escape");
    at += length;
    return String.fromCharCode(Number.parseInt(digits, 16));
  };

  const string = (): string => {
    const quote = text[at];
    at++;
    let out = "";
    for (;;) {
      const char = text[at];
      if (char === undefined || char === "\n" || char === "\r") fail("A string is not closed");
      at++;
      if (char === quote) return out;
      if (char !== "\\") {
        out += char;
        continue;
      }
      const escaped = text[at] ?? "";
      at++;
      if (escaped === "u") out += hex(4);
      else if (escaped === "x") out += hex(2);
      else if (escaped === "\r") {
        if (text[at] === "\n") at++;
      } else if (LINE_BREAKS.has(escaped)) {
        // A continued line adds nothing.
      } else if (/[1-9]/.test(escaped)) fail("A bad escape");
      else out += ESCAPES[escaped] ?? escaped;
    }
  };

  const number = (): number => {
    const match =
      /^[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(
        text.slice(at),
      );
    if (!match) return fail("Unexpected text");
    at += match[0].length;
    const raw = match[0];
    const sign = raw.startsWith("-") ? -1 : 1;
    const body = raw.replace(/^[+-]/, "");
    if (body === "Infinity") return sign * Number.POSITIVE_INFINITY;
    if (body === "NaN") return Number.NaN;
    if (/^0[xX]/.test(body)) return sign * Number.parseInt(body.slice(2), 16);
    return sign * Number(body);
  };

  const identifier = (): string => {
    let out = "";
    const first = text[at] ?? "";
    if (!IDENTIFIER_START.test(first)) fail("A key is not a name or a string");
    while (at < text.length && IDENTIFIER_PART.test(text[at] ?? "")) out += text[at++];
    return out;
  };

  const value = (): unknown => {
    skip();
    const char = text[at];
    if (char === "{") return object();
    if (char === "[") return array();
    if (char === '"' || char === "'") return string();
    const literal = LITERALS.find(([name]) => text.startsWith(name, at));
    if (literal) {
      at += literal[0].length;
      return literal[1];
    }
    return number();
  };

  const object = (): Record<string, unknown> => {
    at++;
    const out: Record<string, unknown> = {};
    for (;;) {
      skip();
      if (text[at] === "}") {
        at++;
        return out;
      }
      const key = text[at] === '"' || text[at] === "'" ? string() : identifier();
      skip();
      if (text[at] !== ":") fail("A colon is missing");
      at++;
      // A key named __proto__ stays data.
      Object.defineProperty(out, key, {
        value: value(),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      skip();
      if (text[at] === ",") at++;
      else if (text[at] !== "}") fail("A comma is missing");
    }
  };

  const array = (): unknown[] => {
    at++;
    const out: unknown[] = [];
    for (;;) {
      skip();
      if (text[at] === "]") {
        at++;
        return out;
      }
      out.push(value());
      skip();
      if (text[at] === ",") at++;
      else if (text[at] !== "]") fail("A comma is missing");
    }
  };

  const result = value();
  skip();
  if (at < text.length) fail("Unexpected text after the value");
  return result;
}
