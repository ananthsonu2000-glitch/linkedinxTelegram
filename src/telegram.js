const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

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

async function pollUpdates(onUpdate) {
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
        await onUpdate(update);
      }
    } catch (err) {
      console.error('Error polling Telegram:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

module.exports = { sendMessage, pollUpdates };
