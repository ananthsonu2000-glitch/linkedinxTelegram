/**
 * Telegram -> Gemini -> Telegram automation for LinkedIn post writing.
 *
 * Send a rough note/idea to the bot. It's rated 1-10 (specificity,
 * professionalism, genuineness, hook potential -> overall). Below
 * RATING_THRESHOLD, you get the score + reasoning back and nothing else.
 * At/above threshold, it pulls relevant Google News headlines for the
 * idea's topic, filters out anything off-topic, and writes exactly one
 * LinkedIn post in your voice (voice_skill.md) -- optionally using one
 * surviving headline as a hook.
 *
 * Run:
 *   node bot.js
 */

require('dotenv').config();
const { rateThought, filterRelevantNews, generatePost } = require('./src/gemini');
const { fetchGoogleNews } = require('./src/news');
const { sendMessage, pollUpdates } = require('./src/telegram');

const ALLOWED_USER_ID = (process.env.ALLOWED_USER_ID || '').trim();
const RATING_THRESHOLD = Number(process.env.RATING_THRESHOLD || 8);

function formatRatingReply(rating) {
  return [
    `Rating: ${rating.overall}/10 (below ${RATING_THRESHOLD} -- no post generated)`,
    '',
    `Specificity: ${rating.specificity}/10`,
    `Professionalism: ${rating.professionalism}/10`,
    `Genuineness: ${rating.genuineness}/10`,
    `Hook potential: ${rating.hookPotential}/10`,
    '',
    rating.reasoning,
  ].join('\n');
}

async function handleThought(chatId, text) {
  console.log(`Received note (${text.length} chars), rating...`);
  const rating = await rateThought(text);
  console.log(`Rating: ${rating.overall}/10`);

  if (rating.overall < RATING_THRESHOLD) {
    await sendMessage(chatId, formatRatingReply(rating));
    return;
  }

  console.log(`Above threshold. Fetching news for: ${rating.keywords.join(', ')}`);
  const headlines = await fetchGoogleNews(rating.keywords);
  const relevant = await filterRelevantNews(text, headlines);
  console.log(`${headlines.length} headlines found, ${relevant.length} passed the relevance filter.`);

  const { post, usedHeadlines } = await generatePost(text, relevant);
  await sendMessage(chatId, post);
  console.log('Post sent.');

  if (usedHeadlines.length > 0) {
    const used = relevant.filter((h) => usedHeadlines.includes(h.title));
    if (used.length > 0) {
      const lines = used.map((h) => `${h.title}${h.link ? ` -- ${h.link}` : ''}`);
      await sendMessage(chatId, `Sourced from:\n${lines.join('\n')}`);
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

  try {
    await handleThought(chatId, text);
  } catch (err) {
    console.error('Error handling thought:', err.message);
    try {
      await sendMessage(chatId, `⚠️ Failed: ${err.message}`);
    } catch {
      // ignore secondary failure
    }
  }
}

async function main() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.GEMINI_API_KEY) {
    console.error('Set TELEGRAM_BOT_TOKEN and GEMINI_API_KEY in .env (see .env.example).');
    process.exit(1);
  }

  console.log(`Bot starting. Rating threshold: ${RATING_THRESHOLD}/10`);
  if (ALLOWED_USER_ID) {
    console.log(`Restricted to user_id=${ALLOWED_USER_ID}`);
  } else {
    console.log('WARNING: ALLOWED_USER_ID is not set - anyone who messages this bot can use it.');
  }

  await pollUpdates(handleUpdate);
}

main();
