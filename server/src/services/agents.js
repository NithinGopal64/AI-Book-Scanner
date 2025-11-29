import { visionExtractFromBuffer } from './visionExtract.js';
import { lookupBookMetadata } from './lookup.js';
import { embedAndUpsert, embedText } from './embeddings.js';

export async function processScanImage(buffer) {
  const candidates = await visionExtractFromBuffer(buffer);
  const max = Number(process.env.MAX_CANDIDATES || 10);
  const seen = new Set();
  const resolved = [];
  
  for (const c of candidates.slice(0, max)) {
    if (!c?.title) continue;
    const key = String(c.title).trim().toLowerCase();
    if (seen.has(key)) continue; 
    seen.add(key);
    
    // Build search query from title and author
    const q = [c.title, c.author].filter(Boolean).join(' ');
    
    try {
      // Use enhanced lookup that tries Google Books first, then Open Library
      const metas = await lookupBookMetadata(q, { limit: 1 });
      if (metas[0]) {
        const doc = await embedAndUpsert(metas[0]);
        resolved.push(doc);
      }
    } catch (e) {
      console.error(`Failed to lookup book "${c.title}":`, e.message);
      // ignore individual failures and continue
    }
  }
  return resolved;
}

export async function buildRecQueryFromPrefs(prefs = {}) {
  const { likes = [], dislikes = [] } = prefs;
  const prompt = `Recommend books similar to: ${likes.join(', ')} and not like: ${dislikes.join(', ')}`;
  return embedText(prompt);
}
