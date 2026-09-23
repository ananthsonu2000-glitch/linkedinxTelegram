/**
 * Telegram -> Gemini -> Telegram automation for LinkedIn post writing.
 *
 * Send a rough note/idea to the bot; it comes back as exactly one LinkedIn
 * post written in your voice (voice_skill.md), with nothing else attached.
 *
 * Run:
 *   node bot.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const ALLOWED_USER_ID = (process.env.ALLOWED_USER_ID || '').trim();

const VOICE_SKILL_PATH = path.join(__dirname, 'voice_skill.md');
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const RULES = `You are a LinkedIn ghostwriter. You write in the voice defined below.

Hard rules, no exceptions:
- One input message = exactly ONE LinkedIn post. Never generate multiple options, hooks, ideas, drafts, or versions.
- Output ONLY the finished LinkedIn post text. No preamble, no "Here's your post:", no explanations, no notes, no markdown code fences, nothing before or after the post.
- Preserve the user's facts exactly. Never invent achievements, numbers, statistics, events, names, or stories that weren't given.
- The user's input may be messy, incomplete, conversational, or just bullet points. Turn it into a coherent post without adding facts that weren't there.
- Treat this message as a brand-new, independent post. Do not reference any earlier conversation.
- Follow the voice/writing skill below for tone, structure, storytelling, formatting, and vocabulary.
- Avoid generic AI/corporate LinkedIn language (e.g. "In today's fast-paced world", "I'm thrilled to announce", excessive emoji, hashtag spam) unless the voice skill itself calls for it.

VOICE / WRITING SKILL (source of truth for style):
---
{voice_skill}
---
`;

function loadVoiceSkill() {
  try {
    return fs.readFileSync(VOICE_SKILL_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

async function generatePost(userInput) {
  const voiceSkill = loadVoiceSkill();
  const systemPrompt = RULES.replace('{voice_skill}', voiceSkill || '(no voice skill file found)');

  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userInput }] }],
    generationConfig: { candidateCount: 1, temperature: 0.8 },
  };

  const resp = await fetch(GEMINI_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  const candidates = data.candidates || [];
  if (candidates.length === 0) {
    const reason = data.promptFeedback?.blockReason || 'unknown';
    throw new Error(`Gemini returned no candidates (reason: ${reason})`);
  }

  const parts = candidates[0].content?.parts || [];
  const text = parts.map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

async function sendMessage(chatId, text) {
  const chunks = [];
  while (text.length > 0) {
    if (text.length <= 4096) {
      chunks.push(text);
      break;
    }
    let splitAt = text.lastIndexOf('\n\n', 4096);
    if (splitAt === -1) splitAt = 4096;
    chunks.push(text.slice(0, splitAt));
    text = text.slice(splitAt).replace(/^\n+/, '');
  }

  for (const chunk of chunks) {
    const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
    });
    if (!resp.ok) {
      throw new Error(`Telegram sendMessage error ${resp.status}: ${await resp.text()}`);
    }
  }
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message || typeof message.text !== 'string') return;

  const chatId = message.chat.id;
  const userId = String(message.from?.id ?? '');
  const text = message.text.trim();

  if (text === '/whoami') {
    await sendMessage(chatId, `Your Telegram user id: ${userId}`);
    return;
  }

  if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) {
    console.log(`Ignoring message from unauthorized user_id=${userId}`);
    return;
  }

  if (text.startsWith('/') || !text) return;

  console.log(`Received note (${text.length} chars) from user_id=${userId}, generating post...`);
  try {
    const post = await generatePost(text);
    await sendMessage(chatId, post);
    console.log('Post sent.');
  } catch (err) {
    console.error('Error generating/sending post:', err.message);
    try {
      await sendMessage(chatId, `⚠️ Failed to generate post: ${err.message}`);
    } catch {
      // ignore secondary failure
    }
  }
}

async function main() {
  if (!TELEGRAM_BOT_TOKEN || !GEMINI_API_KEY) {
    console.error('Set TELEGRAM_BOT_TOKEN and GEMINI_API_KEY in .env (see .env.example).');
    process.exit(1);
  }

  console.log(`Bot starting. Voice skill file: ${VOICE_SKILL_PATH}`);
  if (ALLOWED_USER_ID) {
    console.log(`Restricted to user_id=${ALLOWED_USER_ID}`);
  } else {
    console.log('WARNING: ALLOWED_USER_ID is not set - anyone who messages this bot can use it.');
  }

  let offset;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const params = new URLSearchParams({ timeout: '30' });
      if (offset !== undefined) params.set('offset', String(offset));

      const resp = await fetch(`${TELEGRAM_API}/getUpdates?${params}`, {
        signal: AbortSignal.timeout(40000),
      });
      if (!resp.ok) throw new Error(`getUpdates error ${resp.status}: ${await resp.text()}`);

      const { result } = await resp.json();
      for (const update of result) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (err) {
      console.error('Error polling Telegram:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main();
