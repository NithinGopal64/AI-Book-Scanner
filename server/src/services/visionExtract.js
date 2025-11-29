import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const SYSTEM = `Extract books from an image of a bookshelf or book cover. 
Focus on accurately reading book titles from spines or covers. 
Return JSON only: { "items": [{ "title": string (required, the full book title as visible), "author"?: string, "isbn"?: string, "bbox"?: any, "confidence": number (0-1) }] }.
Be precise with titles - read them carefully from the image. If a title is partially visible, include what you can see.`;

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY. Set it in server/.env');
  return new OpenAI({ apiKey });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function withRetry(fn, { retries = Number(process.env.OPENAI_MAX_RETRIES || 3), baseMs = Number(process.env.OPENAI_RETRY_BASE_MS || 500) } = {}) {
  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      const status = e?.status || e?.response?.status;
      if (status !== 429 && (!status || status < 500)) break;
      const delay = baseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
      await sleep(delay);
      attempt++;
    }
  }
  throw lastErr;
}

export async function visionExtractFromBuffer(buffer) {
  if (String(process.env.DEMO_FAKE_VISION).toLowerCase() === 'true') {
    return [{ title: 'Sample Book One', author: 'Demo Author', confidence: 0.9 }];
  }
  const openai = getOpenAI();
  const b64 = buffer.toString('base64');
  const model = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
  const res = await withRetry(() => openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all visible book titles from this image. Read the titles carefully from book spines or covers. Return as strict JSON with an items array.' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
  }));
  const text = res.choices?.[0]?.message?.content || '{}';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  return parsed.items || [];
}
