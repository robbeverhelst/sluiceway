// Reads what `kubectl diff` prints with the diff program of the preview
// (record 0060): for every object that differs, one file pair, `---` and `+++`
// and one hunk that holds the whole object on both sides. kubectl writes each
// object to a file of its own in two directories, LIVE and MERGED, and a side
// that has no object is an empty file. Nothing here looks at what a line
// says: a hunk is read by its counts, so a line of YAML can never be taken
// for a header.

export interface ObjectPair {
  // The object as it is in the cluster, and as it would be after the deploy,
  // as YAML. An empty text is no object.
  live: string;
  merged: string;
}

export type ReadDiff =
  | { ok: true; pairs: ObjectPair[] }
  // Each problem names a place and what was expected there, never what was
  // found: the output holds values (record 0021).
  | { ok: false; problems: string[] };

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function readDiff(stdout: string): ReadDiff {
  const lines = stdout.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const pairs: ObjectPair[] = [];
  const problem = (at: number, expected: string): ReadDiff => ({
    ok: false,
    problems: [`The tool's output, at line ${at + 1}: expected ${expected}.`],
  });

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    // The line that names the diff program and the two files.
    if (line.startsWith("diff ")) {
      index++;
      continue;
    }
    if (!line.startsWith("--- ")) return problem(index, "the start of a file");
    if (!(lines[index + 1] ?? "").startsWith("+++ ")) return problem(index + 1, "a +++ line");
    const header = HUNK.exec(lines[index + 2] ?? "");
    if (header === null) return problem(index + 2, "a hunk");
    const liveStart = Number(header[1]);
    const liveCount = header[2] === undefined ? 1 : Number(header[2]);
    const mergedStart = Number(header[3]);
    const mergedCount = header[4] === undefined ? 1 : Number(header[4]);
    // The whole object: from its first line, or an empty side.
    if (liveStart !== (liveCount === 0 ? 0 : 1) || mergedStart !== (mergedCount === 0 ? 0 : 1)) {
      return problem(index + 2, "a hunk that holds the whole object");
    }
    index += 3;
    const live: string[] = [];
    const merged: string[] = [];
    let liveLeft = liveCount;
    let mergedLeft = mergedCount;
    while (liveLeft > 0 || mergedLeft > 0) {
      if (index >= lines.length) return problem(index, "more lines of the hunk");
      const hunkLine = lines[index] ?? "";
      const text = hunkLine.slice(1);
      if (hunkLine.startsWith(" ") && liveLeft > 0 && mergedLeft > 0) {
        live.push(text);
        merged.push(text);
        liveLeft--;
        mergedLeft--;
      } else if (hunkLine.startsWith("-") && liveLeft > 0) {
        live.push(text);
        liveLeft--;
      } else if (hunkLine.startsWith("+") && mergedLeft > 0) {
        merged.push(text);
        mergedLeft--;
      } else if (!hunkLine.startsWith("\\")) {
        return problem(index, "a line of the hunk");
      }
      index++;
    }
    // "\ No newline at end of file" after the last line.
    while ((lines[index] ?? "").startsWith("\\")) index++;
    if (HUNK.test(lines[index] ?? "")) return problem(index, "one hunk per object");
    pairs.push({ live: joined(live), merged: joined(merged) });
  }
  return { ok: true, pairs };
}

function joined(lines: string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}
