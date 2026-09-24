import { describe, expect, test } from "bun:test";
import { masks, parseEnvFile, unmaskedReason } from "../../src/core/env-file.ts";

// Slice 5.35 (record 0100): the env file the `env-file` input names is read
// once for the tool's process. The format is strict, and what is refused is
// said by line number, never by quoting the line: a broken line may hold a
// secret.

function values(text: string): Record<string, string> {
  const parsed = parseEnvFile(text);
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.values;
}

function problem(text: string): string {
  const parsed = parseEnvFile(text);
  if (parsed.ok) throw new Error("expected a problem");
  return parsed.problem;
}

describe("a plain NAME=value line", () => {
  test("gives the value up to the end of the line", () => {
    expect(values("PULUMI_ACCESS_TOKEN=pul-0123456789\n")).toEqual({
      PULUMI_ACCESS_TOKEN: "pul-0123456789",
    });
  });
});

describe("what is skipped and what is loose", () => {
  test("comments and blank lines are skipped, a BOM too", () => {
    expect(values("\uFEFF# The stacks' credentials\n\n  # indented\nA=1\n")).toEqual({ A: "1" });
  });

  test("an export prefix and spaces around = are allowed, as a shell reads them", () => {
    expect(values("export CLOUD_TOKEN = tok_123\n  REGION=eu-west-1")).toEqual({
      CLOUD_TOKEN: "tok_123",
      REGION: "eu-west-1",
    });
  });

  test("an unquoted value runs to the end of the line, with the white space around it gone, and a # is part of it", () => {
    expect(values("PASSWORD=  hunter2#not-a-comment  \n")).toEqual({
      PASSWORD: "hunter2#not-a-comment",
    });
  });

  test("Windows line endings are read", () => {
    expect(values("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
  });

  test("an empty value is empty", () => {
    expect(values("A=\nB=''\nC=\"\"\n")).toEqual({ A: "", B: "", C: "" });
  });
});

describe("a quoted value", () => {
  test('in double quotes may span lines and knows \\n, \\" and \\\\', () => {
    expect(
      values('KEY="-----BEGIN KEY-----\nAAA\n-----END KEY-----"\nB="say \\"hi\\"\\\\\\n"\n'),
    ).toEqual({
      KEY: "-----BEGIN KEY-----\nAAA\n-----END KEY-----",
      B: 'say "hi"\\\n',
    });
  });

  test("in single quotes is taken as it is, across lines too", () => {
    expect(values("A='x \\n y\nz'\n")).toEqual({ A: "x \\n y\nz" });
  });

  test("keeps a # and an = inside the quotes", () => {
    expect(values("A=\"a=b#c\"\nB='d=e#f'\n")).toEqual({ A: "a=b#c", B: "d=e#f" });
  });
});

describe("what is refused, by line number and never by its text", () => {
  test("a line that is not NAME=value", () => {
    expect(problem("A=1\nthis is not a variable line with s3cret\n")).toBe(
      "Line 2 is not a NAME=value line, a comment or blank.",
    );
  });

  test("a name that is not a name", () => {
    expect(problem("1A=x\n")).toBe("Line 1 is not a NAME=value line, a comment or blank.");
    expect(problem("A-B=x\n")).toBe("Line 1 is not a NAME=value line, a comment or blank.");
  });

  test("a name set twice", () => {
    expect(problem("A=1\nB=2\nA=3\n")).toBe("Line 3 sets A, which line 1 already set.");
  });

  test("a quote that is never closed", () => {
    expect(problem('A="open\nB=2\n')).toBe("Line 1 opens a quote that is never closed.");
    expect(problem("A='open")).toBe("Line 1 opens a quote that is never closed.");
  });

  test("anything after a closing quote", () => {
    expect(problem('A="x" # comment\n')).toBe(
      "Line 1 has text after its closing quote. A comment goes on a line of its own.",
    );
    expect(problem("A='x'y\n")).toBe(
      "Line 1 has text after its closing quote. A comment goes on a line of its own.",
    );
  });

  test('an escape that is not \\n, \\" or \\\\ in double quotes', () => {
    expect(problem('A="\\t"\n')).toBe(
      'Line 1 holds an escape that is not \\n, \\" or \\\\ inside double quotes.',
    );
  });

  test("a name that starts with INPUT_, which the tool never gets (record 0013)", () => {
    expect(problem("INPUT_MODE=scan\n")).toBe(
      "Line 1 sets INPUT_MODE. A name that starts with INPUT_ never reaches the tool, so it is refused.",
    );
  });

  test("a secret reference, which a secret manager has to resolve first", () => {
    expect(problem("A=1\nTOKEN=op://ci/pulumi/token\n")).toBe(
      "Line 2 holds a secret reference (op://). Sluiceway resolves none: let your secret manager resolve the file first, or load its references the way the credentials page shows.",
    );
  });

  test("a problem never quotes the line", () => {
    for (const text of ["s3cret-line\n", 'A="s3cret\n', 'A="s3cret" s3cret\n']) {
      expect(problem(text)).not.toContain("s3cret");
    }
  });

  test("the values before a refused line are not given", () => {
    expect(parseEnvFile("A=1\n=\n")).toEqual({
      ok: false,
      problem: "Line 2 is not a NAME=value line, a comment or blank.",
    });
  });
});

// Every value is masked before anything else, each line of a multi-line
// value on its own, because the runner matches the log line by line. Not
// masked: an empty value, true and false, and a value of 1 to 3 characters,
// since a mask that short turns ordinary words and numbers everywhere in
// the log into stars (onboarding log, hurdle 11). A value of 4 characters
// or more is masked whatever it is: a short password is still a password.
describe("what is masked", () => {
  test("a value, and each line of it that is long enough", () => {
    expect(masks("pul-0123456789")).toEqual(["pul-0123456789"]);
    expect(masks("-----BEGIN KEY-----\nAAAA\nBB\n\n-----END KEY-----")).toEqual([
      "-----BEGIN KEY-----\nAAAA\nBB\n\n-----END KEY-----",
      "-----BEGIN KEY-----",
      "AAAA",
      "-----END KEY-----",
    ]);
  });

  test("a short password, a port and a region are masked all the same", () => {
    for (const value of ["hunter2", "8080", "eu-west", "prod", "12345678"]) {
      expect(masks(value)).toEqual([value]);
    }
  });

  test("not an empty value, true, false, or a value of 1 to 3 characters", () => {
    for (const value of ["", "true", "false", "1", "dev", "   "]) {
      expect(masks(value)).toEqual([]);
    }
  });

  test("says why a value is not masked", () => {
    expect(unmaskedReason("")).toBe("empty");
    expect(unmaskedReason("true")).toBe("true or false");
    expect(unmaskedReason("dev")).toBe("shorter than 4 characters");
    expect(unmaskedReason("prod")).toBeUndefined();
    expect(unmaskedReason("pul-0123456789")).toBeUndefined();
  });
});
