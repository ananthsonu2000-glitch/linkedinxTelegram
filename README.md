# LinkedIn Voice Bot

Telegram -> Gemini -> Telegram. Send a rough note, get back exactly one
LinkedIn post written in your voice (`voice_skill.md`).

## Setup

```bash
npm install
```

Credentials already live in `.env` (bot token + Gemini key). `.env.example`
shows the format if you ever need to recreate it.

## Run

```bash
npm start
```

Leave it running (`Ctrl+C` to stop). Message your bot `@Linkedin_27bot` on
Telegram with any rough note, bullet points, or a messy brain dump — you'll
get exactly one finished post back, nothing else.

## Lock it to just you (recommended)

Right now anyone who finds `@Linkedin_27bot` can use it and burn your Gemini
quota. To restrict it:

1. Run the bot, send it `/whoami` from your Telegram account.
2. It replies with your numeric user id.
3. Put that id in `.env` as `ALLOWED_USER_ID=...`.
4. Restart the bot.

## Editing your voice

Edit `voice_skill.md` any time — it's reloaded fresh on every message, no
restart needed.

## Files

- `bot.js` — the whole bot (polling, Gemini call, Telegram reply)
- `voice_skill.md` — your voice/persona blueprint, extracted from your Word doc
- `.env` — your real secrets (not shared/committed anywhere)
- `.env.example` — template showing what `.env` needs
