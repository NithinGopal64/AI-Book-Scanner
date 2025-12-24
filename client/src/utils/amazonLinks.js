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
 * Generate Amazon purchase link for a book
 * Uses search links as primary method (more reliable) with ISBN as fallback
 * 
 * @param {Object} book - Book object with title, authors, isbn13, isbn10
 * @returns {string|null} Amazon URL or null if insufficient data
 */
export function generateAmazonLink(book) {
  if (!book) return null;

  const title = book.title;
  const authors = Array.isArray(book.authors) ? book.authors : (book.authors ? [book.authors] : []);
  const author = authors.length > 0 ? authors[0] : '';

  // Priority 1: Use search link with title and author (most reliable)
  // This works better than ISBN links which often return 404
  if (title) {
    // Build search query - prefer ISBN if available for better results
    let searchQuery = '';
    
    // Try ISBN-13 first in search (more specific)
    const isbn13 = cleanIsbn(book.isbn13);
    if (isbn13) {
      searchQuery = isbn13;
    } else {
      // Try ISBN-10
      const isbn10 = cleanIsbn(book.isbn10);
      if (isbn10) {
        searchQuery = isbn10;
      } else {
        // Fallback to title + author
        searchQuery = title;
        if (author) {
          searchQuery += ` ${author}`;
        }
      }
    }
    
    // URL encode the search query
    const encodedQuery = encodeURIComponent(searchQuery.trim());
    return `https://www.amazon.com/s?k=${encodedQuery}&i=stripbooks`;
  }

  // Fallback: Try ISBN direct link (less reliable, but worth trying)
  const isbn13 = cleanIsbn(book.isbn13);
  if (isbn13) {
    return `https://www.amazon.com/dp/${isbn13}`;
  }

  const isbn10 = cleanIsbn(book.isbn10);
  if (isbn10) {
    return `https://www.amazon.com/dp/${isbn10}`;
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

