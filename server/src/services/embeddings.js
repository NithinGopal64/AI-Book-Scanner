import OpenAI from 'openai';
import dotenv from 'dotenv';
import Book from '../models/Book.js';
dotenv.config();

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

function stringToVector(text, dim = 128) {
  const vec = new Array(dim).fill(0);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); }
  for (let i = 0; i < dim; i++) { h ^= (h << 13); h ^= (h >>> 7); h ^= (h << 17); vec[i] = (h >>> 0) / 4294967295; }
  return vec;
}

export async function embedText(text) {
  if (String(process.env.DEMO_FAKE_EMBEDDINGS).toLowerCase() === 'true') {
    return stringToVector(text || '');
  }
  const openai = getOpenAI();
  const model = process.env.OPENAI_EMBEDDINGS_MODEL || 'text-embedding-3-small';
  const resp = await withRetry(() => openai.embeddings.create({ model, input: text || '' }));
  return resp.data?.[0]?.embedding || [];
}

// Clean and normalize metadata before saving
function normalizeMetadata(meta) {
  const normalized = { ...meta };
  
  // Ensure advancedMetadata.industryIdentifiers is always an array
  if (normalized.advancedMetadata) {
    if (!normalized.advancedMetadata.industryIdentifiers || !Array.isArray(normalized.advancedMetadata.industryIdentifiers)) {
      normalized.advancedMetadata.industryIdentifiers = [];
    } else {
      // Ensure each identifier has the correct structure
      normalized.advancedMetadata.industryIdentifiers = normalized.advancedMetadata.industryIdentifiers
        .filter(id => id && (id.identifierType || id.type) && id.identifier)
        .map(id => ({
          identifierType: id.identifierType || id.type,
          identifier: id.identifier,
        }));
    }
  }
  
  // Ensure arrays are arrays
  if (!Array.isArray(normalized.authors)) normalized.authors = [];
  if (!Array.isArray(normalized.categories)) normalized.categories = [];
  if (!Array.isArray(normalized.genre)) normalized.genre = [];
  
  return normalized;
}

export async function embedAndUpsert(meta) {
  // Normalize metadata first
  const normalizedMeta = normalizeMetadata(meta);
  
  // Try to find existing book by title and authors, or by ISBN if available
  let existing = null;
  if (normalizedMeta.isbn13) {
    existing = await Book.findOne({ isbn13: normalizedMeta.isbn13 });
  }
  if (!existing && normalizedMeta.isbn10) {
    existing = await Book.findOne({ isbn10: normalizedMeta.isbn10 });
  }
  if (!existing) {
    existing = await Book.findOne({ 
      title: normalizedMeta.title, 
      authors: { $in: normalizedMeta.authors || [] } 
    });
  }

  // Build comprehensive text for embedding including all metadata
  const parts = [
    normalizedMeta.title || '',
    (normalizedMeta.authors || []).join(', '),
    (normalizedMeta.genre || []).join(' '),
    (normalizedMeta.categories || []).join(' '),
    normalizedMeta.description || '',
    normalizedMeta.series?.name || '',
    normalizedMeta.publisher || '',
    normalizedMeta.publicationYear ? String(normalizedMeta.publicationYear) : '',
  ].filter(Boolean);
  
  const text = parts.join(' ');

  if (existing && Array.isArray(existing.embedding) && existing.embedding.length > 0 && String(process.env.FORCE_REEMBED).toLowerCase() !== 'true') {
    // Update metadata only, keep embedding
    existing.set(normalizedMeta);
    await existing.save();
    return existing;
  }
  
  const embedding = await embedText(text);
  if (existing) { 
    existing.set({ ...normalizedMeta, embedding }); 
    await existing.save(); 
    return existing; 
  }
  return Book.create({ ...normalizedMeta, embedding });
}
