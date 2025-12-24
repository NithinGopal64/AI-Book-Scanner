import Book from '../models/Book.js';
import { lookupSimilarBooks, lookupBookMetadata } from './lookup.js';
import { embedText, embedAndUpsert } from './embeddings.js';
import { filterBooks, getContentFilterSettings, shouldFilterBook } from './contentFilter.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

// Recommendation caching (in-memory)

const recommendationCache = new Map();
const CACHE_TTL = Number(process.env.RECOMMENDATION_CACHE_TTL) || 60 * 60 * 1000; // 1 hour default
const ENABLE_CACHE = String(process.env.ENABLE_RECOMMENDATION_CACHE || 'true').toLowerCase() === 'true';

// Cache key: sorted book IDs + filters
function getCacheKey(bookIds, filters = {}) {
  const bookKey = bookIds.sort().join(',');
  const filterKey = JSON.stringify({
    authorPreference: filters.authorPreference || 'negative',
    languages: (filters.languages || []).sort(),
    genres: (filters.genres || []).sort(),
  });
  return `${bookKey}|${filterKey}`;
}

// Cache entry structure
function createCacheEntry(data) {
  return {
    data,
    timestamp: Date.now(),
  };
}

// Get from cache if valid
function getCachedRecommendations(cacheKey) {
  if (!ENABLE_CACHE) return null;
  const entry = recommendationCache.get(cacheKey);
  if (!entry) return null;
  
  const age = Date.now() - entry.timestamp;
  if (age > CACHE_TTL) {
    recommendationCache.delete(cacheKey);
    return null;
  }
  
  return entry.data;
}

// Store in cache
function setCachedRecommendations(cacheKey, data) {
  if (!ENABLE_CACHE) return;
  recommendationCache.set(cacheKey, createCacheEntry(data));
}

// Clear cache for a book collection (call when new books scanned)
export function clearRecommendationCache(bookIds) {
  // Clear all cache entries that start with these book IDs 
  const bookKey = bookIds.sort().join(',');
  for (const key of recommendationCache.keys()) {
    if (key.startsWith(bookKey + '|') || key === bookKey) {
      recommendationCache.delete(key);
    }
  }
}

function cosine(a, b) {
  if (!a?.length || !b?.length) return 0;
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
  return dot / denom;
}

function averageEmbeddingFromBooks(books = []) {
  const vectors = books
    .map((b) => Array.isArray(b?.embedding) ? b.embedding : null)
    .filter((v) => v && v.length);
  if (!vectors.length) return [];
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  vectors.forEach((vec) => {
    for (let i = 0; i < dim; i++) {
      sum[i] += vec[i];
    }
  });
  return sum.map((val) => val / vectors.length);
}

export async function recommendByQueryEmbedding(queryEmbedding, { limit = 12, excludeIds = [], includeScores = false } = {}) {
  const normalizedExclude = excludeIds
    .map((id) => (id && id._id ? id._id : id))
    .filter(Boolean);
  const query = normalizedExclude.length ? { _id: { $nin: normalizedExclude } } : {};
  const books = await Book.find(query);
  const scored = books.map((b) => ({ book: b, score: cosine(queryEmbedding, b.embedding) }));
  const seen = new Set();
  
  // Get content filter settings
  const filterSettings = getContentFilterSettings();
  
  const results = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((s) => {
      // Filter inappropriate content
      if (filterSettings.enabled && shouldFilterBook(s.book, filterSettings)) {
        return false;
      }
      // Filter duplicates
      const key = s.book?._id ? String(s.book._id) : undefined;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
  
  if (includeScores) {
    return results.map(({ book, score }) => ({ book, confidence: score }));
  }
  return results.map(({ book }) => book);
}

export async function recommendFromSeedBooks(books, { limit = 12 } = {}) {
  const seedEmbedding = averageEmbeddingFromBooks(books);
  if (!seedEmbedding.length) return [];
  const excludeIds = books.map((b) => b._id);
  const seedTitles = new Set(
    books
      .map((b) => String(b?.title || '').trim().toLowerCase())
      .filter(Boolean)
  );
  let recs = await recommendByQueryEmbedding(seedEmbedding, { limit: limit * 2, excludeIds, includeScores: true });
  const normalize = (title) => String(title || '').trim().toLowerCase();
  const seenTitles = new Set(seedTitles);
  const primary = [];
  recs.forEach(({ book, confidence }) => {
    const key = normalize(book?.title);
    if (!key || seenTitles.has(key)) return;
    seenTitles.add(key);
    primary.push({ book, confidence });
  });
  if (primary.length >= limit) return primary.slice(0, limit);

  const fallbackNeeded = limit - primary.length;
  const fallback = [];
  for (const seed of books) {
    if (fallback.length >= fallbackNeeded) break;
    const similar = await lookupSimilarBooks(seed, { limit: fallbackNeeded * 2 });
    // Get content filter settings
    const filterSettings = getContentFilterSettings();
    
    for (const meta of similar) {
      // Filter inappropriate content
      if (filterSettings.enabled && shouldFilterBook(meta, filterSettings)) {
        continue;
      }
      const key = normalize(meta?.title);
      if (!key || seenTitles.has(key)) continue;
      seenTitles.add(key);
      // Lower confidence for fallback results
      fallback.push({ book: meta, confidence: 0.4 });
      if (fallback.length >= fallbackNeeded) break;
    }
  }
  return [...primary, ...fallback].slice(0, limit);
}

/**
 * Extract metadata patterns from books (genres, categories, themes)
 */
function extractMetadataPatterns(books) {
  const genres = new Set();
  const categories = new Set();
  const authors = new Set();
  const titles = new Set();
  const series = new Set();
  const publishers = new Set();
  const years = [];

  books.forEach(book => {
    if (book.genre && Array.isArray(book.genre)) {
      book.genre.forEach(g => {
        if (g) genres.add(String(g).toLowerCase().trim());
      });
    }
    if (book.categories && Array.isArray(book.categories)) {
      book.categories.forEach(c => {
        if (c) categories.add(String(c).toLowerCase().trim());
      });
    }
    // Also check advancedMetadata for mainCategory
    if (book.advancedMetadata?.mainCategory) {
      categories.add(String(book.advancedMetadata.mainCategory).toLowerCase().trim());
    }
    if (book.authors && Array.isArray(book.authors)) {
      book.authors.forEach(a => {
        if (a) authors.add(String(a).toLowerCase().trim());
      });
    }
    if (book.title) titles.add(String(book.title).toLowerCase().trim());
    if (book.series?.name) series.add(String(book.series.name).toLowerCase().trim());
    if (book.publisher) publishers.add(String(book.publisher).toLowerCase().trim());
    if (book.publicationYear) years.push(book.publicationYear);
  });

  return {
    genres: Array.from(genres),
    categories: Array.from(categories),
    authors: Array.from(authors),
    titles: Array.from(titles),
    series: Array.from(series),
    publishers: Array.from(publishers),
    avgYear: years.length > 0 ? Math.round(years.reduce((a, b) => a + b, 0) / years.length) : null,
  };
}

/**
 * Score a book based on metadata similarity (excluding same authors/titles)
 */
function scoreBookByMetadata(book, patterns, excludeAuthors, excludeTitles) {
  const bookTitle = String(book.title || '').toLowerCase();
  const bookAuthors = (book.authors || []).map(a => String(a).toLowerCase());
  
  // Exclude if same title or same author
  if (excludeTitles.has(bookTitle)) return 0;
  if (bookAuthors.some(a => excludeAuthors.has(a))) return 0;

  let score = 0;
  
  // Genre matching (high weight)
  if (book.genre && book.genre.length > 0) {
    const bookGenres = book.genre.map(g => g.toLowerCase());
    const genreMatches = bookGenres.filter(g => patterns.genres.includes(g)).length;
    score += genreMatches * 3;
  }
  
  // Category matching (medium weight)
  if (book.categories && book.categories.length > 0) {
    const bookCategories = book.categories.map(c => c.toLowerCase());
    const categoryMatches = bookCategories.filter(c => patterns.categories.includes(c)).length;
    score += categoryMatches * 2;
  }
  
  // Publisher matching (low weight)
  if (book.publisher && patterns.publishers.includes(book.publisher.toLowerCase())) {
    score += 1;
  }
  
  // Year proximity (low weight)
  if (book.publicationYear && patterns.avgYear) {
    const yearDiff = Math.abs(book.publicationYear - patterns.avgYear);
    if (yearDiff <= 5) score += 1;
    else if (yearDiff <= 10) score += 0.5;
  }
  
  // Series matching (medium weight) - but different series
  if (book.series?.name && patterns.series.length > 0) {
    const bookSeries = book.series.name.toLowerCase();
    // Bonus for being in a series (shows it's part of a collection)
    if (!patterns.series.includes(bookSeries)) {
      score += 1;
    }
  }

  return score;
}

/**
 * Recommend books based on metadata patterns from scanned books
 * Uses genre, categories, and other metadata to find similar books
 */
export async function recommendByMetadata(books, { limit = 12 } = {}) {
  if (!books || books.length === 0) return [];

  // Extract metadata patterns from scanned books
  const patterns = extractMetadataPatterns(books);
  
  // If no genres/categories found, fallback to embedding-based
  if (patterns.genres.length === 0 && patterns.categories.length === 0) {
    const results = await recommendFromSeedBooks(books, { limit });
    return results;
  }

  // Build search queries based on metadata
  const searchQueries = [];
  
  // Combine genres and categories, prioritize the most common ones
  const allSubjects = [...patterns.genres, ...patterns.categories];
  const uniqueSubjects = [...new Set(allSubjects)].filter(s => s && s.length > 2); // Filter out very short strings
  
  // Use top subjects for search (limit to avoid too many API calls)
  uniqueSubjects.slice(0, 3).forEach(subject => {
    // Clean subject for search (remove special chars that might break the query)
    const cleanSubject = subject.replace(/[^\w\s-]/g, '').trim();
    if (cleanSubject.length > 2) {
      searchQueries.push(`subject:${cleanSubject}`);
    }
  });

  // If we have specific genres, search for books in those genres
  if (searchQueries.length === 0) {
    // Fallback: use embedding-based recommendations
    const results = await recommendFromSeedBooks(books, { limit });
    return results;
  }

  const excludeAuthors = new Set(patterns.authors);
  const excludeTitles = new Set(patterns.titles);
  
  // Search for books using metadata queries
  const allCandidates = [];
  const seenBookIds = new Set();
  
  for (const query of searchQueries.slice(0, 3)) { // Limit to 3 queries to avoid too many API calls
    try {
      const results = await lookupBookMetadata(query, { limit: 20 });
      for (const meta of results) {
        const bookId = meta.isbn13 || meta.isbn10 || meta.title;
        if (seenBookIds.has(bookId)) continue;
        seenBookIds.add(bookId);
        
        // Score the book based on metadata similarity
        const score = scoreBookByMetadata(meta, patterns, excludeAuthors, excludeTitles);
        if (score > 0) {
          allCandidates.push({ meta, score });
        }
      }
    } catch (e) {
      console.error(`Failed to search with query "${query}":`, e.message);
    }
  }

  // Sort by score and return top results
  allCandidates.sort((a, b) => b.score - a.score);
  const topCandidates = allCandidates.slice(0, limit * 2); // Get more than needed for filtering

  // Get content filter settings
  const filterSettings = getContentFilterSettings();

  // Convert to Book documents (upsert to get embeddings)
  const recommendedBooks = [];
  for (const { meta, score } of topCandidates) {
    if (recommendedBooks.length >= limit) break;
    try {
      // Filter inappropriate content before upserting
      if (filterSettings.enabled && shouldFilterBook(meta, filterSettings)) {
        continue; // Skip this book
      }

      const book = await embedAndUpsert(meta);
      // Double-check we're not including scanned books
      const bookTitle = String(book.title || '').toLowerCase();
      const bookAuthors = (book.authors || []).map(a => String(a).toLowerCase());
      if (!excludeTitles.has(bookTitle) && !bookAuthors.some(a => excludeAuthors.has(a))) {
        // Normalize metadata score to 0-1 range (max possible score is ~15-20)
        const normalizedScore = Math.min(score / 20, 1);
        recommendedBooks.push({ book, confidence: normalizedScore });
      }
    } catch (e) {
      console.error(`Failed to upsert recommended book:`, e.message);
    }
  }

  // If we don't have enough, supplement with embedding-based recommendations
  if (recommendedBooks.length < limit) {
    const excludeIds = [...books.map(b => b._id), ...recommendedBooks.map(r => r.book._id)];
    const seedEmbedding = averageEmbeddingFromBooks(books);
    if (seedEmbedding.length > 0) {
      const embeddingRecs = await recommendByQueryEmbedding(seedEmbedding, { 
        limit: limit - recommendedBooks.length, 
        excludeIds,
        includeScores: true
      });
      // Filter out same authors/titles and inappropriate content, convert to same format
      const filtered = embeddingRecs
        .filter(({ book }) => {
          // Filter inappropriate content
          if (filterSettings.enabled && shouldFilterBook(book, filterSettings)) {
            return false;
          }
          // Filter same authors/titles
          const bookTitle = String(book.title || '').toLowerCase();
          const bookAuthors = (book.authors || []).map(a => String(a).toLowerCase());
          return !excludeTitles.has(bookTitle) && !bookAuthors.some(a => excludeAuthors.has(a));
        })
        .map(({ book, confidence }) => ({ book, confidence }));
      recommendedBooks.push(...filtered);
    }
  }

  // Sort by confidence and return
  recommendedBooks.sort((a, b) => b.confidence - a.confidence);
  return recommendedBooks.slice(0, limit);
}

/**
 * Recommend books based on scanned book titles from an image
 * This function extracts metadata from scanned books and recommends based on genre/categories
 */
export async function recommendFromScannedTitles(scannedTitles = [], { limit = 12 } = {}) {
  if (!scannedTitles || scannedTitles.length === 0) {
    return [];
  }

  // First, find or lookup books from scanned titles
  const normalize = (title) => String(title || '').trim().toLowerCase();
  const scannedTitlesNormalized = scannedTitles.map(normalize).filter(Boolean);
  
  // Find books in database that match scanned titles
  let existingBooks = await Book.find({
    $or: scannedTitlesNormalized.map(title => ({
      title: { $regex: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }
    }))
  });

  // If not all books found, lookup missing ones
  if (existingBooks.length < scannedTitles.length) {
    const foundTitles = new Set(existingBooks.map(b => normalize(b.title)));
    const missingTitles = scannedTitles.filter(t => !foundTitles.has(normalize(t)));
    
    for (const title of missingTitles.slice(0, 5)) {
      try {
        const metas = await lookupBookMetadata(title, { limit: 1 });
        if (metas[0]) {
          const book = await embedAndUpsert(metas[0]);
          existingBooks.push(book);
        }
      } catch (e) {
        console.error(`Failed to lookup scanned title "${title}":`, e.message);
      }
    }
  }

  // Use metadata-based recommendations
  if (existingBooks.length > 0) {
    return await recommendByMetadata(existingBooks, { limit });
  }

  // Fallback: create embedding from scanned titles text and search
  const queryText = `Books similar to: ${scannedTitles.join(', ')}`;
  const queryEmbedding = await embedText(queryText);
  const results = await recommendByQueryEmbedding(queryEmbedding, { limit, includeScores: true });
  return results;
}

/**
 * Analyze user preferences from scanned books
 * Extracts language distribution, genre preferences, and author diversity
 */
export function analyzeUserPreferences(books) {
  if (!books || books.length === 0) {
    return {
      language: { distribution: {}, confidence: 0 },
      genres: { top: [], distribution: {}, weights: {} },
      authorDiversity: { uniqueAuthors: 0, totalBooks: 0, ratio: 0 },
      publishers: { distribution: {} },
      avgPublicationYear: null,
    };
  }

  // Language distribution
  const languageCount = {};
  const languagesWithData = books.filter(b => b.language);
  
  languagesWithData.forEach(book => {
    const lang = String(book.language).toLowerCase().trim();
    languageCount[lang] = (languageCount[lang] || 0) + 1;
  });

  const totalWithLanguage = languagesWithData.length;
  const languageDistribution = {};
  let dominantLanguage = null;
  let maxLangCount = 0;

  Object.entries(languageCount).forEach(([lang, count]) => {
    const percentage = totalWithLanguage > 0 ? count / totalWithLanguage : 0;
    languageDistribution[lang] = percentage;
    if (count > maxLangCount) {
      maxLangCount = count;
      dominantLanguage = lang;
    }
  });

  const languageConfidence = dominantLanguage && totalWithLanguage > 0
    ? languageDistribution[dominantLanguage]
    : 0;

  // Genre distribution
  const genreCount = {};
  books.forEach(book => {
    const genres = book.genre || book.categories || [];
    genres.forEach(genre => {
      const normalized = String(genre).toLowerCase().trim();
      if (normalized) {
        genreCount[normalized] = (genreCount[normalized] || 0) + 1;
      }
    });
  });

  const genreEntries = Object.entries(genreCount).sort((a, b) => b[1] - a[1]);
  const topGenres = genreEntries.slice(0, 10).map(([genre]) => genre);
  
  const totalGenreBooks = books.filter(b => (b.genre || b.categories || []).length > 0).length;
  const genreDistribution = {};
  const genreWeights = {};

  genreEntries.forEach(([genre, count]) => {
    const percentage = totalGenreBooks > 0 ? count / totalGenreBooks : 0;
    genreDistribution[genre] = percentage;
    // Weight based on frequency (more frequent = higher weight)
    genreWeights[genre] = Math.min(percentage * 2, 1.0); // Cap at 1.0
  });

  // Author diversity
  const uniqueAuthors = new Set();
  books.forEach(book => {
    (book.authors || []).forEach(author => {
      if (author) uniqueAuthors.add(String(author).toLowerCase().trim());
    });
  });

  const authorDiversity = {
    uniqueAuthors: uniqueAuthors.size,
    totalBooks: books.length,
    ratio: books.length > 0 ? uniqueAuthors.size / books.length : 0,
  };

  // Publisher distribution (optional)
  const publisherCount = {};
  books.forEach(book => {
    if (book.publisher) {
      const pub = String(book.publisher).toLowerCase().trim();
      publisherCount[pub] = (publisherCount[pub] || 0) + 1;
    }
  });

  // Average publication year
  const years = books.map(b => b.publicationYear).filter(y => y && !isNaN(y));
  const avgYear = years.length > 0
    ? Math.round(years.reduce((a, b) => a + b, 0) / years.length)
    : null;

  return {
    language: {
      dominant: dominantLanguage,
      distribution: languageDistribution,
      confidence: languageConfidence,
    },
    genres: {
      top: topGenres,
      distribution: genreDistribution,
      weights: genreWeights,
    },
    authorDiversity,
    publishers: {
      distribution: publisherCount,
    },
    avgPublicationYear: avgYear,
  };
}

/**
 * Score a recommendation using layered intelligence with filters
 */
function scoreRecommendationByLayers(candidateBook, userPreferences, scannedBooks, filters = {}) {
  const {
    authorPreference = 'negative',
    languages = [],
    genres = [],
  } = filters;

  let baseScore = 0.5;
  const scoreBreakdown = {
    language: 0,
    genre: 0,
    author: 0,
    other: 0,
  };

  // Layer 1: Language Match
  if (candidateBook.language) {
    const candidateLang = String(candidateBook.language).toLowerCase().trim();
    
    if (languages.length > 0) {
      // User-specified languages filter
      if (languages.includes(candidateLang)) {
        scoreBreakdown.language = 0.3;
        baseScore += 0.3;
      } else {
        // Filter out if language doesn't match
        return { score: 0, scoreBreakdown };
      }
    } else {
      // Use detected preferences
      const langDist = userPreferences.language.distribution || {};
      const langConfidence = userPreferences.language.confidence || 0;
      
      if (langConfidence > 0.7 && candidateLang === userPreferences.language.dominant) {
        scoreBreakdown.language = 0.3;
        baseScore += 0.3;
      } else if (langDist[candidateLang]) {
        scoreBreakdown.language = 0.15 * langDist[candidateLang];
        baseScore += scoreBreakdown.language;
      }
    }
  }

  // Layer 2: Genre Match
  const candidateGenres = (candidateBook.genre || candidateBook.categories || [])
    .map(g => String(g).toLowerCase().trim());
  
  if (genres.length > 0) {
    // User-specified genres filter (normalize for comparison)
    const normalizedFilterGenres = genres.map(g => String(g).toLowerCase().trim());
    const matchingGenres = candidateGenres.filter(g => 
      normalizedFilterGenres.includes(g)
    );
    
    if (matchingGenres.length > 0) {
      scoreBreakdown.genre = Math.min(matchingGenres.length * 0.2, 0.4);
      baseScore += scoreBreakdown.genre;
    } else {
      // Lower score if no genre match (but don't filter out completely)
      scoreBreakdown.genre = -0.1;
      baseScore -= 0.1;
    }
  } else {
    // Use detected preferences
    const genreWeights = userPreferences.genres.weights || {};
    let genreScore = 0;
    
    candidateGenres.forEach(genre => {
      if (genreWeights[genre]) {
        genreScore += genreWeights[genre] * 0.2;
      }
    });
    
    scoreBreakdown.genre = Math.min(genreScore, 0.4);
    baseScore += scoreBreakdown.genre;
  }

  // Layer 3: Author Diversity (based on filter preference)
  const candidateAuthors = (candidateBook.authors || [])
    .map(a => String(a).toLowerCase().trim());
  const scannedAuthors = new Set(
    scannedBooks.flatMap(b => (b.authors || [])
      .map(a => String(a).toLowerCase().trim()))
  );
  
  const hasMatchingAuthor = candidateAuthors.some(a => scannedAuthors.has(a));

  if (authorPreference === 'positive') {
    // Boost same authors
    if (hasMatchingAuthor) {
      scoreBreakdown.author = 0.2;
      baseScore += 0.2;
    }
  } else if (authorPreference === 'negative') {
    // Penalize same authors (diversity)
    if (hasMatchingAuthor) {
      scoreBreakdown.author = -0.3;
      baseScore -= 0.3;
    }
  }
  // 'neutral' = no adjustment

  // Layer 4: Additional factors (publication year proximity)
  if (candidateBook.publicationYear && userPreferences.avgPublicationYear) {
    const yearDiff = Math.abs(candidateBook.publicationYear - userPreferences.avgPublicationYear);
    if (yearDiff <= 5) {
      scoreBreakdown.other = 0.1;
      baseScore += 0.1;
    } else if (yearDiff <= 10) {
      scoreBreakdown.other = 0.05;
      baseScore += 0.05;
    }
  }

  // Clamp score to 0.0 - 1.0
  const finalScore = Math.max(0, Math.min(1, baseScore));

  return {
    score: finalScore,
    scoreBreakdown,
  };
}

/**
 * Uses OpenAI to generate intelligent recommendations based on reading history
 */
function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY. Set it in server/.env');
  return new OpenAI({ apiKey });
}

export async function recommendWithLLM(books, { limit = 5 } = {}) {
  if (!books || books.length === 0) return [];

  try {
    const openai = getOpenAI();
    
    // Create book list for AI (similar to the other app)
    const bookList = books
      .map(b => {
        const title = b.title || 'Unknown Title';
        const author = b.authors && b.authors.length > 0 
          ? b.authors[0] 
          : (b.author || 'Unknown Author');
        return `"${title}" by ${author}`;
      })
      .join(', ');

    // Call OpenAI for recommendations
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_RECOMMENDATION_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a knowledgeable book recommendation assistant. Based on a user\'s reading history, suggest books they would enjoy. Return your response as a JSON array of objects with "title", "author", and "reason" fields. Keep reasons concise (1-2 sentences). Do NOT recommend books from the same authors or books already in their list. Focus on diverse, interesting recommendations.'
        },
        {
          role: 'user',
          content: `Based on these books I've read: ${bookList}\n\nPlease recommend ${limit} books I would enjoy. Include a brief reason for each recommendation.`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
    });

    const content = response.choices?.[0]?.message?.content || '';
    
    // Parse JSON response - OpenAI with json_object format returns { recommendations: [...] }
    let llmRecommendations = [];
    try {
      const parsed = JSON.parse(content);
      // Handle both formats: { recommendations: [...] } or [{...}, {...}]
      if (Array.isArray(parsed)) {
        llmRecommendations = parsed;
      } else if (parsed.recommendations && Array.isArray(parsed.recommendations)) {
        llmRecommendations = parsed.recommendations;
      } else if (parsed.books && Array.isArray(parsed.books)) {
        llmRecommendations = parsed.books;
      } else {
        // Try to extract array from any field
        const arrayFields = Object.values(parsed).filter(v => Array.isArray(v));
        if (arrayFields.length > 0) {
          llmRecommendations = arrayFields[0];
        }
      }
      
      // Validate and normalize recommendations
      llmRecommendations = llmRecommendations
        .filter(rec => rec && (rec.title || rec.book))
        .map(rec => ({
          title: rec.title || rec.book?.title || 'Unknown',
          author: rec.author || rec.book?.author || rec.authors?.[0] || 'Unknown',
          reason: rec.reason || rec.explanation || 'Based on your reading preferences',
        }))
        .slice(0, limit);
        
    } catch (e) {
      console.error('Failed to parse LLM recommendation response:', e);
      console.error('Response content:', content);
      
      // Fallback: try to extract JSON array using regex (like the other app)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          llmRecommendations = JSON.parse(jsonMatch[0])
            .filter(rec => rec && rec.title)
            .slice(0, limit);
        } catch (parseError) {
          console.error('Failed to parse extracted JSON:', parseError);
        }
      }
    }

    console.log(`Generated ${llmRecommendations.length} LLM-based recommendations, fetching metadata...`);

    // NEW: Fetch metadata from Google Books API for each recommendation
    const enrichedRecommendations = [];
    const excludeTitles = new Set(books.map(b => String(b.title || '').toLowerCase().trim()));
    const excludeAuthors = new Set(
      books.flatMap(b => (b.authors || []).map(a => String(a).toLowerCase().trim()))
    );

    for (const rec of llmRecommendations) {
      try {
        // Build search query from title and author
        const searchQuery = `${rec.title} ${rec.author}`.trim();
        
        // Lookup metadata from Google Books API
        const metadataResults = await lookupBookMetadata(searchQuery, { limit: 1 });
        
        if (metadataResults && metadataResults.length > 0) {
          const metadata = metadataResults[0];
          
          // Double-check we're not recommending books already in the collection
          const metaTitle = String(metadata.title || '').toLowerCase().trim();
          const metaAuthors = (metadata.authors || []).map(a => String(a).toLowerCase().trim());
          
          if (excludeTitles.has(metaTitle)) {
            console.log(`Skipping "${metadata.title}" - already in collection`);
            continue;
          }
          
          if (metaAuthors.some(a => excludeAuthors.has(a))) {
            // Skip if same author, but log it
            console.log(`Skipping "${metadata.title}" - same author as collection`);
            continue;
          }

          // Store the book in database and get full book object with embedding
          const bookDoc = await embedAndUpsert(metadata);
          
          // Return enriched recommendation with full metadata
          enrichedRecommendations.push({
            title: bookDoc.title || rec.title,
            author: (bookDoc.authors && bookDoc.authors.length > 0) ? bookDoc.authors[0] : rec.author,
            reason: rec.reason,
            // Include full book metadata
            book: bookDoc.toObject ? bookDoc.toObject() : bookDoc,
            confidence: 0.8, // LLM recommendations have high confidence
          });
        } else {
          // If metadata not found, still include the recommendation but with minimal data
          console.log(`No metadata found for "${rec.title}" by ${rec.author}`);
          enrichedRecommendations.push({
            title: rec.title,
            authors: [rec.author],
            thumbnail: null,
            description: null,
            reason: rec.reason,
            confidence: 0.7, // Slightly lower confidence without metadata
          });
        }
      } catch (error) {
        console.error(`Failed to fetch metadata for "${rec.title}":`, error.message);
        // Include recommendation anyway, but without metadata
        enrichedRecommendations.push({
          title: rec.title,
          authors: [rec.author],
          thumbnail: null,
          description: null,
          reason: rec.reason,
          confidence: 0.7,
        });
      }
      
      // Stop if we have enough recommendations
      if (enrichedRecommendations.length >= limit) break;
    }

    console.log(`Successfully enriched ${enrichedRecommendations.length} recommendations with metadata`);
    return enrichedRecommendations;

  } catch (error) {
    console.error('LLM recommendation error:', error);
    // Fallback to metadata-based recommendations
    console.log('Falling back to metadata-based recommendations');
    const fallbackResults = await recommendByMetadata(books, { limit });
    // Convert to flattened format with generic reasons and full book data
    return fallbackResults.map(({ book, confidence }) => {
      const bookData = book.toObject ? book.toObject() : book;
      return {
        ...bookData,
        reason: `Similar to books in your collection (${Math.round(confidence * 100)}% match)`,
        confidence,
      };
    });
  }
}

/**
 * Get available filter options from scanned books
 */
export function getAvailableFilterOptions(books) {
  if (!books || books.length === 0) {
    return {
      languages: [],
      genres: [],
      authors: [],
    };
  }

  const languages = new Set();
  const genres = new Set();
  const authors = new Set();

  books.forEach(book => {
    if (book.language) {
      languages.add(String(book.language).toLowerCase().trim());
    }
    
    (book.genre || book.categories || []).forEach(g => {
      genres.add(String(g).trim());
    });
    
    (book.authors || []).forEach(a => {
      if (a) authors.add(String(a).trim());
    });
  });

  return {
    languages: Array.from(languages).sort(),
    genres: Array.from(genres).sort(),
    authors: Array.from(authors).sort(),
  };
}

/**
 * Generate LLM recommendations with filters applied
 * Uses caching to reduce API costs
 */
export async function recommendWithLLMAndFilters(books, filters = {}, { limit = 5, excludeTitles = [] } = {}) {
  if (!books || books.length === 0) return [];

  const {
    authorPreference = 'negative',
    languages = [],
    genres = [],
    useCache = true,
  } = filters;
  
  // Normalize exclude titles for comparison
  const excludeTitleSet = new Set(
    excludeTitles.map(t => String(t).toLowerCase().trim()).filter(Boolean)
  );

  // Get cache key based on book IDs + filters
  const bookIds = books.map(b => String(b._id || b.id || '')).filter(Boolean);
  const cacheKey = getCacheKey(bookIds, filters);
  
  // Try to get cached LLM recommendations (before metadata enrichment)
  let llmRecommendations = null;
  if (useCache) {
    const cached = getCachedRecommendations(cacheKey);
    if (cached && cached.llmRecommendations) {
      console.log('Using cached LLM recommendations');
      llmRecommendations = cached.llmRecommendations;
    }
  }

  // Generate LLM recommendations if not cached
  if (!llmRecommendations) {
    try {
      const openai = getOpenAI();
      
      const bookList = books
        .map(b => {
          const title = b.title || 'Unknown Title';
          const author = b.authors && b.authors.length > 0 
            ? b.authors[0] 
            : (b.author || 'Unknown Author');
          return `"${title}" by ${author}`;
        })
        .join(', ');

      // Extract unique authors from scanned books
      const scannedAuthorsSet = new Set();
      books.forEach(b => {
        if (b.authors && Array.isArray(b.authors)) {
          b.authors.forEach(a => scannedAuthorsSet.add(a));
        } else if (b.author) {
          scannedAuthorsSet.add(b.author);
        }
      });
      const scannedAuthorsList = Array.from(scannedAuthorsSet).join(', ');

      // Build dynamic system prompt based on author preference
      let systemPrompt = 'You are a knowledgeable book recommendation assistant. Based on a user\'s reading history, suggest books they would enjoy. Return your response as a JSON array of objects with "title", "author", and "reason" fields. Keep reasons concise (1-2 sentences).';
      
      if (authorPreference === 'positive') {
        systemPrompt += ` IMPORTANT: Only recommend books written by these authors: ${scannedAuthorsList}. Do NOT recommend books from any other authors. Do NOT recommend books already in their list.`;
      } else if (authorPreference === 'negative') {
        systemPrompt += ' Do NOT recommend books from the same authors or books already in their list. Focus on diverse, interesting recommendations from different authors.';
      } else {
        // neutral - no specific author restriction
        systemPrompt += ' Do NOT recommend books already in their list. Focus on interesting recommendations.';
      }

      // Build user prompt with author context if needed
      let userPrompt = `Based on these books I've read: ${bookList}\n\nPlease recommend ${limit * 2} books I would enjoy. Include a brief reason for each recommendation.`;
      if (authorPreference === 'positive' && scannedAuthorsList) {
        userPrompt += ` Remember: Only recommend books by these authors: ${scannedAuthorsList}.`;
      }

      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_RECOMMENDATION_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });

      const content = response.choices?.[0]?.message?.content || '';
      
      // Parse JSON response
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          llmRecommendations = parsed;
        } else if (parsed.recommendations && Array.isArray(parsed.recommendations)) {
          llmRecommendations = parsed.recommendations;
        } else if (parsed.books && Array.isArray(parsed.books)) {
          llmRecommendations = parsed.books;
        } else {
          const arrayFields = Object.values(parsed).filter(v => Array.isArray(v));
          if (arrayFields.length > 0) {
            llmRecommendations = arrayFields[0];
          }
        }
        
        llmRecommendations = (llmRecommendations || [])
          .filter(rec => rec && (rec.title || rec.book))
          .map(rec => ({
            title: rec.title || rec.book?.title || 'Unknown',
            author: rec.author || rec.book?.author || rec.authors?.[0] || 'Unknown',
            reason: rec.reason || rec.explanation || 'Based on your reading preferences',
          }));
          
      } catch (e) {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            llmRecommendations = JSON.parse(jsonMatch[0])
              .filter(rec => rec && rec.title);
          } catch (parseError) {
            console.error('Failed to parse LLM response:', parseError);
          }
        }
      }

      // Cache the LLM recommendations
      if (llmRecommendations && useCache) {
        setCachedRecommendations(cacheKey, { llmRecommendations });
      }
    } catch (error) {
      console.error('LLM recommendation error:', error);
      throw error;
    }
  }

  if (!llmRecommendations || llmRecommendations.length === 0) {
    return [];
  }

  // Analyze user preferences
  const userPreferences = analyzeUserPreferences(books);

  // Fetch metadata and apply filters
  // Combine scanned book titles and already-recommended titles for exclusion
  const scannedBookTitles = new Set(books.map(b => String(b.title || '').toLowerCase().trim()));
  const allExcludeTitles = new Set([...scannedBookTitles, ...excludeTitleSet]);
  const excludeAuthors = new Set(
    books.flatMap(b => (b.authors || []).map(a => String(a).toLowerCase().trim()))
  );

  const enrichedRecommendations = [];
  const MAX_METADATA_FETCHES = Number(process.env.MAX_METADATA_FETCHES) || 20;

  // Limit candidates to reduce API calls
  const candidatesToProcess = llmRecommendations.slice(0, MAX_METADATA_FETCHES);

  for (const rec of candidatesToProcess) {
    try {
      // Build search query
      const searchQuery = `${rec.title} ${rec.author}`.trim();
      
      // Check MongoDB first to reuse existing data
      let bookDoc = null;
      const existingBook = await Book.findOne({
        $or: [
          { title: { $regex: new RegExp(rec.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } },
        ]
      });

      if (existingBook) {
        bookDoc = existingBook;
      } else {
        // Fetch from Google Books API
        const metadataResults = await lookupBookMetadata(searchQuery, { limit: 1 });
        if (metadataResults && metadataResults.length > 0) {
          const metadata = metadataResults[0];
          bookDoc = await embedAndUpsert(metadata);
        }
      }

      if (!bookDoc) {
        // Create minimal book object if metadata not found
        bookDoc = {
          title: rec.title,
          authors: [rec.author],
          language: null,
          genre: [],
          categories: [],
          thumbnail: null,
          description: null,
          toObject: function() { return this; },
        };
      }

      const bookObj = bookDoc.toObject ? bookDoc.toObject() : bookDoc;
      
      // Check exclusions (both scanned books and already-recommended books)
      const bookTitle = String(bookObj.title || '').toLowerCase().trim();
      const bookAuthors = (bookObj.authors || []).map(a => String(a).toLowerCase().trim());
      
      if (allExcludeTitles.has(bookTitle)) continue;
      
      // Apply author filter early
      if (authorPreference === 'negative' && bookAuthors.some(a => excludeAuthors.has(a))) {
        continue; // Skip books from same authors when user wants diverse authors
      }
      
      // When user wants same authors, only include books from scanned authors
      if (authorPreference === 'positive') {
        const hasMatchingAuthor = bookAuthors.some(a => excludeAuthors.has(a));
        if (!hasMatchingAuthor) {
          continue; // Skip books from different authors when user wants same authors
        }
      }

      // Apply language filter early if specified
      if (languages.length > 0 && bookObj.language) {
        const bookLang = String(bookObj.language).toLowerCase().trim();
        if (!languages.includes(bookLang)) {
          continue; // Skip if language doesn't match filter
        }
      }

      // Score the recommendation (normalize genres for comparison)
      const normalizedGenres = genres.map(g => String(g).trim());
      const { score, scoreBreakdown } = scoreRecommendationByLayers(
        bookObj,
        userPreferences,
        books,
        { authorPreference, languages, genres: normalizedGenres }
      );

      // Skip if score is too low
      if (score < 0.2) continue;

      // Return flattened structure for consistency with BookCard expectations
      enrichedRecommendations.push({
        ...bookObj,
        reason: rec.reason,
        confidence: score,
        scoreBreakdown, // Optional: for debugging
      });

      if (enrichedRecommendations.length >= limit) break;
    } catch (error) {
      console.error(`Failed to process recommendation "${rec.title}":`, error.message);
      continue;
    }
  }

  // Sort by confidence score (descending)
  enrichedRecommendations.sort((a, b) => b.confidence - a.confidence);

  console.log(`Generated ${enrichedRecommendations.length} filtered recommendations`);
  return enrichedRecommendations;
}
