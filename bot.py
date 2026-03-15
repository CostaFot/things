#!/usr/bin/env python3
"""
Things Bot — Telegram bot that appends links/notes to a GitHub markdown file.
Send a URL or text to the bot → it updates THINGS.md in your GitHub repo.
"""

import os
import re
import json
import logging
import asyncio
from datetime import datetime
from urllib.parse import urlparse, parse_qs

import httpx
from telegram import Update
from telegram.ext import Application, MessageHandler, CommandHandler, filters, ContextTypes

# ── Config (set via environment variables) ────────────────────────────────────
TELEGRAM_TOKEN   = os.environ["TELEGRAM_TOKEN"]
GITHUB_TOKEN     = os.environ["GITHUB_TOKEN"]
GITHUB_REPO      = os.environ["GITHUB_REPO"]       # e.g. "CostaFot/things"
GITHUB_FILE_PATH = os.environ.get("GITHUB_FILE_PATH", "THINGS.md")
ALLOWED_USER_ID  = int(os.environ["ALLOWED_USER_ID"])  # your Telegram user ID
ANTHROPIC_KEY    = os.environ.get("ANTHROPIC_API_KEY", "")  # optional, for summaries

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── GitHub helpers ─────────────────────────────────────────────────────────────

GH_API = "https://api.github.com"
GH_HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

async def gh_get_file(client: httpx.AsyncClient) -> tuple[str, str]:
    """Returns (content, sha) of the markdown file."""
    url = f"{GH_API}/repos/{GITHUB_REPO}/contents/{GITHUB_FILE_PATH}"
    r = await client.get(url, headers=GH_HEADERS, timeout=10)
    r.raise_for_status()
    data = r.json()
    import base64
    content = base64.b64decode(data["content"]).decode("utf-8")
    return content, data["sha"]

async def gh_update_file(client: httpx.AsyncClient, content: str, sha: str, message: str):
    """Commits updated content back to GitHub."""
    import base64
    url = f"{GH_API}/repos/{GITHUB_REPO}/contents/{GITHUB_FILE_PATH}"
    payload = {
        "message": message,
        "content": base64.b64encode(content.encode("utf-8")).decode("utf-8"),
        "sha": sha,
    }
    r = await client.put(url, headers=GH_HEADERS, json=payload, timeout=10)
    r.raise_for_status()

# ── URL / title helpers ────────────────────────────────────────────────────────

def extract_youtube_id(url: str) -> str | None:
    parsed = urlparse(url)
    if "youtu.be" in parsed.netloc:
        return parsed.path.lstrip("/").split("?")[0]
    if "youtube.com" in parsed.netloc:
        qs = parse_qs(parsed.query)
        return qs.get("v", [None])[0]
    return None

async def get_youtube_title(client: httpx.AsyncClient, video_id: str) -> str:
    url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
    try:
        r = await client.get(url, timeout=5)
        return r.json().get("title", f"YouTube video ({video_id})")
    except Exception:
        return f"YouTube video ({video_id})"

async def get_page_title(client: httpx.AsyncClient, url: str) -> str:
    try:
        r = await client.get(url, timeout=5, follow_redirects=True,
                             headers={"User-Agent": "Mozilla/5.0 (Things Bot)"})
        text = r.text
        match = re.search(r"<title[^>]*>([^<]+)</title>", text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    except Exception:
        pass
    return urlparse(url).netloc or url

async def get_ai_summary(client: httpx.AsyncClient, title: str, url: str, user_comment: str) -> str:
    """Optional: ask Claude for a one-liner about the link."""
    if not ANTHROPIC_KEY:
        return ""
    try:
        payload = {
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 60,
            "messages": [{
                "role": "user",
                "content": (
                    f"Write a single short sentence (max 12 words) describing why this link is interesting "
                    f"for an Android developer. Title: '{title}'. URL: {url}. "
                    f"User note: '{user_comment or 'none'}'. "
                    f"Reply with ONLY the sentence, no quotes, no punctuation at end."
                )
            }]
        }
        r = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json=payload, timeout=10
        )
        return r.json()["content"][0]["text"].strip()
    except Exception:
        return ""

# ── Markdown builder ───────────────────────────────────────────────────────────

def today_heading() -> str:
    return datetime.now().strftime("## Things — %-d %B %Y")

def build_entry(title: str, url: str | None, comment: str, summary: str) -> str:
    note = comment or summary
    if url:
        line = f"- [{title}]({url})"
    else:
        line = f"- {title}"
    if note:
        line += f" — {note}"
    return line

def insert_entry(existing: str, entry: str) -> str:
    heading = today_heading()
    lines = existing.splitlines()

    # Find today's section
    for i, line in enumerate(lines):
        if line.strip() == heading:
            # Insert after heading, skip any blank lines
            insert_at = i + 1
            while insert_at < len(lines) and lines[insert_at].strip() == "":
                insert_at += 1
            lines.insert(insert_at, entry)
            return "\n".join(lines) + "\n"

    # Today's section doesn't exist — prepend it after the top-level header
    new_section = f"\n{heading}\n\n{entry}\n"
    for i, line in enumerate(lines):
        if line.startswith("# "):
            lines.insert(i + 1, new_section)
            return "\n".join(lines) + "\n"

    # No top-level header found — just prepend everything
    return f"# Things\n{new_section}" + existing

# ── Telegram handlers ──────────────────────────────────────────────────────────

def is_url(text: str) -> bool:
    return bool(re.match(r"https?://\S+", text.strip()))

def split_url_and_comment(text: str) -> tuple[str | None, str]:
    """Separate a URL from any trailing comment the user typed."""
    parts = text.strip().split(None, 1)
    if parts and is_url(parts[0]):
        return parts[0], (parts[1] if len(parts) > 1 else "")
    return None, text.strip()

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    if user.id != ALLOWED_USER_ID:
        await update.message.reply_text("Not authorised.")
        return

    text = update.message.text or update.message.caption or ""
    if not text:
        await update.message.reply_text("Send me a URL or a note.")
        return

    await update.message.reply_text("⏳ Saving...")

    url, comment = split_url_and_comment(text)

    try:
        async with httpx.AsyncClient() as client:
            # Resolve title
            if url:
                yt_id = extract_youtube_id(url)
                if yt_id:
                    title = await get_youtube_title(client, yt_id)
                else:
                    title = await get_page_title(client, url)
                summary = await get_ai_summary(client, title, url, comment)
            else:
                title = comment
                url = None
                summary = ""

            # Build the new entry line
            entry = build_entry(title, url, comment, summary)

            # Read → update → commit
            try:
                content, sha = await gh_get_file(client)
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 404:
                    # File doesn't exist yet — create it
                    content = "# Things\n"
                    sha = None
                else:
                    raise

            updated = insert_entry(content, entry)
            commit_msg = f"things: add {title[:60]}"

            if sha:
                await gh_update_file(client, updated, sha, commit_msg)
            else:
                # Create new file
                import base64
                r = await client.put(
                    f"{GH_API}/repos/{GITHUB_REPO}/contents/{GITHUB_FILE_PATH}",
                    headers=GH_HEADERS,
                    json={
                        "message": commit_msg,
                        "content": base64.b64encode(updated.encode()).decode(),
                    }
                )
                r.raise_for_status()

        await update.message.reply_text(f"✅ Added: *{title}*", parse_mode="Markdown")

    except Exception as e:
        log.exception("Failed to save entry")
        await update.message.reply_text(f"❌ Error: {e}")

async def handle_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != ALLOWED_USER_ID:
        return
    await update.message.reply_text(
        "👋 Things Bot ready.\n\n"
        "Send me:\n"
        "• A URL → I'll grab the title and save it\n"
        "• A URL + comment → saved with your note\n"
        "• Just text → saved as a plain note\n\n"
        "Everything goes into your THINGS.md on GitHub."
    )

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("start", handle_start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    log.info("Bot running...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
