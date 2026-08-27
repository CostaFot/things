---
name: things
description: Add an entry to Costa's things feed (things.costafotiadis.com) and publish it. Use when Costa sends /things, "add to things", "note this", "save this link", a bare URL with a comment from a Remote Control session, or asks to enrich or tag existing things entries. Triggers - things, /things, note this, save this, add this link, things enrich, things photo, things video.
---

# things

Take what Costa sent, write it to `entries/`, enrich it, build, commit, push,
confirm it is live. Read `AGENTS.md` in the repo first — the voice rule there
is the whole point.

| | |
|---|---|
| Repo | `/home/costa/Work/things` |
| Site | https://things.costafotiadis.com |
| Railway | project `things-bot` (`5335fc44-4a68-4f44-8668-61e72b879033`), service `things` (`fac0a982-4553-4d4b-950a-461292cfc42a`), env `b49eb826-41a2-4283-90b8-dafc3199f155`, volume `media` (`3c1321a2-555c-443e-882c-8cc077b9faea`, mounted at `/data`) |
| Tags | `tags.json` in the repo |

**Arguments.** Everything after `/things`:

| Input | Type |
|---|---|
| `<url> [comment]` (first token is a URL) | `link` |
| `idea …` / `idea: …` | `idea` |
| an attached image `[caption]`, or `photo <path> [caption]` | `photo` |
| an attached video `[caption]`, or `video <path> [caption]` | `video` |
| `enrich [N]` | enrich N un-enriched entries, default 5 |
| `tags` | print the tag vocabulary and stop |
| anything else | `note` |

Images attached from the Claude Code mobile app (Remote Control) arrive with
a file path in the message — `~/.claude/uploads/<session>/<id>-image.jpg`.
Use that path with `--file`; `capture.js` copies it into `images/<id>.jpg`.
A `/things` message whose only content is an image is a `photo` with an empty
caption; text alongside the image is the caption. Never write a photo entry
without a real file.

Videos work the same way with `--type video` (`.mp4`, `.webm` or `.mov`).
The file is *not* committed: `capture.js` transcodes it with ffmpeg to an
H.264 mp4 (phone HEVC does not play everywhere), extracts a poster frame,
writes both to `media/<id>.*` (gitignored) and uploads them to the Railway
volume `media` via `railway volume files upload` — this needs ffmpeg and the
Railway CLI logged in with an SSH key registered, which is the case on Costa's
laptop. A 5 s 1080p clip takes ~10 s. If the upload fails, no entry is
written; report the error, do not retry with `--no-upload`.

## Steps

1. **Clean tree.** `git status --porcelain` must
   be empty; if not, stop and say what is dirty. Then
   `git pull --rebase origin main`.

2. **Capture.** Pass Costa's text *exactly as sent* (after removing the
   `/things`, `idea`, `photo <path>` prefix):
   ```sh
   node scripts/capture.js --type link  --url "<url>" --text "<comment>"
   node scripts/capture.js --type idea  --text "<text>"
   node scripts/capture.js --type note  --text "<text>"
   node scripts/capture.js --type photo --file "<path>" --text "<caption>"
   node scripts/capture.js --type video --file "<path>" --text "<caption>"
   ```
   It prints the file path and the entry. Title and preview are fetched for
   links; if the title came back as just the hostname, fetch it yourself
   (`WebFetch`) and set it.

3. **Enrich** by editing that JSON file:
   - `text`: apply the voice rule. Spelling and typos, trim rambling, drop
     nonsense. Keep his wording, tone, lowercase, slang. Never add opinion or
     information. If you changed anything, put the original in `text_raw`.
   - `tags`: 1–3 from `tags.json`. A new tag only when nothing fits, and add
     it to `tags.json` in the same commit.
   - `claude.summary`: for links, 1–2 factual third-person sentences about
     the page or video (what it is, not why it is interesting). For ideas and
     notes, only when a sentence of context genuinely helps — otherwise omit
     the whole `claude` block. Include `"model"` and `"at"` (local ISO with
     offset).

4. **Build.** `node src/build.js` must exit 0. If it fails, fix the entry, not
   the validator.

5. **Commit and push.**
   ```sh
   git add entries images tags.json
   git commit -m "things: add <type> <text or title, first 60 chars>"
   git push origin main   # on rejection: git pull --rebase origin main && git push origin main
   ```
   The `/things` message is the authorisation to push this entry. No
   Co-Authored-By. Never amend. Never `git add -A`.

6. **Confirm.** Poll `curl -s https://things.costafotiadis.com/things.json | jq -r '.[0].id'`
   every 15 s for up to 3 min until it returns the new id. On timeout use
   `mcp__railway__list-deployments` / `get-logs` and report what failed.
   For a video also check `curl -sI https://things.costafotiadis.com/<video path>`
   returns `200` with `Accept-Ranges: bytes`.

7. **Reply** in phone length: the link `https://things.costafotiadis.com/#<id>`,
   the tags, and the `text_raw → text` diff if there was one. Nothing else.

## `enrich` mode

Pick the N oldest entries without `tags` (`grep -L '"tags"' entries/*.json`),
apply step 3 to each — for migrated entries the voice rule applies to `text`
the same way — then steps 4–7 with the commit message
`things: enrich N entries`. List the ids in the reply.

## Gotchas

- `date` must carry an offset (`+01:00`), never `Z`; `capture.js` does this.
- `site/` and `media/` are never committed (`media/` is only a local mirror of
  the volume; the volume is what the site serves).
- `index.md` no longer exists; do not recreate it.
- x.com and instagram give no useful title or og:image without a login; keep
  whatever `capture.js` got and move on.
- A URL Costa pastes with tracking junk (`?si=`, `utm_`) is kept as sent — it
  is his link.
