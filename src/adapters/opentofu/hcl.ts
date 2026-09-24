// Just enough of HCL's native syntax to read the structure of a file: its
// blocks with their labels, and the attributes whose value is one plain
// string. Root module discovery (record 0092) needs no more: a `terraform`
// block's `backend` and `cloud` blocks, a `module` block's `source`, a lock
// file's `provider` labels. No value is ever evaluated, and a file this reader
// cannot follow gives what it read up to there, never an error: discovery
// then finds less, which is the safe side.
//
// Comments are left out of everything, so a commented-out block counts for
// nothing. `code` is the file without its comments, for a plain search such as
// a reference to the workspace.

export interface HclBlock {
  type: string;
  labels: string[];
  // Attributes whose whole value is one string with no template in it.
  strings: Record<string, string>;
  // Every attribute of the block, whatever its value.
  attributes: string[];
  blocks: HclBlock[];
}

export interface HclFile {
  blocks: HclBlock[];
  // The attributes at the top of the file, as a var file has them.
  attributes: string[];
  code: string;
}

type Token =
  | { kind: "word"; text: string }
  // `literal` is the value of a string with no template, else undefined.
  | { kind: "string"; literal: string | undefined }
  | { kind: "open" | "close" | "equals" | "newline" }
  | { kind: "bracket"; text: string }
  | { kind: "other" };

export function readHcl(text: string): HclFile {
  const { tokens, code } = tokenize(text);
  const reader = { tokens, at: 0 };
  const top = body(reader, false);
  return { blocks: top.blocks, attributes: top.attributes, code };
}

interface Reader {
  tokens: Token[];
  at: number;
}

// The items of a body up to its closing brace, or to the end of the file.
function body(reader: Reader, inner: boolean): HclBlock {
  const block: HclBlock = { type: "", labels: [], strings: {}, attributes: [], blocks: [] };
  items(reader, block, inner);
  return block;
}

function items(reader: Reader, into: HclBlock, inner: boolean): void {
  const { tokens } = reader;
  while (reader.at < tokens.length) {
    const token = tokens[reader.at];
    if (token === undefined) return;
    if (token.kind === "newline") {
      reader.at++;
      continue;
    }
    if (token.kind === "close") {
      if (inner) reader.at++;
      // A stray brace at the top ends nothing: skip it.
      else {
        reader.at++;
        continue;
      }
      return;
    }
    if (token.kind !== "word") {
      skipLine(reader);
      continue;
    }
    reader.at++;
    const next = tokens[reader.at];
    if (next?.kind === "equals") {
      reader.at++;
      into.attributes.push(token.text);
      const value = expression(reader);
      if (value !== undefined) into.strings[token.text] = value;
      continue;
    }
    // A block: labels, then its body.
    const labels: string[] = [];
    while (reader.at < tokens.length) {
      const label = tokens[reader.at];
      if (label?.kind === "string" && label.literal !== undefined) labels.push(label.literal);
      else if (label?.kind === "word") labels.push(label.text);
      else break;
      reader.at++;
    }
    if (tokens[reader.at]?.kind !== "open") {
      skipLine(reader);
      continue;
    }
    reader.at++;
    const child: HclBlock = { type: token.text, labels, strings: {}, attributes: [], blocks: [] };
    items(reader, child, true);
    into.blocks.push(child);
  }
}

// An attribute's value runs to the end of its line, or to the brace that
// closes its block, and on over lines while a bracket is open. Its string
// when it is one plain string and nothing else.
function expression(reader: Reader): string | undefined {
  const { tokens } = reader;
  let depth = 0;
  const seen: Token[] = [];
  while (reader.at < tokens.length) {
    const token = tokens[reader.at];
    if (token === undefined) break;
    if (depth === 0 && (token.kind === "newline" || token.kind === "close")) break;
    if (token.kind === "open" || (token.kind === "bracket" && "([".includes(token.text))) depth++;
    if (token.kind === "close" || (token.kind === "bracket" && ")]".includes(token.text))) depth--;
    seen.push(token);
    reader.at++;
  }
  const [only] = seen;
  return seen.length === 1 && only?.kind === "string" ? only.literal : undefined;
}

function skipLine(reader: Reader): void {
  expression(reader);
}

function tokenize(text: string): { tokens: Token[]; code: string } {
  const tokens: Token[] = [];
  let code = "";
  let at = 0;
  while (at < text.length) {
    const char = text[at] ?? "";
    const rest = text.slice(at, at + 2);
    if (char === "#" || rest === "//") {
      while (at < text.length && text[at] !== "\n") at++;
      continue;
    }
    if (rest === "/*") {
      const end = text.indexOf("*/", at + 2);
      at = end < 0 ? text.length : end + 2;
      code += " ";
      continue;
    }
    if (char === "\n") {
      tokens.push({ kind: "newline" });
      code += char;
      at++;
      continue;
    }
    if (char === '"') {
      const end = stringEnd(text, at);
      const raw = text.slice(at + 1, end - 1);
      tokens.push({ kind: "string", literal: literalOf(raw) });
      code += text.slice(at, end);
      at = end;
      continue;
    }
    const heredoc = /^<<-?([A-Za-z_][A-Za-z0-9_]*)[ \t]*\n/.exec(text.slice(at));
    if (heredoc !== null) {
      const marker = heredoc[1] ?? "";
      let end = at + heredoc[0].length;
      while (end < text.length) {
        const lineEnd = text.indexOf("\n", end);
        const line = text.slice(end, lineEnd < 0 ? text.length : lineEnd);
        end = lineEnd < 0 ? text.length : lineEnd + 1;
        if (line.trim() === marker) break;
      }
      tokens.push({ kind: "string", literal: undefined });
      code += text.slice(at, end);
      // The line the heredoc ended on ends the attribute.
      tokens.push({ kind: "newline" });
      at = end;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(text.slice(at));
    if (word !== null) {
      tokens.push({ kind: "word", text: word[0] });
      code += word[0];
      at += word[0].length;
      continue;
    }
    if (char === "{") tokens.push({ kind: "open" });
    else if (char === "}") tokens.push({ kind: "close" });
    else if (char === "=" && text[at + 1] !== "=" && text[at + 1] !== ">")
      tokens.push({ kind: "equals" });
    else if ("[]()".includes(char)) tokens.push({ kind: "bracket", text: char });
    else if (!/\s/.test(char)) tokens.push({ kind: "other" });
    if (char === "=" && (text[at + 1] === "=" || text[at + 1] === ">")) {
      code += text.slice(at, at + 2);
      at += 2;
      continue;
    }
    code += char;
    at++;
  }
  return { tokens, code };
}

// The index just past the closing quote of the string that opens at `start`.
// A template's `${ }` or `%{ }` may hold strings of its own.
function stringEnd(text: string, start: number): number {
  let at = start + 1;
  while (at < text.length) {
    const char = text[at];
    if (char === "\\") {
      at += 2;
      continue;
    }
    if (char === '"') return at + 1;
    if (char === "\n") return at;
    // "$${" and "%%{" are the escapes for a literal "${" and "%{".
    if ((char === "$" || char === "%") && text[at + 1] === char && text[at + 2] === "{") {
      at += 3;
      continue;
    }
    if ((char === "$" || char === "%") && text[at + 1] === "{") {
      at = templateEnd(text, at + 2);
      continue;
    }
    at++;
  }
  return text.length;
}

function templateEnd(text: string, start: number): number {
  let depth = 1;
  let at = start;
  while (at < text.length && depth > 0) {
    const char = text[at];
    if (char === '"') {
      at = stringEnd(text, at);
      continue;
    }
    if (char === "{") depth++;
    if (char === "}") depth--;
    at++;
  }
  return at;
}

// A string's value, when it holds no template and no escape but a quote or a
// backslash.
function literalOf(raw: string): string | undefined {
  if (/\$\{|%\{/.test(raw)) return undefined;
  if (/\\[^"\\]/.test(raw)) return undefined;
  return raw.replace(/\\(["\\])/g, "$1");
}
