import { useState, useEffect } from 'react';
import { getFilteredRecommendations, getFilterOptions } from '../api';
import LoadingSpinner from './LoadingSpinner';
import ErrorMessage from './ErrorMessage';
import './RecommendationFilters.css';

function RecommendationFilters({ scannedBooks, onRecommendationsGenerated, alreadyRecommendedBooks = [] }) {
  const [filters, setFilters] = useState({
    authorPreference: 'negative',
    languages: [],
    genres: [],
  });
  
  const [availableOptions, setAvailableOptions] = useState({
    languages: [],
    genres: [],
    authors: [],
  });
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [initialFilters] = useState({
    authorPreference: 'negative',
    languages: [],
    genres: [],
  });

  // Load available filter options
  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        const options = await getFilterOptions();
        setAvailableOptions(options);
      } catch (err) {
        console.error('Failed to load filter options:', err);
      }
    };
    
    loadFilterOptions();
  }, []);

  // Extract options from scanned books as fallback
  useEffect(() => {
    if (scannedBooks && scannedBooks.length > 0) {
      const languages = new Set();
      const genres = new Set();
      
      scannedBooks.forEach(book => {
        if (book.language) languages.add(book.language);
        (book.genre || book.categories || []).forEach(g => {
          if (g) genres.add(g);
        });
      });

      if (languages.size > 0 || genres.size > 0) {
        setAvailableOptions(prev => ({
          ...prev,
          languages: prev.languages.length > 0 ? prev.languages : Array.from(languages).sort(),
          genres: prev.genres.length > 0 ? prev.genres : Array.from(genres).sort(),
        }));
      }
    }
  }, [scannedBooks]);

  // Check if filters have changed
  useEffect(() => {
    const changed = 
      filters.authorPreference !== initialFilters.authorPreference ||
      JSON.stringify(filters.languages.sort()) !== JSON.stringify(initialFilters.languages.sort()) ||
      JSON.stringify(filters.genres.sort()) !== JSON.stringify(initialFilters.genres.sort());
    setHasChanges(changed);
  }, [filters, initialFilters]);

  const handleAuthorPreferenceChange = (value) => {
    setFilters(prev => ({ ...prev, authorPreference: value }));
    setError(null);
  };

  const handleLanguageToggle = (language) => {
    setFilters(prev => {
      const langLower = language.toLowerCase();
      const currentLangs = prev.languages.map(l => l.toLowerCase());
      
      if (currentLangs.includes(langLower)) {
        // Remove language
        return {
          ...prev,
          languages: prev.languages.filter(l => l.toLowerCase() !== langLower),
        };
      } else {
        // Add language (max 4)
        if (prev.languages.length < 4) {
          return {
            ...prev,
            languages: [...prev.languages, language],
          };
        } else {
          setError('Maximum 4 languages can be selected');
          return prev;
        }
      }
    });
  };

  const handleGenreToggle = (genre) => {
    setFilters(prev => {
      const genreTrimmed = genre.trim();
      if (prev.genres.includes(genreTrimmed)) {
        return {
          ...prev,
          genres: prev.genres.filter(g => g !== genreTrimmed),
        };
      } else {
        return {
          ...prev,
          genres: [...prev.genres, genreTrimmed],
        };
      }
    });
    setError(null);
  };

  const handleSelectAllGenres = () => {
    setFilters(prev => ({
      ...prev,
      genres: [...availableOptions.genres],
    }));
    setError(null);
  };

  const handleClearAllGenres = () => {
    setFilters(prev => ({
      ...prev,
      genres: [],
    }));
    setError(null);
  };

  const handleReset = () => {
    setFilters(initialFilters);
    setError(null);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    
    try {
      // Extract book IDs from scanned books
      const scannedBookIds = scannedBooks
        .map(book => book._id || book.id)
        .filter(Boolean);
      
      // Extract titles from already-recommended books to exclude them
      const excludeTitles = alreadyRecommendedBooks
        .map(book => book.title || book.book?.title)
        .filter(Boolean);
      
      const result = await getFilteredRecommendations({
        authorPreference: filters.authorPreference,
        languages: filters.languages,
        genres: filters.genres,
        limit: 5,
        useCache: true,
        scannedBookIds, // Pass scanned book IDs for author preference
        excludeTitles, // Pass already-recommended titles to exclude duplicates
      });
      
      // Recommendations are already in flattened format from backend
      const formattedRecs = result.recommendations;
      
      if (onRecommendationsGenerated) {
        onRecommendationsGenerated(formattedRecs); // Only pass recommendations
      }
    } catch (err) {
      console.error('Failed to generate filtered recommendations:', err);
      setError(err.response?.data?.error || err.message || 'Failed to generate recommendations');
    } finally {
      setIsGenerating(false);
    }
  };

  // Language code to display name mapping
  const languageNames = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'ja': 'Japanese',
    'zh': 'Chinese',
    'ko': 'Korean',
  };

  const getLanguageDisplayName = (code) => {
    return languageNames[code.toLowerCase()] || code.toUpperCase();
  };

  return (
    <div className="recommendation-filters">
      <div className="filters-header">
        <h2 className="filters-title">Customize Recommendations</h2>
        <p className="filters-subtitle">Adjust filters to get personalized book recommendations</p>
      </div>

      {error && <ErrorMessage message={error} />}

      <div className="filters-content">
        {/* Author Preference Toggle */}
        <div className="filter-section">
          <label className="filter-label">Author Preference</label>
          <div className="author-preference-toggle">
            <button
              className={`toggle-button ${filters.authorPreference === 'negative' ? 'active' : ''}`}
              onClick={() => handleAuthorPreferenceChange('negative')}
              disabled={isGenerating}
            >
              Prefer New Authors
            </button>
            <button
              className={`toggle-button ${filters.authorPreference === 'neutral' ? 'active' : ''}`}
              onClick={() => handleAuthorPreferenceChange('neutral')}
              disabled={isGenerating}
            >
              Neutral
            </button>
            <button
              className={`toggle-button ${filters.authorPreference === 'positive' ? 'active' : ''}`}
              onClick={() => handleAuthorPreferenceChange('positive')}
              disabled={isGenerating}
            >
              Prefer Same Authors
            </button>
          </div>
        </div>

        {/* Language Selection */}
        <div className="filter-section">
          <label className="filter-label">
            Languages {filters.languages.length > 0 && (
              <span className="filter-count">({filters.languages.length}/4)</span>
            )}
          </label>
          <div className="language-buttons">
            {availableOptions.languages.slice(0, 10).map(language => {
              const langLower = language.toLowerCase();
              const isSelected = filters.languages.map(l => l.toLowerCase()).includes(langLower);
              
              return (
                <button
                  key={language}
                  className={`language-button ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleLanguageToggle(language)}
                  disabled={isGenerating || (!isSelected && filters.languages.length >= 4)}
                >
                  {getLanguageDisplayName(language)}
                </button>
              );
            })}
          </div>
          {filters.languages.length >= 4 && (
            <p className="filter-hint">Maximum 4 languages selected</p>
          )}
        </div>

        {/* Genre Selection */}
        <div className="filter-section">
          <div className="genre-header">
            <label className="filter-label">
              Genres {filters.genres.length > 0 && (
                <span className="filter-count">({filters.genres.length})</span>
              )}
            </label>
            <div className="genre-controls">
              <button
                className="genre-control-button"
                onClick={handleSelectAllGenres}
                disabled={isGenerating}
              >
                Select All
              </button>
              <button
                className="genre-control-button"
                onClick={handleClearAllGenres}
                disabled={isGenerating}
              >
                Clear All
              </button>
            </div>
          </div>
          <div className="genre-buttons">
            {availableOptions.genres.slice(0, 20).map(genre => {
              const isSelected = filters.genres.includes(genre);
              
              return (
                <button
                  key={genre}
                  className={`genre-button ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleGenreToggle(genre)}
                  disabled={isGenerating}
                >
                  {genre}
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="filter-actions">
          <button
            className="reset-button"
            onClick={handleReset}
            disabled={isGenerating || !hasChanges}
          >
            Reset
          </button>
          <button
            className="generate-button"
            onClick={handleGenerate}
            disabled={isGenerating || !hasChanges}
          >
            {isGenerating ? (
              <>
                <LoadingSpinner size="small" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                <span>Generate New Recommendations</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RecommendationFilters;

