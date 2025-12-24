/**
 * Generate Amazon purchase link for a book using the ISBN-13 or ISBN-10
 * 
 * @param {Object} book - Book object with title, authors, isbn13, isbn10
 * @returns {string|null} Amazon URL or null if insufficient data
 */
export function generateAmazonLink(book) {
  if (!book) return null;

  // Priority 1: Use ISBN-13 for direct product link
  if (book.isbn13) {
    // Remove any hyphens from ISBN
    const cleanIsbn = book.isbn13.replace(/-/g, '');
    if (cleanIsbn.length === 13) {
      return `https://www.amazon.com/dp/${cleanIsbn}`;
    }
  }

  // Priority 2: Use ISBN-10 for direct product link
  if (book.isbn10) {
    // Remove any hyphens from ISBN
    const cleanIsbn = book.isbn10.replace(/-/g, '');
    if (cleanIsbn.length === 10) {
      return `https://www.amazon.com/dp/${cleanIsbn}`;
    }
  }

  // Priority 3: Use search link with title and author
  const title = book.title;
  const authors = Array.isArray(book.authors) ? book.authors : (book.authors ? [book.authors] : []);
  const author = authors.length > 0 ? authors[0] : '';

  if (title) {
    // Build search query
    let searchQuery = title;
    if (author) {
      searchQuery += ` ${author}`;
    }
    
    // URL encode the search query
    const encodedQuery = encodeURIComponent(searchQuery);
    return `https://www.amazon.com/s?k=${encodedQuery}`;
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

