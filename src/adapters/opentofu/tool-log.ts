import { stripAnsi } from "../pulumi/tool-log.ts";

// The words of a command run with -json (OpenTofu docs, "Machine-Readable UI"):
// one JSON message per line. Kept for the job log (record 0022): the text of
// each message, and of a diagnostic its summary, detail and place. Left out:
// the outputs, which can be secrets (record 0021), and the plan's list of
// changes and the version line, which Sluiceway's own lines already give. The
// snippet of code a diagnostic quotes is left out too, because it can hold a
// value written in the code. A line that is no JSON message is kept as it is.
const LEFT_OUT = new Set(["outputs", "planned_change", "resource_drift", "version"]);

export function jsonLogWords(stdout: string): string {
  const words: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      words.push(line);
      continue;
    }
    if (typeof message !== "object" || message === null) continue;
    const { type, diagnostic } = message as { type?: unknown; diagnostic?: unknown };
    if (typeof type === "string" && LEFT_OUT.has(type)) continue;
    if (type === "diagnostic" && typeof diagnostic === "object" && diagnostic !== null) {
      words.push(...diagnosticWords(diagnostic as Diagnostic));
      continue;
    }
    const text = (message as { "@message"?: unknown })["@message"];
    if (typeof text === "string") words.push(text);
  }
  return stripAnsi(words.map((line) => `${line}\n`).join(""));
}

interface Diagnostic {
  severity?: unknown;
  summary?: unknown;
  detail?: unknown;
  address?: unknown;
  range?: { filename?: unknown; start?: { line?: unknown } };
}

function diagnosticWords(diagnostic: Diagnostic): string[] {
  const severity = diagnostic.severity === "warning" ? "Warning" : "Error";
  const where = [
    typeof diagnostic.range?.filename === "string" ? diagnostic.range.filename : undefined,
    typeof diagnostic.range?.start?.line === "number"
      ? `line ${diagnostic.range.start.line}`
      : undefined,
  ].filter((part) => part !== undefined);
  return [
    `${severity}: ${typeof diagnostic.summary === "string" ? diagnostic.summary : ""}`,
    ...(where.length > 0 ? [`  on ${where.join(", ")}`] : []),
    ...(typeof diagnostic.address === "string" ? [`  at ${diagnostic.address}`] : []),
    ...(typeof diagnostic.detail === "string" && diagnostic.detail !== ""
      ? diagnostic.detail.split("\n").map((line) => `  ${line}`)
      : []),
  ];
}
