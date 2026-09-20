# What can a GitHub issue body actually render?

Research for issue #3. Checked on 2026-09-20 against current GitHub docs, the published sanitizer allowlist, and a live test issue on this repo: [#16 "Render test (research, safe to delete)"](https://github.com/robbeverhelst/sluiceway/issues/16). The test body, the rendered HTML and the size probes are described under "Method".

## Answer

- **Animated SVG and GIF through `<img>`: works.** The `<img>` tag survives, the SVG bytes are served unchanged (SMIL and CSS `<style>` both intact), and the serving CSP allows inline styles but no scripts. Inline `<svg>`, `<style>`, `style=""` and `data:` URIs are stripped. Whether the animation visibly plays cannot be seen from markup; open #16 to confirm by eye.
- **`<picture>` with `prefers-color-scheme`: works.** Documented as supported, `<source media srcset>` survives sanitizing, and GitHub wraps it in a `<themed-picture>` element. `#gh-dark-mode-only` / `#gh-light-mode-only` URL fragments also pass through.
- **Images from the action's own repo at a pinned ref: works, and they are NOT proxied through Camo.** `raw.githubusercontent.com` and `github.com/<owner>/<repo>/raw/<ref>/...` URLs are left as is in the rendered HTML. They are served with `cache-control: max-age=300`, so a changed file behind the same URL can be stale for about 5 minutes. A pinned tag or SHA never changes, so the way to change the picture is to change the URL.
- **Alert blocks inside a task list item: does not work.** `> [!WARNING]` nested in a list item renders as a plain blockquote with the literal text `[!WARNING]`. Docs say "Alerts cannot be nested within other elements." An alert as a top level sibling right after the list works.
- **`<details>` nested under a task list item: works in markup.** The checkbox input, the `<details>` and a fenced diff inside it all render inside the same `<li>`. Clickability in the browser was not verified by me (needs a human click, see test below).
- **HTML comments as hidden markers: works, with one unverified detail.** Comments are stored in the raw body and removed only from rendered HTML. GitHub's task list code updates the Markdown source and saves the whole body, and Renovate's dashboard depends on comment markers surviving ticks. Unverified: whether a UI tick changes anything else in the body, such as line endings. Cheap test below.
- **Body size limit: the brief's "65,536 characters" is not what the API enforces today.** Measured on the update path: the limit is 262,144 UTF-8 bytes. Worse, REST `PATCH` with a larger body returns `200 OK`, echoes the oversized body, and silently keeps the old body. GraphQL `updateIssue` returns an error `Body is too long`. Issue creation and the web editor were not measured and are reported by others to reject above 65,536 characters, so keep 65,536 characters as the design budget.
- **Mermaid: works** in issues (client side iframe). **Badges: work** (proxied through Camo). **Tables: work**, but a checkbox inside a table cell does not (no task list in cells, `<input>` stripped). **Emoji shortcodes: work.** Also usable inline in a row: `<kbd>`, `<mark>`, `<sub>`, `<sup>`, `<div align>`, and `$\color{red}{...}$` math.

## Method

Primary sources:

- GitHub docs source (the `github/docs` repo, which is what docs.github.com renders): basic writing and formatting syntax, tasklists, attaching files, creating diagrams, anonymized URLs.
- `gjtorikian/html-pipeline` `SanitizationFilter`, the published allowlist that GitHub's pipeline is built on. GitHub's production config is not public and can differ, so every sanitizer claim below was also checked against the live render.
- GitHub changelog posts for `<picture>` and the theme fragments.
- A live test. One issue (#16) was created with a body exercising each feature. Its rendered HTML was fetched with `gh api repos/robbeverhelst/sluiceway/issues/16 -H "Accept: application/vnd.github.html+json" --jq .body_html`. The public issue page HTML was also fetched logged out, to check that the web UI uses the same image URLs as the API render. Image URLs were inspected with `curl -I`. Two tiny animated SVG fixtures live in `docs/research/assets/` on this branch and are referenced at commit `a0f2386`.

Limits of the method: rendered HTML cannot show whether an animation plays or whether a checkbox responds to a click. Those need a browser. Nothing here covers GitHub Mobile, email notifications, or GitHub Enterprise Server.

## Detail

### 1. Animated SVG and GIF via `<img>`

What the sanitizer keeps. The allowlist contains `img` (attributes `src`, `longdesc`, `loading`, `alt`, plus global ones such as `width`, `height`, `align`, `title`), `picture` and `source` (`srcset`, and `media` as a global attribute). It does not contain `svg`, `style`, `script`, `iframe`, `video`, `input`, and `style` is not an allowed attribute. `img src` is limited to `http`, `https` and relative URLs.
Source: https://github.com/gjtorikian/html-pipeline/blob/main/lib/html_pipeline/sanitization_filter.rb

Live render confirms it (test T12 in #16): a `<style>` block was escaped to text, an inline `<svg>` with `<animate>` was removed entirely, an `<img>` with a `data:` URI lost its `src`, `<span style="color:red">` lost its `style`, and `<div align="center">` kept `align`.

So the only way to get animation into an issue body is an external image file referenced by `<img>` or `![]()`.

SVG bytes are not rewritten. `curl` of the fixture at `raw.githubusercontent.com/robbeverhelst/sluiceway/<sha>/docs/research/assets/render-test-light.svg` returned bytes identical to the committed file, with:

```
content-type: image/svg+xml
cache-control: max-age=300
content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox
x-content-type-options: nosniff
```

`style-src 'unsafe-inline'` means the SVG's own `<style>` block (CSS keyframes) is permitted. `default-src 'none'` and `sandbox` block scripts, external fonts, external images and any fetch from inside the SVG. SMIL (`<animate>`) is markup, not script, so CSP does not affect it. Browsers also disable scripts and external loads for any SVG loaded through `<img>`, which is a browser rule rather than a GitHub rule. Consequence for the mascot: each SVG must be fully self contained (no web fonts, no linked images, no JS), animated with SMIL or CSS only.

Docs are silent on SVG animation. The docs list SVG as a supported image upload type (https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files) and use an `.svg` in the image example of the basic syntax page, but say nothing about animation. Secondary sources agree that SMIL and CSS animation play in READMEs and comments and that JS never does: https://prlens.dev/guides/animated-svg-in-github-comments and https://github.com/tomchen/animated-svg-clock. I could not watch it play; the fixtures in #16 have a SMIL circle on top and a CSS square below, so one look in a browser settles which technique works.

GIF. An external GIF was rewritten to a `camo.githubusercontent.com` URL and GitHub added a `data-animated-image` attribute, which is what drives its play/pause control for animated images. A 1.0 MB GIF came through Camo fine. Size limits: uploads through the editor cap at 10 MB for images and GIFs (attaching files doc above). For proxied external images, open source Camo defaults to a 5 MB `CAMO_LENGTH_LIMIT` (https://github.com/atmos/camo/blob/master/README.md), but GitHub's production value is not documented. SVGs from `raw.githubusercontent.com` do not go through Camo at all (next section), so the Camo limit does not apply to the mascot. Keep each SVG small anyway (tens of KB), since it loads on every view.

An SVG gets no play/pause control and loops forever if built that way. GitHub does not document honoring `prefers-reduced-motion` for SVGs; the SVG can do that itself with a CSS media query inside its `<style>`.

### 2. `<picture>` with `prefers-color-scheme`

Docs: "The `<picture>` HTML element is supported."
Source: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#the-picture-element

Changelog, 2022-05-19: "You can now specify whether to display images for light or dark themes in Markdown, using the HTML `<picture>` element in combination with the `prefers-color-scheme` media feature."
Source: https://github.blog/changelog/2022-05-19-specify-theme-context-for-images-in-markdown-beta/

Live render (T1): all three children survived with `media`, `srcset`, `src`, `alt` and `width` intact, and GitHub wrapped the block in `<themed-picture data-catalyst-inline="true">`. That wrapper is a GitHub custom element; it is how the choice follows the viewer's GitHub theme setting rather than only the OS setting. That purpose is my reading of the name and the changelog, not a documented statement.

The older mechanism also still passes through (T3): `![alt](url#gh-dark-mode-only)` and `#gh-light-mode-only` kept their fragments in the rendered `src`. Changelog 2021-11-24: https://github.blog/changelog/2021-11-24-specify-theme-context-for-images-in-markdown/. The current docs page no longer mentions the fragments, so prefer `<picture>`.

Write the `<picture>` block at top level with a blank line after it. In my first draft a Markdown image placed on the line directly after an HTML `<img>` line was swallowed into the HTML block and printed as literal text. Blank lines between HTML blocks and Markdown are required.

### 3. Serving from the action's own repo at a pinned tag, and caching

Not proxied. In both the API render and the logged out web page, these URL forms were left untouched, with no Camo rewrite:

- `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>`
- `https://github.com/<owner>/<repo>/raw/<ref>/<path>` (302 to the raw host)
- `https://github.com/<owner>/<repo>/blob/<ref>/<path>?raw=true` (302, then 302 to the raw host)

The page CSP on github.com allows `img-src` from `*.githubusercontent.com`, which is why no proxy is needed. External hosts (Wikimedia, shields.io) were rewritten to `camo.githubusercontent.com/<hmac>/<hex url>` with `data-canonical-src` holding the original.

Tracking: the viewer's browser talks to GitHub's own raw host, the same party that already serves the issue page. No third party sees the request and Sluiceway runs no server. This matches the "no backend, no tracking" goal. Camo exists to hide viewer details from third party image hosts (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls); it is simply not involved here.

Visibility: the images live in the public Sluiceway action repo, so they load for every viewer even when the consumer's repo is private. Images in a private repo would only load for viewers with read access (basic syntax doc, note under the relative links table).

Caching: the raw host answers with `cache-control: max-age=300` and sits behind a Varnish/Fastly cache (`via: 1.1 varnish`, `x-cache`). A file that changes behind a stable URL (a branch ref) can be stale for up to about 5 minutes in browser and CDN. A tag or SHA ref is immutable, so there is nothing to go stale. For Camo-proxied images the docs describe a cache, tell image owners to send `Cache-Control: no-cache` if an image must update, and give a manual `curl -X PURGE` on the Camo URL as a last resort (anonymized URLs doc, "An image that changed recently is not updating"). That only matters for badges.

Design rule that follows: never mutate an image behind a URL. One file per dashboard state and theme, for example `assets/mascot/<state>-<theme>.svg`, referenced at the same tag as the running action version. The renderer changes the header by emitting a different URL in the body, which is an ordinary body edit and takes effect immediately.

One thing to check when building: the tag in the URL must be one that exists for the running action. `@v1` is a moving major tag, so `raw.githubusercontent.com/.../v1/...` is a mutable ref with the 5 minute staleness. Prefer the exact release tag or the action's commit SHA, which the action can read from `GITHUB_ACTION_REF` or its own `package.json` version.

### 4. Alerts and `<details>` around task list items

Alert inside a list item (T6): rendered as

```html
<li class="task-list-item"><input type="checkbox" ...> <strong>infra/db:prod</strong> ...
<blockquote><p>[!WARNING]<br>Replaces 1 resource.</p></blockquote></li>
```

No `markdown-alert` class, literal `[!WARNING]` text. The docs state it: "Alerts cannot be nested within other elements."
Source: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts

Alert as a top level sibling after the list (T7): rendered correctly as `<div class="markdown-alert markdown-alert-caution">`. The cost is that it ends the list, so an alert per row splits the section into many one item lists with a big colored box between each. The same docs section also asks for one or two alerts per page and no consecutive alerts.

This contradicts the brief, section 6: "Use GitHub alert blocks (`> [!WARNING]`) on rows that contain `replace` or `delete`." That cannot be done per row inside the row.

Inline alternatives that do render inside a task list item (T8): `:warning:` emoji shortcodes (rendered as `<g-emoji>`), `<kbd>DELETE</kbd>`, `<mark>destroys 2</mark>`, bold text, and inline math color `$\color{red}{\textsf{replace}}$` (rendered client side by `<math-renderer>`; fragile, I would avoid it).

`<details>` under a task list item (T5): the brief's exact row format rendered as one `<li class="task-list-item">` containing the checkbox `<input>`, the row text, and the `<details>` with a highlighted `diff` block inside. The HTML comment marker between them was dropped from the HTML and caused no layout damage. Two notes:

- The blank lines needed around the fenced block make the list "loose", so every row in that list is wrapped in `<p>` and gets more vertical spacing. Rows without a diff in the same list get the looser spacing too. Dense rows and rows with `<details>` should be consistent within one list.
- In the API render every checkbox has `disabled=""`. The API renders without a viewer. In the web UI GitHub enables the boxes for viewers who may edit the issue. I did not verify the click, because that needs a browser session.

A task list inside a top level `<details>` (T11, the "In sync" section) also renders as a task list.

Checkbox in a table (T9): `- [ ]` in a cell stayed literal text and `<input type="checkbox">` was stripped. Rows with checkboxes must be list items, not table rows.

Also relevant: the docs page "About tasklists" now carries a retirement notice, but it is for "Tasklist blocks" (the ```` ```[tasklist] ```` beta), replaced by sub-issues. Plain Markdown `- [ ]` task lists remain documented on the same page as clickable checkboxes.
Source: https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/about-tasklists and https://github.blog/changelog/2025-02-18-github-issues-projects-february-18th-update/

### 5. HTML comments as hidden markers

Documented as the way to hide content: "You can tell GitHub to hide content from the rendered Markdown by placing the content in an HTML comment."
Source: https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#hiding-content-with-comments

Live: after creating #16, the raw body from the REST API still contained all four `<!-- sluiceway:... -->` markers byte for byte, and none appeared in the rendered HTML. Both placements work: on its own indented line under the row (brief format) and inline right after the checkbox (Renovate format).

What happens on a tick. GitHub's original task list implementation states that the frontend "handle[s] updating the Markdown source", that the source lives in a textarea next to the rendered list, and that persistence is a normal save of that source ("we use AJAX to submit a hidden form on update").
Source: https://github.com/github-archive/task_list#readme
The current web component only reports the `position` and `checked` state of the box and leaves the source update to the page: https://github.com/github/task-lists-element#readme
So a tick is a whole body save with one marker flipped, made as the ticking user. It is not a server side patch of one character, and there is no documented guarantee of what else is normalized.

Real world proof that comment markers survive: Renovate's Dependency Dashboard puts the marker inside the checkbox line and parses it back after the user ticks, with the regex ` - \[x\] <!-- ([a-zA-Z]+)-branch=([^\s]+) -->`.
Source: https://github.com/renovatebot/renovate/blob/main/lib/workers/repository/dependency-dashboard.ts

Docs are silent on: line endings and whitespace after a UI tick, and whether two people ticking at once can overwrite each other's tick (whole body saves suggest last write wins). Cheapest test, 2 minutes: #16 is left in a known state (stored body is 3,627 bytes, no CR characters, sha256 starts `7156f2afed9e0d36` for `gh api repos/robbeverhelst/sluiceway/issues/16 --jq .body`). Tick one box in the browser, fetch the body again, and diff. Expected: exactly one `[ ]` became `[x]`. If CRLF appears, the `resolve` diff and the "skip when unchanged" comparison must normalize line endings first.

### 6. Body size limit

The docs do not state a limit for issue bodies. I measured it on the update path of #16, reading the body back after every write, because the write response turned out to be misleading.

| Body sent | UTF-8 bytes | REST `PATCH` response | Body after read back |
| --- | --- | --- | --- |
| 65,537 x `a` | 65,537 | 200 | stored |
| 262,144 x `b` | 262,144 | 200 | stored |
| 262,145 x `c` | 262,145 | 200, echoes all 262,145 | NOT stored, previous body kept |
| 1,048,576 x `d` | 1,048,576 | 200, echoes all | NOT stored, previous body kept |
| 131,072 x `é` | 262,144 | 200 | stored |
| 131,073 x `è` | 262,146 | 200 | NOT stored |
| 65,536 x emoji | 262,144 | 200 | stored |
| 65,537 x emoji | 262,148 | 200 | NOT stored |

Findings:

- The enforced unit is UTF-8 bytes, limit 262,144 (256 KiB). 65,536 is that number divided by 4, the worst case bytes per character, which is where the familiar "65536 characters" figure comes from.
- REST `PATCH /repos/{owner}/{repo}/issues/{n}` over the limit returns `200 OK` with the oversized body echoed back and `updated_at` unchanged. Nothing is stored. Still unchanged 45 seconds later, so it is not a delay. Same result with API versions `2022-11-28` and `2026-03-10`.
- GraphQL `updateIssue` over the limit fails loudly: `{"type":"UNPROCESSABLE","message":"Body is too long"}`. At 65,537 ASCII characters it succeeds.
- My first probe trusted the response and "showed" a 1 MiB body being accepted. Only the read back exposed the silent drop. Anything in Sluiceway that checks success must not trust the response body.

Not measured: issue creation (`POST`), because I was limited to one test issue, and the web editor. A community maintained reference reports "Issue description: Max length 65536 codepoints", verified through the UI, and "Issue comments: 262144 bytes (65536-262144 characters depending on UTF8-encoded size)": https://github.com/dead-claudia/github-limits. Many bug reports quote the API error `body is too long (maximum is 65536 characters)`, for example https://github.com/renovatebot/renovate/issues/14551. So GitHub has, or had, a 65,536 character check on at least some paths. If the web UI still has it, a dashboard body above 65,536 characters could make a user's checkbox tick fail to save, which would break the core interaction. One day of probing on one issue does not rule that out.

Prior art: Renovate truncates every GitHub issue and PR body it writes to 58,000 characters (`GitHubMaxPrBodyLen = 58000`, applied through `smartTruncate`), which leaves headroom under 65,536.
Source: https://github.com/renovatebot/renovate/blob/main/lib/modules/platform/github/index.ts

### 7. Mermaid, badges, tables, emoji

- Mermaid: documented for issues ("Diagram rendering is available in GitHub Issues, GitHub Discussions, pull requests, wikis, and Markdown files"), https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams. Live (T10): rendered as a `<section data-type="mermaid">` that loads an iframe from `viewscreen.githubusercontent.com`. It is client side and shows a spinner first. Usable for a stack dependency graph (`dependsOn`), ideally inside a collapsed `<details>`. Not suitable for status at a glance.
- Badges: `![](https://img.shields.io/badge/pending-3-orange)` works and is proxied through Camo, so shields.io never sees the viewer. It is still a third party fetch by GitHub's proxy, and badge text is baked into the URL so there is no staleness. It conflicts with "no backend" in spirit only. Plain text counts are denser and deterministic; I would skip badges.
- Tables: render (wrapped in `<markdown-accessiblity-table>`), support inline code, links, emoji. No checkboxes in cells (see section 4). Good for the "Recently deployed" and "In sync" sections, not for actionable rows.
- Emoji shortcodes: documented, rendered as `<g-emoji>`. Note the raw body keeps the shortcode text, so deterministic rendering is unaffected.
- Footnotes, `<kbd>`, `<mark>`, `<sub>`, `<sup>`, `<ins>`, `<del>`, `<abbr>`, `<time>`, `<details open>`, `<div align="center">`, `<img width height align>` are all on the allowlist.
- Not available: colors or any CSS, `<iframe>`, `<video>` by URL (uploads only), `<input>`, `<button>`, `<progress>` (not on the allowlist), inline SVG.

## Consequences for the dashboard design

1. The mascot header is viable as specified. Use a top level `<picture>` with two `<source media="(prefers-color-scheme: ...)">` and an `<img>` fallback, pointing at `raw.githubusercontent.com/<sluiceway repo>/<exact tag or SHA>/assets/...`. One self contained SVG per state and theme, SMIL or CSS animation only, no fonts or external references, small files. Change state by changing the URL in the body, never the file behind a URL. Give the `<img>` a meaningful `alt` with the state in words, as the fallback wherever the image does not load (I did not test email or mobile). Before building all the art, open #16 in a browser in both themes to confirm the animation plays and which of SMIL or CSS to standardize on.
2. Do not reference the moving `v1` tag in image URLs. Use the exact release tag or commit SHA so the 5 minute raw cache can never show an old mascot.
3. Drop per row alert blocks. They do not render inside list items. Options: mark destructive rows inline with `:warning:` plus bold or `<kbd>REPLACE</kbd>` / `<kbd>DELETE</kbd>`, and put a single top level `> [!CAUTION]` summary above the pending section naming the stacks that destroy or replace resources. Optionally move destructive stacks into their own section with the alert as its header.
4. The row format from the brief works: checkbox line, indented comment marker, indented `<details>` with blank lines around the fenced diff. Keep rows in one list consistently "loose" or consistently "tight"; mixing changes spacing. The Renovate style inline marker (`- [ ] <!-- marker --> text`) is the more battle tested placement and keeps the marker on the same line as the box, which makes the `resolve` parser a single line regex.
5. Actionable rows must be list items. Tables cannot hold checkboxes. Use tables only for read only sections.
6. Size budget: keep the brief's 65,536 characters as the hard ceiling (safe on every path, including unmeasured ones), target something like Renovate's 58,000 for headroom, and additionally assert UTF-8 byte length is under 262,144. Count both in the renderer. After every body write through REST, verify the write: compare `updated_at` or read the body back, because an oversized `PATCH` returns 200 and stores nothing. Or write through GraphQL `updateIssue`, which errors properly.
7. `resolve` should treat the body as untrusted text that a full save by the user's browser produced. Normalize line endings before diffing `changes.body.from` against the current body and before the "skip the API call when unchanged" comparison, until the tick test on #16 shows that it is unnecessary.
8. Concurrent ticks are whole body saves, so last write can win. The brief's step "re-render selected rows as deploying with no checkbox" narrows the window but does not close it. A tick that gets overwritten is lost silently; the rescan checkbox is the recovery path. Worth a line in the docs.
9. Skip badges and math coloring. Mermaid is fine for an optional dependency graph inside `<details>`.

## Open items a human should close (about 5 minutes, all on #16)

- View #16 in light and dark theme: does the header swap, does the SMIL circle move, does the CSS square move.
- Tick one box in #16, then diff the raw body against the recorded state (section 5).
- Click the checkbox of the row that has a nested `<details>` to confirm it responds, and that opening the `<details>` does not toggle it.
- Optional: view #16 in GitHub Mobile and in the notification email to see what the header degrades to.
