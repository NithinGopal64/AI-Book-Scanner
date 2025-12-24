/**
 * Clean ISBN by removing hyphens, spaces, and validating format
 * @param {string} isbn - ISBN string
 * @returns {string|null} Cleaned ISBN or null if invalid
 */
function cleanIsbn(isbn) {
  if (!isbn) return null;
  // Remove hyphens, spaces, and other non-digit characters (except X for ISBN-10)
  const cleaned = String(isbn).replace(/[^\dX]/gi, '').toUpperCase();
  // Validate length (10 or 13 digits, or 9 digits + X)
  if (cleaned.length === 10 || cleaned.length === 13) {
    return cleaned;
  }
  return null;
}

/**
 * Simplify title by removing subtitles, series info, and special characters
 * @param {string} title - Book title
 * @returns {string} Simplified title
 */
function simplifyTitle(title) {
  if (!title) return '';
  
  let simplified = String(title);
  
  // Remove subtitles (text after colon or dash)
  simplified = simplified.split(/[:–—]/)[0].trim();
  
  // Remove series information in parentheses (e.g., "Title (Series #1)")
  simplified = simplified.replace(/\s*\([^)]*\)\s*$/, '').trim();
  
  // Remove series information in brackets
  simplified = simplified.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  
  // Remove special characters that might break searches, but keep spaces
  simplified = simplified.replace(/["'`]/g, '').trim();
  
  // If title is very long, take first 7 meaningful words
  const words = simplified.split(/\s+/);
  if (words.length > 7) {
    simplified = words.slice(0, 7).join(' ');
  }
  
  return simplified.trim();
}

/**
 * Normalize author name for search queries
 * @param {string} author - Author name
 * @returns {string} Normalized author name
 */
function normalizeAuthor(author) {
  if (!author) return '';
  
  let normalized = String(author).trim();
  
  // Handle "Last, First" format - convert to "First Last"
  if (normalized.includes(',')) {
    const parts = normalized.split(',').map(p => p.trim());
    if (parts.length === 2) {
      normalized = `${parts[1]} ${parts[0]}`;
    }
  }
  
  // Remove middle initials (e.g., "John M. Smith" -> "John Smith")
  normalized = normalized.replace(/\s+[A-Z]\.\s+/g, ' ');
  
  // Remove multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  // Take first two words (first name + last name) if multiple words
  const words = normalized.split(/\s+/);
  if (words.length > 2) {
    normalized = words.slice(0, 2).join(' ');
  }
  
  return normalized.trim();
}

/**
 * Clean search query by removing problematic characters
 * Handles edge cases like quotes, special punctuation, and encoding issues
 * @param {string} query - Search query
 * @returns {string} Cleaned query
 */
function cleanSearchQuery(query) {
  if (!query) return '';
  
  let cleaned = String(query);
  
  // Remove curly quotes and smart quotes
  cleaned = cleaned.replace(/[""]/g, '"').replace(/['']/g, "'");
  
  // Remove control characters and zero-width characters
  cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '');
  
  // Replace multiple spaces, tabs, newlines with single space
  cleaned = cleaned.replace(/[\s\t\n\r]+/g, ' ');
  
  // Remove leading/trailing special characters
  cleaned = cleaned.replace(/^[^\w]+|[^\w]+$/g, '');
  
  // For quoted strings, preserve quotes but clean inside
  const hasQuotes = cleaned.includes('"');
  if (hasQuotes) {
    // Keep quoted portions as-is (they're intentional for exact match)
    return cleaned.trim();
  }
  
  // For regular queries, remove problematic characters but keep hyphens
  // Keep: letters, numbers, spaces, hyphens, apostrophes (for names like O'Brien)
  cleaned = cleaned.replace(/[^\w\s'-]/g, ' ');
  
  // Collapse multiple spaces again
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Ensure query is not empty and has at least one alphanumeric character
  if (!cleaned || !/[a-zA-Z0-9]/.test(cleaned)) {
    return '';
  }
  
  return cleaned;
}

/**
 * Build Amazon search URL from a query
 * Handles encoding and edge cases
 * @param {string} query - Search query
 * @returns {string|null} Amazon search URL or null if invalid
 */
function buildAmazonSearchUrl(query) {
  if (!query) return null;
  
  const cleaned = cleanSearchQuery(query);
  if (!cleaned || cleaned.length < 2) return null; // Need at least 2 characters
  
  try {
    // URL encode the query, handling special characters properly
    const encoded = encodeURIComponent(cleaned);
    
    // Ensure encoded query is not too long (Amazon has limits)
    if (encoded.length > 200) {
      // Truncate to first 200 characters of encoded string
      const truncated = cleaned.substring(0, Math.floor(200 / 3)); // Rough estimate
      const truncatedEncoded = encodeURIComponent(truncated);
      return `https://www.amazon.com/s?k=${truncatedEncoded}&i=stripbooks`;
    }
    
    return `https://www.amazon.com/s?k=${encoded}&i=stripbooks`;
  } catch (error) {
    // If encoding fails, try with a more basic approach
    console.warn('Failed to encode Amazon search query:', error);
    return null;
  }
}

/**
 * Generate Amazon purchase link for a book
 * Uses multiple fallback strategies for maximum reliability
 * 
 * @param {Object} book - Book object with title, authors, isbn13, isbn10
 * @returns {string|null} Amazon URL or null if insufficient data
 */
export function generateAmazonLink(book) {
  if (!book) return null;

  const title = book.title;
  const authors = Array.isArray(book.authors) ? book.authors : (book.authors ? [book.authors] : []);
  const author = authors.length > 0 ? authors[0] : '';
  
  const isbn13 = cleanIsbn(book.isbn13);
  const isbn10 = cleanIsbn(book.isbn10);
  const simplifiedTitle = simplifyTitle(title);
  const normalizedAuthor = normalizeAuthor(author);

  // Strategy 1: ISBN-13 search (most specific and reliable)
  if (isbn13) {
    const url = buildAmazonSearchUrl(isbn13);
    if (url) return url;
  }

  // Strategy 2: ISBN-10 search
  if (isbn10) {
    const url = buildAmazonSearchUrl(isbn10);
    if (url) return url;
  }

  // Strategy 3: Full title + author (comprehensive search)
  if (title && author) {
    const fullQuery = `${title} ${normalizedAuthor}`;
    const url = buildAmazonSearchUrl(fullQuery);
    if (url) return url;
  }

  // Strategy 4: Simplified title + normalized author
  if (simplifiedTitle && normalizedAuthor) {
    const query = `${simplifiedTitle} ${normalizedAuthor}`;
    const url = buildAmazonSearchUrl(query);
    if (url) return url;
  }

  // Strategy 5: Title only (simplified) - works when author search fails
  if (simplifiedTitle) {
    const url = buildAmazonSearchUrl(simplifiedTitle);
    if (url) return url;
  }

  // Strategy 6: Original title only (if simplification removed too much)
  if (title) {
    const cleanedTitle = cleanSearchQuery(title);
    if (cleanedTitle) {
      const url = buildAmazonSearchUrl(cleanedTitle);
      if (url) return url;
    }
  }

  // Strategy 7: Author + quoted title (exact match approach)
  if (normalizedAuthor && simplifiedTitle) {
    // Use quotes for exact title match
    const query = `${normalizedAuthor} "${simplifiedTitle}"`;
    const url = buildAmazonSearchUrl(query);
    if (url) return url;
  }

  // Strategy 8: Direct ISBN-13 link (last resort - less reliable)
  if (isbn13) {
    return `https://www.amazon.com/dp/${isbn13}`;
  }

  // Strategy 9: Direct ISBN-10 link (last resort)
  if (isbn10) {
    return `https://www.amazon.com/dp/${isbn10}`;
  }

  // Strategy 10: Author only search (if we have author but no title somehow)
  if (normalizedAuthor) {
    const url = buildAmazonSearchUrl(normalizedAuthor);
    if (url) return url;
  }

  // No sufficient data to generate link
  return null;
}

/**
 * Check if a book has sufficient data for an Amazon link
 * @param {Object} book - Book object
 * @returns {boolean} True if link can be generated
 */
export function hasAmazonLink(book) {
  return generateAmazonLink(book) !== null;
}

