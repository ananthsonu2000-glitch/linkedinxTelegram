# LinkedIn Voice Bot

Telegram -> Gemini -> Telegram. Send a rough note or idea. The bot rates it,
and if it clears the bar, writes exactly one LinkedIn post in your voice
(`voice_skill.md`) — optionally sharpened with a genuinely relevant, current
news headline.

## How a message is handled

1. **Rate** — Gemini scores the thought on four dimensions (specificity,
   professionalism, genuineness, hook potential) plus an overall 1-10
   rating, and extracts 2-3 topic keywords (`src/gemini.js:rateThought`).
2. **Branch** on the overall rating vs. `RATING_THRESHOLD` (default `8`):
   - **Below threshold** — you get the rating, sub-scores, and reasoning
     back. Nothing else runs.
   - **At/above threshold** — the bot fetches Google News RSS results for
     the extracted topics (`src/news.js`), then runs a relevance filter
     (`src/gemini.js:filterRelevantNews`) that discards anything that only
     matched on keywords but isn't actually on-topic.
3. **Write** — Gemini drafts the post from your voice + the thought +
   (optionally) one surviving news headline (`src/gemini.js:generatePost`).
   You get the finished post, and, if a headline was used, a second message
   naming it.

## Setup

```bash
npm install
```

Credentials already live in `.env` (bot token + Gemini key + rating
threshold). `.env.example` shows the format if you ever need to recreate it.

## Run

```bash
npm start
```

Leave it running (`Ctrl+C` to stop). Message your bot `@Linkedin_27bot` on
Telegram with any rough note, bullet points, or a messy brain dump.

## Lock it to just you (recommended, already set up)

`.env` already has `ALLOWED_USER_ID` set so only you can use the bot. To
re-derive it: run the bot, send it `/whoami` from Telegram, and it replies
with your numeric user id.

## Tuning

- `RATING_THRESHOLD` in `.env` — raise it to be pickier about which thoughts
  become posts, lower it to let more through.
- `GEMINI_MODEL` in `.env` — if you hit persistent `503`/overload errors on
  one model, try another (`gemini-3.5-flash`, `gemini-3.1-flash-lite`, etc.).
  The Gemini free tier is rate-limited (a handful of requests/minute); the
  bot automatically waits out Gemini's requested retry delay on `429`s
  rather than failing.

## Editing your voice

Edit `voice_skill.md` any time — it's reloaded fresh on every message, no
restart needed.

## Files

- `bot.js` — orchestrator: Telegram polling, the rate → branch → news →
  write flow, sending replies
- `src/gemini.js` — `rateThought`, `filterRelevantNews`, `generatePost`
- `src/news.js` — Google News RSS fetch/parse/dedupe
- `src/telegram.js` — `sendMessage` (with chunking) and long-polling
- `voice_skill.md` — your voice/persona blueprint, extracted from your Word doc
- `.env` — your real secrets (not shared/committed anywhere)
- `.env.example` — template showing what `.env` needs
