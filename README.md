# things

Links, ideas, notes and photos I send myself, rendered at
[things.costafotiadis.com](https://things.costafotiadis.com). One JSON file per
entry in `entries/`, a static site built from them, hosted on Railway. Every
push to `main` deploys.

The story of v1 (the Telegram bot) is in
[this post](https://www.costafotiadis.com/things/). The bot is retired.

## How entries get in

Through Claude Code. I open a Remote Control session from my phone and type
`/things https://some.link my comment`, `/things idea …`, or attach a photo with a caption. Claude fetches the
title and a preview, fixes my typos, tags it, sometimes adds a line of context,
commits and pushes. Railway rebuilds in about a minute.

My words stay my words. Anything the agent adds is stored separately and
rendered under a `claude` label. The exact rule is in [AGENTS.md](AGENTS.md).

## Formats

| type | what it is |
|---|---|
| `idea` | 💡 something I might build or write |
| `note` | 💬 a thought, a book, a milestone |
| `link` | 🔗 a URL with an optional comment; ▶️ if it's YouTube |
| `photo` | 🖼️ an image with an optional caption |

`/feed.xml` is an RSS feed. `/things.json` is every entry as JSON.

## Local run

```sh
node src/build.js   # entries/ -> site/
node server.js      # http://localhost:3000
```

No dependencies. Node 22 or newer.
