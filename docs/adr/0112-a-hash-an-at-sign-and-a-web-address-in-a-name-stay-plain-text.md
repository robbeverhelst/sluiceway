# A #, an @ and a web address in a name stay plain text

> Amends 0027 (what "HTML escaped" writes for a name: two more rules, measured on GitHub). Built as slice 5.49, from issue 271.

Record 0027 says types, names and property names are escaped, because they come from the user's code and are never trusted as markup, and `src/render/escape.ts` has written `&<>"` and the Markdown characters as character references since slice 1.6. Whether GitHub still links a `#123`, an `@name` or a web address after that was left to the live pass (`docs/later.md`). The release verification of the examples repo answered it on 2026-09-25, against 0.41.0 and before that 0.26.1: a resource named `#1 @sluiceway www.example.com *x*` became a link to issue 1 and a mention on the dashboard, and on the preview page the web address became a link as well. `*x*` stayed plain. A name with the login of a real person would notify that person from a public repo's dashboard, and a stack id with `#123` links an unrelated issue. On a row's first line it does more: record 0009 keeps bare issue references off that line because GitHub ticks a task that references an issue when that issue closes.

## What GitHub does (measured 2026-09-25)

Measured with `POST /markdown`, mode `gfm`, in the context of a repo whose issue 1 exists, and checked again on a real issue body read back as `application/vnd.github.html+json`. The two agree, and the preview page is rendered the way `POST /markdown` renders. Every case was tried in the three places a name sits: the Markdown of a row's first line, the open lines under it, and the HTML block of the fold.

- **Issue references and mentions are found after the character references are decoded**, in every text node of the rendered HTML, in the fold too. `&#35;1` is linked to issue 1, `&#64;sluiceway` is a mention, and `GH&#45;1` is linked like `#1`. Text inside `<code>` is left alone.
- **A web address is found in the Markdown source, before decoding.** `www&#46;example.com` and `https&#58;//example.com` stay plain, and `ftp&#58;//` too. Inside the HTML block of the fold no web address is linked at all, written plainly or not. `example.com` with no `www.` and no scheme is never linked.
- **An e-mail address is found after decoding**, so `a&#64;b.com` still becomes a `mailto:` link in Markdown.
- **An element splits a token.** `<span>#</span>1`, `<span>@</span>sluiceway`, `a<span>@</span>b.com` and `GH<span>-</span>1` are none of them linked, in Markdown, in the fold, in `<code>`, in a heading, in a link's text and in a table cell. GitHub keeps `<span>` with no attributes.
- **An invisible character splits a token too**: a zero-width joiner or a word joiner after `#` or `@`. But a word joiner after `www.` does not stop the address, and whatever is invisible stays in the text: a name copied from the page, or searched for with the browser, is no longer the name.

## Decision

`escapeText` writes, in one pass so nothing it writes is escaped again:

- `&`, `<`, `>` and `"` as named references, and `*`, `_`, `` ` ``, `~`, `[`, `]`, `|` and `\` as numeric ones, as before.
- **`#` and `@` inside a span**: `<span>#</span>`, `<span>@</span>`. Every one, wherever it sits, since GitHub links `owner/repo#1`, `#1` and `@name` and a span around one that would not be linked costs nothing but characters. The same span stops an e-mail address.
- **The `-` of `GH-` before a digit inside a span**, in any case: `GH<span>-</span>1`. A `gh-` before anything else is written as it is.
- **The dot of `www.` as `&#46;`** and **the colon of `://` as `&#58;`**, in any case, keeping the case of the letters. That is enough for any scheme, and cheaper than a span.

A name then reads, copies and is found by the browser's search exactly as the tool wrote it. The row marker is untouched: it holds the id percent-encoded in a comment, which GitHub never shows (0009).

## Considered

- **Character references for `#` and `@`**, the issue's first thought and the rule for every other character. Measured not to work: GitHub decodes them before it links.
- **A zero-width joiner after `#` and `@`**, the issue's suggestion. It works, but it changes the name a person copies or searches for, and it does not stop a `www.` address, which would need a second rule anyway.
- **Every name in a code span.** Nothing is linked in `<code>`, but a name in bold would lose its look, every row would change, and `<code>` is already the type's place on a change line.
- **Splitting only a `#` before a digit and an `@` before a letter.** It saves a few characters on names that are rare, at the cost of following GitHub's exact rule for what it links, which GitHub does not publish.

## Consequences

- Everything `escapeText` escapes follows: stack ids, names, types, property paths, a policy's message, a merge title, a ticker, a failure reason, and the job log lines a `resolve` summary repeats. So a Renovate title such as `Update dependency @pulumi/aws` no longer mentions the `pulumi` organisation on the dashboard, and `@v0` in the check's summary no longer mentions an account named `v0`. The cost: the lines the `resolve` summary repeats from the job log carry a run's web address and a dashboard's `#<n>` as plain text. The summary's own line under them still links the scan.
- `escapeText` output never goes in a Markdown code span, which shows references and spans as typed. The one place that did, the files no stack claims in the pull request preview's summary, uses `<code>`. A path with `_` showed as `&#95;` there before.
- A name grows by 13 characters per `#`, `@` or `GH-` and by 4 per `www.` or `://`. Such names are rare, and the size budget (0028) counts what is written.
- A commit id of the repo inside a name, seven hex characters or more, is still linked to the commit, and an emoji code such as `:key:` still becomes the emoji. Both are on `docs/later.md`.
- A test holds each rule to the literal it writes, and the row and preview page tests hold the verification's name to plain text on every line: no text node, decoded as GitHub decodes it, holds `#` before a digit or `@` before a word character, and the Markdown holds no `www.` or `://`.
