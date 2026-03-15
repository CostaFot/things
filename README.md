# Things Bot

Telegram bot that appends links and notes to a `THINGS.md` file in a GitHub repo.

Send it a URL → it fetches the title, optionally generates a one-liner summary via Claude, and commits a new entry under today's date section.

## What it produces

```markdown
# Things

## Things — 16 March 2026

- [Why Kotlin context receivers are good now](https://...) — worth reading if you dismissed these early
- [Some YouTube Video Title](https://youtu.be/xxx)

## Things — 9 March 2026

- [Article title](https://...) — your comment here
- Just a plain note with no URL
```

## Setup

### 1. Create a Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the token it gives you

### 2. Get your Telegram user ID

Message [@userinfobot](https://t.me/userinfobot) — it replies with your numeric user ID.

### 3. Create a GitHub token

1. Go to https://github.com/settings/tokens
2. Generate a new token (classic) with `repo` scope
3. Copy it

### 4. Create the GitHub repo

Create a new public or private repo at github.com (e.g. `CostaFot/things`).
The bot will create `THINGS.md` automatically on first use.

### 5. Configure environment variables

```bash
cp .env.example .env
# Edit .env with your values
```

### 6. Run locally

```bash
pip install -r requirements.txt

# Load env vars
export $(cat .env | grep -v '#' | xargs)

python bot.py
```

### 7. Deploy (Railway — recommended, free tier)

1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add all environment variables from `.env.example` in the Railway dashboard
4. Deploy — Railway runs it 24/7 for free on the hobby tier

Alternatively, any VPS (Hetzner €4/mo, DigitalOcean $6/mo) works fine with Docker:

```bash
docker build -t things-bot .
docker run -d --env-file .env --restart unless-stopped things-bot
```

## Usage

| You send | Bot does |
|---|---|
| `https://youtube.com/watch?v=xxx` | Fetches YouTube title, commits entry |
| `https://some-article.com` | Fetches page title, commits entry |
| `https://some-article.com great read` | Saves with your comment as the note |
| `reminder to look into Flow operators` | Saves as plain text note, no URL |

## Optional: AI summaries

Set `ANTHROPIC_API_KEY` in your `.env` to enable automatic one-liner summaries via Claude.
If the key is blank, entries are saved with just the title (and your comment if you added one).
