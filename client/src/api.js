import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

// Create axios instance with default timeout (30 seconds for normal requests)
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds default timeout
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for better error tracking
api.interceptors.request.use(
  (config) => {
    // Log request in development
    if (import.meta.env.DEV) {
      console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for better error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle network errors
    if (!error.response) {
      if (error.code === 'ECONNABORTED') {
        error.userMessage = 'Request timed out. The server may be slow or unreachable. Please try again.';
      } else if (error.message === 'Network Error') {
        error.userMessage = 'Network error. Please check your connection and try again.';
      } else {
        error.userMessage = 'Unable to connect to server. Please try again later.';
      }
    } else {
      // Handle HTTP errors
      const status = error.response.status;
      if (status === 500) {
        error.userMessage = 'Server error. Please try again later.';
      } else if (status === 504 || status === 503) {
        error.userMessage = 'Server is temporarily unavailable. Please try again in a moment.';
      } else if (status === 413) {
        error.userMessage = 'Image file is too large. Please use a smaller image.';
      } else {
        error.userMessage = error.response?.data?.error || `Error: ${status}`;
      }
    }
    return Promise.reject(error);
  }
);

// Retry logic for failed requests
async function retryRequest(requestFn, retries = 2, delay = 1000) {
  try {
    return await requestFn();
  } catch (error) {
    if (retries > 0 && (!error.response || error.response.status >= 500 || error.code === 'ECONNABORTED')) {
      // Retry on server errors or timeouts
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryRequest(requestFn, retries - 1, delay * 2);
    }
    throw error;
  }
}

/**
 * Upload an image and scan for books
 * @param {File} imageFile - The image file to upload
 * @returns {Promise} Response with scanId, scannedTitles, matches, and recommendations
 */
export const uploadScan = async (imageFile) => {
  const formData = new FormData();
  formData.append('image', imageFile);
  
  // Use longer timeout for uploads (120 seconds) since recommendations can take time
  const response = await retryRequest(() => 
    api.post('/upload/scan', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 120000, // 120 seconds for upload + processing
    })
  );
  
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
  // Use longer timeout for recommendation requests (90 seconds)
  const response = await retryRequest(() =>
    api.post('/books/recommendations/filtered', filters, {
      timeout: 90000, // 90 seconds for recommendation generation
    })
  );
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
  const response = await api.get('/health', {
    timeout: 5000, // 5 seconds for health check
  });
  return response.data;
};

/**
 * Check if API is reachable (for connection status)
 * @returns {Promise<boolean>} True if API is reachable
 */
export const checkConnection = async () => {
  try {
    await checkHealth();
    return true;
  } catch (error) {
    return false;
  }
};

export default api;

