const RSS_BASE = 'https://news.google.com/rss/search';

function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? decodeXml(m[1]).trim() : '';
}

async function fetchTopicHeadlines(query, limit) {
  const url = `${RSS_BASE}?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`Google News RSS error ${resp.status} for "${query}"`);
  const xml = await resp.text();

  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    const source = extractTag(block, 'source');
    if (title && link) items.push({ title, link, pubDate, source, matchedKeyword: query });
  }
  return items;
}

/** Fetches Google News RSS results for each keyword and returns a deduped list. */
async function fetchGoogleNews(keywords, limitPerTopic = 5) {
  const settled = await Promise.allSettled(
    keywords.map((kw) => fetchTopicHeadlines(kw, limitPerTopic))
  );

  const seen = new Set();
  const results = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === 'rejected') {
      console.error(`News fetch failed for "${keywords[i]}":`, outcome.reason.message);
      return;
    }
    for (const item of outcome.value) {
      if (!seen.has(item.link)) {
        seen.add(item.link);
        results.push(item);
      }
    }
  });
  return results;
}

module.exports = { fetchGoogleNews };
