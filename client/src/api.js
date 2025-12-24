import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Upload an image and scan for books
 * @param {File} imageFile - The image file to upload
 * @returns {Promise} Response with scanId, scannedTitles, matches, and recommendations
 */
export const uploadScan = async (imageFile) => {
  const formData = new FormData();
  formData.append('image', imageFile);
  
  const response = await api.post('/upload/scan', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  
  return response.data;
};

/**
 * Get all books with optional filters
 * @param {Object} filters - Filter options (genre, series, author, year, limit, skip)
 * @returns {Promise} Array of books
 */
export const getBooks = async (filters = {}) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, value);
    }
  });
  
  const response = await api.get(`/books?${params.toString()}`);
  return response.data;
};

/**
 * Get a single book by ID
 * @param {string} bookId - The book ID
 * @returns {Promise} Book object
 */
export const getBook = async (bookId) => {
  const response = await api.get(`/books/${bookId}`);
  return response.data;
};

/**
 * Get recommendations based on preferences
 * @param {Object} prefs - Preferences object with likes and dislikes arrays
 * @returns {Promise} Array of recommended books
 */
export const getRecommendations = async (prefs = {}) => {
  const { likes = [], dislikes = [] } = prefs;
  const params = new URLSearchParams();
  
  if (likes.length > 0) params.append('likes', likes.join(','));
  if (dislikes.length > 0) params.append('dislikes', dislikes.join(','));
  
  const response = await api.get(`/books/recommendations?${params.toString()}`);
  return response.data;
};

/**
 * Get recommendations from scanned titles
 * @param {string[]} titles - Array of book titles
 * @returns {Promise} Array of recommended books
 */
export const getRecommendationsFromTitles = async (titles) => {
  const response = await api.post('/books/recommendations/from-titles', { titles });
  return response.data;
};

/**
 * Get filtered recommendations based on user-selected filters
 * @param {Object} filters - Filter options { authorPreference, languages, genres, limit }
 * @returns {Promise} Object with recommendations array and applied filters
 */
export const getFilteredRecommendations = async (filters) => {
  const response = await api.post('/books/recommendations/filtered', filters);
  return response.data;
};

/**
 * Get available filter options (languages, genres, authors) from scanned books
 * @returns {Promise} Object with languages, genres, and authors arrays
 */
export const getFilterOptions = async () => {
  const response = await api.get('/books/filter-options');
  return response.data;
};

/**
 * Check API health
 * @returns {Promise} Health status
 */
export const checkHealth = async () => {
  const response = await api.get('/health');
  return response.data;
};

export default api;

