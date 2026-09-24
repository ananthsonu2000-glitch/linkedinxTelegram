const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GEMINI_API = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const VOICE_SKILL_PATH = path.join(__dirname, '..', 'voice_skill.md');
const RETRYABLE_STATUS = new Set([429, 500, 503, 504]);

function loadVoiceSkill() {
  try {
    return fs.readFileSync(VOICE_SKILL_PATH, 'utf8').trim();
  } catch {
    return '';
  }
}

async function callGemini({ systemPrompt, userText, responseSchema, temperature = 0.7 }) {
  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      candidateCount: 1,
      temperature,
      ...(responseSchema ? { responseMimeType: 'application/json', responseSchema } : {}),
    },
  };

  const MAX_ATTEMPTS = 4;
  const MAX_WAIT_MS = 65000;
  let resp;
  let bodyText;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    resp = await fetch(GEMINI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (resp.ok) break;

    bodyText = await resp.text();
    if (!RETRYABLE_STATUS.has(resp.status) || attempt === MAX_ATTEMPTS) break;

    // Gemini's 429 responses include the server-recommended wait (e.g. "56s") -- honor it
    // instead of a short fixed backoff, since the free tier's per-minute quota needs a real pause.
    const retryDelayMatch = bodyText.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
    const waitMs = retryDelayMatch
      ? Math.min(Math.ceil(parseFloat(retryDelayMatch[1]) * 1000) + 1000, MAX_WAIT_MS)
      : 2000 * attempt;
    console.log(`Gemini ${resp.status}, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  if (!resp.ok) {
    throw new Error(`Gemini API error ${resp.status}: ${bodyText}`);
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
  return responseSchema ? JSON.parse(text) : text;
}

const RATE_SYSTEM_PROMPT = `You evaluate a rough LinkedIn post idea before it gets written up, on behalf of the person whose voice/persona blueprint is below. Score honestly and critically: most rough notes deserve a 5-7, reserve 9-10 for ideas that are already genuinely sharp, specific, and ready to become a strong post.

Score these four dimensions from 1-10:
- specificity: a concrete detail, number, scene, or angle -- or a generic rant / vague observation?
- professionalism: appropriate to post publicly on LinkedIn under this person's name?
- genuineness: reads as a real, honestly-held thought rather than something generic or performative?
- hookPotential: has an angle worth someone stopping to read and comment on?

Then give an "overall" 1-10 holistic rating informed by (not just averaged from) the four scores, 1-2 sentences of "reasoning" for that overall call, and 2-3 short "keywords" (1-4 words each) naming the real-world topic/industry/news angle the idea touches -- suitable as Google News search terms, not generic words like "linkedin" or "post".

VOICE / PERSONA CONTEXT (for judging fit and genuineness -- the idea has not been written into a post yet, so don't score it as writing):
---
{voice_skill}
---`;

const RATE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    specificity: { type: 'NUMBER' },
    professionalism: { type: 'NUMBER' },
    genuineness: { type: 'NUMBER' },
    hookPotential: { type: 'NUMBER' },
    overall: { type: 'NUMBER' },
    reasoning: { type: 'STRING' },
    keywords: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['specificity', 'professionalism', 'genuineness', 'hookPotential', 'overall', 'reasoning', 'keywords'],
};

/** Scores a rough thought on 4 dimensions + overall, and extracts 2-3 news-search keywords. */
async function rateThought(thought) {
  const voiceSkill = loadVoiceSkill();
  const systemPrompt = RATE_SYSTEM_PROMPT.replace('{voice_skill}', voiceSkill || '(no voice skill file found)');
  return callGemini({ systemPrompt, userText: thought, responseSchema: RATE_SCHEMA, temperature: 0.3 });
}

const FILTER_SYSTEM_PROMPT = `You filter a list of news headlines for relevance to a specific LinkedIn post idea. A headline only survives if it is genuinely ON-TOPIC for the idea -- not just because it happens to share a keyword. Be strict: when in doubt, discard it. Return the "index" values of only the headlines worth keeping.`;

const FILTER_SCHEMA = {
  type: 'OBJECT',
  properties: {
    relevantIndexes: { type: 'ARRAY', items: { type: 'NUMBER' } },
  },
  required: ['relevantIndexes'],
};

/** Discards headlines that only keyword-matched but aren't actually on-topic for the thought. */
async function filterRelevantNews(thought, headlines) {
  if (headlines.length === 0) return [];

  const indexed = headlines.map((h, i) => ({ index: i, title: h.title, source: h.source }));
  const userText = `POST IDEA:\n${thought}\n\nHEADLINES:\n${JSON.stringify(indexed, null, 2)}`;

  const { relevantIndexes } = await callGemini({
    systemPrompt: FILTER_SYSTEM_PROMPT,
    userText,
    responseSchema: FILTER_SCHEMA,
    temperature: 0,
  });

  return relevantIndexes
    .filter((i) => Number.isInteger(i) && i >= 0 && i < headlines.length)
    .map((i) => headlines[i]);
}

const WRITE_SYSTEM_PROMPT = `You are a LinkedIn ghostwriter. You write in the voice defined below.

Hard rules, no exceptions:
- One input = exactly ONE LinkedIn post. Never generate multiple options, hooks, ideas, drafts, or versions.
- Preserve the user's facts exactly. Never invent achievements, numbers, statistics, events, names, or stories that weren't given.
- The input may be messy, incomplete, conversational, or just bullet points. Turn it into a coherent post without adding facts that weren't there.
- Treat this as a brand-new, independent post. Do not reference any earlier conversation.
- Follow the voice/writing skill below for tone, structure, storytelling, formatting, and vocabulary.
- Avoid generic AI/corporate LinkedIn language (e.g. "In today's fast-paced world", "I'm thrilled to announce", excessive emoji, hashtag spam) unless the voice skill itself calls for it.
- You may be given 0-3 candidate news headlines. Use AT MOST ONE, and only if it genuinely strengthens the post -- as a hook, a contrast, or supporting evidence. Never state or imply any detail about a headline beyond its title and source. If none of them earn their place, use none.
- Respond with "post" (the finished post text -- no preamble, no markdown fences, nothing else attached) and "usedHeadlines" (an array containing the exact title string of the headline you referenced, or an empty array if you used none).

VOICE / WRITING SKILL (source of truth for style):
---
{voice_skill}
---`;

const WRITE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    post: { type: 'STRING' },
    usedHeadlines: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['post', 'usedHeadlines'],
};

/** Drafts the post from the voice skill + the thought + (optionally) surviving news headlines. */
async function generatePost(thought, newsHeadlines = []) {
  const voiceSkill = loadVoiceSkill();
  const systemPrompt = WRITE_SYSTEM_PROMPT.replace('{voice_skill}', voiceSkill || '(no voice skill file found)');

  let userText = thought;
  if (newsHeadlines.length > 0) {
    const list = newsHeadlines.map((h) => `- "${h.title}" (${h.source || 'unknown source'})`).join('\n');
    userText += `\n\n---\nCANDIDATE NEWS HEADLINES (use at most one, only if it genuinely helps):\n${list}`;
  }

  return callGemini({ systemPrompt, userText, responseSchema: WRITE_SCHEMA, temperature: 0.8 });
}

module.exports = { rateThought, filterRelevantNews, generatePost };
