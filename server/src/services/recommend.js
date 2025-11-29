import Book from '../models/Book.js';
import { lookupSimilarBooks, lookupBookMetadata } from './lookup.js';
import { embedText, embedAndUpsert } from './embeddings.js';

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

export async function recommendByQueryEmbedding(queryEmbedding, { limit = 12, excludeIds = [] } = {}) {
  const normalizedExclude = excludeIds
    .map((id) => (id && id._id ? id._id : id))
    .filter(Boolean);
  const query = normalizedExclude.length ? { _id: { $nin: normalizedExclude } } : {};
  const books = await Book.find(query);
  const scored = books.map((b) => ({ book: b, score: cosine(queryEmbedding, b.embedding) }));
  const seen = new Set();
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.book)
    .filter((book) => {
      const key = book?._id ? String(book._id) : undefined;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
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
  let recs = await recommendByQueryEmbedding(seedEmbedding, { limit: limit * 2, excludeIds });
  const normalize = (title) => String(title || '').trim().toLowerCase();
  const seenTitles = new Set(seedTitles);
  const primary = [];
  recs.forEach((b) => {
    const key = normalize(b?.title);
    if (!key || seenTitles.has(key)) return;
    seenTitles.add(key);
    primary.push(b);
  });
  if (primary.length >= limit) return primary.slice(0, limit);

  const fallbackNeeded = limit - primary.length;
  const fallback = [];
  for (const seed of books) {
    if (fallback.length >= fallbackNeeded) break;
    const similar = await lookupSimilarBooks(seed, { limit: fallbackNeeded * 2 });
    for (const meta of similar) {
      const key = normalize(meta?.title);
      if (!key || seenTitles.has(key)) continue;
      seenTitles.add(key);
      fallback.push(meta);
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
    return await recommendFromSeedBooks(books, { limit });
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
    return await recommendFromSeedBooks(books, { limit });
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

  // Convert to Book documents (upsert to get embeddings)
  const recommendedBooks = [];
  for (const { meta } of topCandidates) {
    if (recommendedBooks.length >= limit) break;
    try {
      const book = await embedAndUpsert(meta);
      // Double-check we're not including scanned books
      const bookTitle = String(book.title || '').toLowerCase();
      const bookAuthors = (book.authors || []).map(a => String(a).toLowerCase());
      if (!excludeTitles.has(bookTitle) && !bookAuthors.some(a => excludeAuthors.has(a))) {
        recommendedBooks.push(book);
      }
    } catch (e) {
      console.error(`Failed to upsert recommended book:`, e.message);
    }
  }

  // If we don't have enough, supplement with embedding-based recommendations
  if (recommendedBooks.length < limit) {
    const excludeIds = [...books.map(b => b._id), ...recommendedBooks.map(b => b._id)];
    const seedEmbedding = averageEmbeddingFromBooks(books);
    if (seedEmbedding.length > 0) {
      const embeddingRecs = await recommendByQueryEmbedding(seedEmbedding, { 
        limit: limit - recommendedBooks.length, 
        excludeIds 
      });
      // Filter out same authors/titles
      const filtered = embeddingRecs.filter(book => {
        const bookTitle = String(book.title || '').toLowerCase();
        const bookAuthors = (book.authors || []).map(a => String(a).toLowerCase());
        return !excludeTitles.has(bookTitle) && !bookAuthors.some(a => excludeAuthors.has(a));
      });
      recommendedBooks.push(...filtered);
    }
  }

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
  return await recommendByQueryEmbedding(queryEmbedding, { limit });
}
