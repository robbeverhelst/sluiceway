// The env file (record 0100): a file of NAME=value lines that the `env-file`
// input names, read once per job for the tool's process and nothing else.
// The format is strict, and a line that does not fit is refused by its line
// number. No problem ever quotes a line or a value, because a broken line may
// hold a secret.
//
// The format: a comment line starts with `#`, a blank line is skipped, and
// every other line is `NAME=value`, with an optional `export ` in front and
// white space around the `=`. An unquoted value runs to the end of its line
// with the white space around it removed, and a `#` in it is part of it. A
// value in double quotes may span lines and knows the escapes \n, \" and \\.
// A value in single quotes is taken as it is, across lines too. Nothing may
// follow a closing quote.

export type ParsedEnvFile =
  | { ok: true; values: Record<string, string> }
  | { ok: false; problem: string };

// What 1Password's references start with. A value that holds one is a
// reference a secret manager has to resolve, and Sluiceway resolves none.
// init looks for the same in the files of a repo.
export const SECRET_REFERENCE = "op://";

const NAME = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=(.*)$/;

function notALine(line: number): ParsedEnvFile {
  return { ok: false, problem: `Line ${line} is not a NAME=value line, a comment or blank.` };
}

export function parseEnvFile(text: string): ParsedEnvFile {
  const lines = text.replace(/^﻿/, "").replaceAll("\r\n", "\n").split("\n");
  const values: Record<string, string> = {};
  const setAt = new Map<string, number>();
  // The line being read, 1-based, as a person counts them.
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    const number = ++at;
    if (/^\s*(#|$)/.test(line)) continue;
    const match = NAME.exec(line);
    if (match === null) return notALine(number);
    const [, name = "", rest = ""] = match;
    const first = setAt.get(name);
    if (first !== undefined) {
      return {
        ok: false,
        problem: `Line ${number} sets ${name}, which line ${first} already set.`,
      };
    }
    if (name.startsWith("INPUT_")) {
      return {
        ok: false,
        problem: `Line ${number} sets ${name}. A name that starts with INPUT_ never reaches the tool, so it is refused.`,
      };
    }
    let value: string;
    const raw = rest.trim();
    const quote = raw[0];
    if (quote === '"' || quote === "'") {
      // The quoted text may run on over the lines that follow.
      const read = readQuoted(quote, [raw.slice(1), ...lines.slice(at)]);
      if (read.kind === "open") {
        return { ok: false, problem: `Line ${number} opens a quote that is never closed.` };
      }
      if (read.kind === "trailing") {
        return {
          ok: false,
          problem: `Line ${number} has text after its closing quote. A comment goes on a line of its own.`,
        };
      }
      if (read.kind === "escape") {
        return {
          ok: false,
          problem: `Line ${number} holds an escape that is not \\n, \\" or \\\\ inside double quotes.`,
        };
      }
      value = read.value;
      at += read.linesUsed;
    } else {
      value = raw;
    }
    if (value.includes(SECRET_REFERENCE)) {
      return {
        ok: false,
        problem: `Line ${number} holds a secret reference (${SECRET_REFERENCE}). Sluiceway resolves none: let your secret manager resolve the file first, or load its references the way the credentials page shows.`,
      };
    }
    values[name] = value;
    setAt.set(name, number);
  }
  return { ok: true, values };
}

type Quoted =
  // `linesUsed` is how many lines beyond the first the value took.
  | { kind: "closed"; value: string; linesUsed: number }
  | { kind: "open" }
  | { kind: "trailing" }
  | { kind: "escape" };

// Reads a quoted value from the text after the opening quote, over as many
// lines as it takes, and wants nothing but white space after the closing one.
function readQuoted(quote: '"' | "'", lines: string[]): Quoted {
  let value = "";
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    let column = 0;
    while (column < line.length) {
      const char = line[column] ?? "";
      if (char === quote) {
        if (line.slice(column + 1).trim() !== "") return { kind: "trailing" };
        return { kind: "closed", value, linesUsed: index };
      }
      if (quote === '"' && char === "\\") {
        const next = line[column + 1];
        if (next === "n") value += "\n";
        else if (next === '"' || next === "\\") value += next;
        else return { kind: "escape" };
        column += 2;
        continue;
      }
      value += char;
      column++;
    }
    value += "\n";
  }
  return { kind: "open" };
}

// A mask of 1 to 3 characters hits ordinary words and numbers everywhere in
// the job log and turns them into stars (onboarding log, hurdle 11), so such
// a value is not masked, and the log says which names were loaded without a
// mask. Everything from 4 characters on is masked whatever it looks like: a
// short password is still a password, and a mask of `prod` costs less than
// a password in the log (the owner, 2026-09-24, on pull request 237).
export const MASK_LENGTH = 4;

// Why a value gets no mask, or undefined when it does.
export function unmaskedReason(value: string): string | undefined {
  if (value === "") return "empty";
  if (value === "true" || value === "false") return "true or false";
  if (value.length < MASK_LENGTH) return `shorter than ${MASK_LENGTH} characters`;
  return undefined;
}

// What to register as masks for one value: the value itself, and when it
// spans lines each of its lines on its own, because the runner matches the
// log line by line. A line that would not be masked on its own is left out.
export function masks(value: string): string[] {
  if (unmaskedReason(value) !== undefined) return [];
  const lines = value.split("\n");
  if (lines.length === 1) return [value];
  return [value, ...lines.filter((line) => unmaskedReason(line) === undefined)];
}
