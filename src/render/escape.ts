// Types, names, property names and stack ids come from the user's code and the
// provider's schema, and are never trusted as markup (record 0027).

const NAMED: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

// GitHub links `#1` to an issue and `@name` to an account after it decoded the
// character references, so `&#35;` and `&#64;` are linked all the same. A span
// around the character splits the token for it, and the text still reads and
// copies as itself (record 0112).
const SPLIT = new Set(["#", "@"]);

// GitHub finds a web address in the Markdown source, before it decodes the
// references, so a reference for the dot of `www.` or the colon of `://` is
// enough. `GH-1` is an issue reference that is found after, like `#1`.
function escapeOne(match: string): string {
  const named = NAMED[match];
  if (named !== undefined) return named;
  if (SPLIT.has(match)) return `<span>${match}</span>`;
  if (match === "://") return "&#58;//";
  // `www.` and `gh-` in any case, keeping the case they were written in.
  if (match.toLowerCase() === "www.") return `${match.slice(0, 3)}&#46;`;
  if (match.toLowerCase() === "gh-") return `${match.slice(0, 2)}<span>-</span>`;
  return `&#${match.charCodeAt(0)};`;
}

// Makes text safe to place on any line of a row block. The same change line
// is Markdown outside the fold and an HTML block inside it, so the characters
// that Markdown acts on are written as character references: those are literal
// text in both. A control character becomes a space, so text from outside can
// never start a line of its own, and with it a row. One pass, so what it writes
// is never escaped again.
export function escapeText(text: string): string {
  return (
    text
      // Control characters, the line separator and the paragraph separator.
      .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
      .replace(/www\.|:\/\/|gh-(?=\d)|[&<>"*_`~[\]|\\#@]/gi, escapeOne)
  );
}
