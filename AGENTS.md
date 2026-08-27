# things — agent guide

This repo is Costa's "things" feed: links, ideas, notes, photos and videos,
one JSON file per entry, rendered as a static site at
https://things.costafotiadis.com. Git is the database — except video files,
which live on a Railway volume (see below). **Every push to `main` deploys** (Railway project
`things-bot`, service `things`, generated domain
things-production-f67b.up.railway.app).

Capture happens through the `/things` skill in `skill/SKILL.md` — usually from
Costa's phone over a Claude Code Remote Control session. Claude is the only
writer; the old Telegram bot is retired.

## The voice rule (non-negotiable)

Costa's words are **tidied, not rewritten.**

- Allowed on `text`: fix spelling, fix obvious typos, trim rambling, drop a
  fragment that is plainly nonsense (a stray word, a half-sentence that goes
  nowhere).
- Keep his wording, his tone, his slang, his punctuation habits, his
  lowercase. Keep the spirit of what he said. If in doubt, leave it.
- Never add opinion, facts, adjectives, or "context" *into* `text`.
- If `text` differs from what he typed, store the original verbatim in
  `text_raw` and show the diff in the reply.

Everything Claude contributes lives in the separate `claude` block (and
`title`, `preview`, `tags`) and the site renders it visibly apart from his
text, labelled as Claude's. Add it only when it is actually useful; a bare idea
usually needs tags and nothing else.

`claude.summary` = one or two plain, factual, third-person sentences about the
*thing* (the linked page, the video, the subject of the idea). Not about Costa,
not about why it is interesting, no "interesting", "great", "fascinating".

## Entry format — `entries/<id>.json`

```json
{
  "schema": 1,
  "id": "20260817_112946",
  "date": "2026-08-17T12:29:46+01:00",
  "type": "link",
  "source": "claude",
  "text": "berry cool",
  "text_raw": "bery cool",
  "url": "https://youtu.be/D2eLCE2-64I",
  "title": "DEMOCRAWLER // Stellar Blade OST by original singer Pernelle.",
  "preview": { "src": "images/previews/20260817_112946.jpg", "origin": "https://i.ytimg.com/vi/D2eLCE2-64I/hqdefault.jpg" },
  "tags": ["video"],
  "claude": { "summary": "…", "model": "claude-fable-5", "at": "2026-08-17T12:30:10+01:00" }
}
```

- `id` — UTC `YYYYMMDD_HHMMSS`, equals the filename. Photos: equals the image
  basename.
- `date` — local wall-clock time **with offset** (`+01:00`), never `Z`. The
  site groups by the date part of this string.
- `type` — `idea` | `note` | `link` | `photo` | `video`. A YouTube link is a
  `link`; the build derives the thumbnail and icon from the URL. `video` is a
  file Costa recorded, not a link to one.
- `source` — `claude`, or `telegram` on entries migrated from the old bot
  (those also carry `"migrated": true`).
- `text` — required; may be `""` for a caption-less photo or a link sent with no comment.
- `url` + `title` — required for `link`. `image` (repo path) — required for
  `photo`. `video` — required for `video`: `media/<id>.<mp4|webm|mov>`, a path
  on the Railway volume, **not** in the repo. `preview` — optional, links
  only, `src` is a repo path.
- `tags` — every tag must exist in `tags.json`. A new tag is allowed only
  when none fit, and it goes into `tags.json` in the same commit.

`node src/validate.js` enforces all of this and `node src/build.js` runs it
first, so a bad entry fails the deploy instead of rendering wrong.

## Rules of the repo

- Never commit `site/` (build output; gitignored).
- Never rewrite the `text` of an existing entry. The only exception is
  applying the voice rule to a migrated entry during `/things enrich`.
- Commit messages: `things: add <type> <text[:60]>`, `things: enrich <n>
  entries`, `things: <what>` for everything else. No Co-Authored-By. Never
  amend.
- The `/things` invocation is the authorisation to commit and push that entry.
  Do not push anything else that happens to be dirty — the skill checks
  `git status --porcelain` is clean before it starts.
- Images: photos attached from the mobile app land in
  `~/.claude/uploads/<session>/` and the path is given in the message;
  `capture.js --file` copies them to `images/<id>.<ext>`. Link previews are
  downloaded into `images/previews/<id>.<ext>` (max 1 MB, else skip). Do not
  hotlink.
- Videos: too big for git. `capture.js --type video --file` copies the file
  to `media/<id>.<ext>` (gitignored local mirror) and uploads it to the
  Railway volume `media` (mounted at `/data` on the `things` service) with
  `railway volume files upload`; `server.js` serves `/data/media/*` as
  `/media/*` with Range support. The upload needs the Railway CLI logged in
  with an SSH key registered (`railway ssh keys add`). The volume is the only
  copy that matters — `git revert` of a video entry does not delete the file;
  `railway volume files delete` does, and the CLI refuses that from an agent,
  so ask Costa to run it. A service with a volume has a
  few seconds of downtime per deploy; that is accepted.
- Zero dependencies. `package.json` has none on purpose; use Node built-ins
  (`fetch`, `fs`, `path`, `crypto`).

## Layout

```
entries/            one JSON per entry
images/             photos; images/previews/ for link previews
media/              gitignored local mirror of the Railway volume (videos)
tags.json           tag vocabulary (name → one-line meaning)
src/build.js        entries → site/ (index.html, things.json, feed.xml)
src/validate.js     schema checks, used by build and the skill
src/fetch-meta.js   title + og:image fetcher (capture + migrate)
src/template.html   page shell; src/style.css
scripts/capture.js  CLI used by the skill to write a new entry
scripts/migrate-index.js   one-off migration from the old index.md (kept for history)
skill/SKILL.md      the /things skill (symlinked from ~/.claude/skills/things)
server.js           static server for site/ + /media/ from the volume (Railway start command)
```
