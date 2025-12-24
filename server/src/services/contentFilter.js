/**
 * Content Filter Service
 * Filters inappropriate content based on maturity rating and categories
 */

// Categories/genres that might indicate inappropriate content
const RESTRICTED_CATEGORIES = [
  'erotica',
  'adult',
  'explicit',
  'mature content',
  'adult fiction',
  'adult content',
];

// Keywords in titles/descriptions that might indicate inappropriate content
const RESTRICTED_KEYWORDS = [
  'explicit',
  'erotic',
  'adult only',
  'mature audiences',
];

/**
 * Check if a book should be filtered based on content rating
 * @param {Object} book - Book object with metadata
 * @param {Object} options - Filtering options
 * @param {string} options.maxRating - Maximum allowed maturity rating ('NOT_MATURE', 'MATURE')
 * @param {boolean} options.filterRestrictedCategories - Whether to filter restricted categories
 * @param {boolean} options.filterRestrictedKeywords - Whether to filter restricted keywords
 * @returns {boolean} - true if book should be filtered out, false if it's safe
 */
export function shouldFilterBook(book, options = {}) {
  const {
    maxRating = process.env.MAX_CONTENT_RATING || 'NOT_MATURE', // Default: filter mature content
    filterRestrictedCategories = process.env.FILTER_RESTRICTED_CATEGORIES !== 'false',
    filterRestrictedKeywords = process.env.FILTER_RESTRICTED_KEYWORDS !== 'false',
  } = options;

  // Check maturity rating from Google Books API
  const maturityRating = book?.advancedMetadata?.maturityRating;
  if (maturityRating) {
    // Google Books uses: "NOT_MATURE" or "MATURE"
    if (maxRating === 'NOT_MATURE' && maturityRating === 'MATURE') {
      return true; // Filter out mature content
    }
  }

  // Check categories/genres
  if (filterRestrictedCategories) {
    const allCategories = [
      ...(book.categories || []),
      ...(book.genre || []),
      book.advancedMetadata?.mainCategory || '',
    ]
      .map(c => String(c).toLowerCase())
      .filter(Boolean);

    const hasRestrictedCategory = allCategories.some(cat =>
      RESTRICTED_CATEGORIES.some(restricted =>
        cat.includes(restricted.toLowerCase())
      )
    );

    if (hasRestrictedCategory) {
      return true; // Filter out books with restricted categories
    }
  }

  // Check title and description for restricted keywords
  if (filterRestrictedKeywords) {
    const searchText = [
      book.title || '',
      book.description || '',
      book.advancedMetadata?.subtitle || '',
    ]
      .join(' ')
      .toLowerCase();

    const hasRestrictedKeyword = RESTRICTED_KEYWORDS.some(keyword =>
      searchText.includes(keyword.toLowerCase())
    );

    if (hasRestrictedKeyword) {
      return true; // Filter out books with restricted keywords
    }
  }

  return false; // Book is safe, don't filter
}

/**
 * Filter an array of books based on content rating
 * @param {Array} books - Array of book objects
 * @param {Object} options - Filtering options (same as shouldFilterBook)
 * @returns {Array} - Filtered array of books
 */
export function filterBooks(books, options = {}) {
  if (!Array.isArray(books)) return [];
  
  return books.filter(book => {
    // Handle both { book, confidence } format and plain book objects
    const bookObj = book.book || book;
    return !shouldFilterBook(bookObj, options);
  });
}

/**
 * Get content filter settings from environment or defaults
 * @returns {Object} - Filter configuration
 */
export function getContentFilterSettings() {
  return {
    maxRating: process.env.MAX_CONTENT_RATING || 'NOT_MATURE',
    filterRestrictedCategories: process.env.FILTER_RESTRICTED_CATEGORIES !== 'false',
    filterRestrictedKeywords: process.env.FILTER_RESTRICTED_KEYWORDS !== 'false',
    enabled: process.env.ENABLE_CONTENT_FILTER !== 'false', // Default: enabled
  };
}


