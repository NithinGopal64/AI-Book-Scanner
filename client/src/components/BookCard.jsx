import { useState, useEffect } from 'react';
import './BookCard.css';

function BookCard({ book, variant = 'grid' }) {
  const [isHovered, setIsHovered] = useState(false);
  const [showFullDescription, setShowFullDescription] = useState(false);
  
  // Reset expanded description when hover ends
  useEffect(() => {
    if (!isHovered) {
      setShowFullDescription(false);
    }
  }, [isHovered]);
  const authors = book.authors || [];
  const genres = book.genre || book.categories || [];
  const year = book.publicationYear;
  const description = book.description || 'No description available.';
  const rating = book.advancedMetadata?.averageRating;
  const ratingsCount = book.advancedMetadata?.ratingsCount;

  return (
    <div 
      className={`book-card book-card-${variant}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="book-cover-wrapper">
        {book.thumbnail ? (
          <div className="book-cover">
            <img src={book.thumbnail} alt={book.title} loading="lazy" />
            <div className="book-cover-overlay"></div>
          </div>
        ) : (
          <div className="book-cover book-cover-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
        )}
        
        {variant === 'carousel' && (
          <div className={`book-hover-details ${isHovered ? 'visible' : ''}`}>
            <div className="hover-details-content">
              <h3 className="hover-title">{book.title || 'Untitled'}</h3>
              
              {authors.length > 0 && (
                <p className="hover-authors">by {authors.join(', ')}</p>
              )}

              {rating && (
                <div className="hover-rating">
                  <span className="rating-stars">
                    {'★'.repeat(Math.round(rating))}
                    {'☆'.repeat(5 - Math.round(rating))}
                  </span>
                  <span className="rating-value">{rating.toFixed(1)}</span>
                  {ratingsCount && (
                    <span className="rating-count">({ratingsCount.toLocaleString()})</span>
                  )}
                </div>
              )}

              {/* Show recommendation reason if available (LLM recommendations) */}
              {book.reason && (
                <div className="hover-reason" style={{ 
                  padding: '8px', 
                  background: 'rgba(59, 130, 246, 0.1)', 
                  borderRadius: '4px', 
                  marginBottom: '8px',
                  fontSize: '0.875rem',
                  color: '#93c5fd'
                }}>
                  <strong>💡 Why we recommend:</strong> {book.reason}
                </div>
              )}

              {description && (
                <div className="hover-description-container">
                  <p className="hover-description">
                    {!showFullDescription && description.length > 500
                      ? description.substring(0, 500) + '...'
                      : description}
                  </p>
                  {description.length > 500 && (
                    <button
                      className="read-more-button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowFullDescription(!showFullDescription);
                      }}
                    >
                      {showFullDescription ? 'Show Less' : 'Read More'}
                    </button>
                  )}
                </div>
              )}

              <div className="hover-meta">
                {year && <span className="hover-meta-item">{year}</span>}
                {book.pageCount && <span className="hover-meta-item">{book.pageCount} pages</span>}
                {genres.length > 0 && (
                  <div className="hover-genres">
                    {genres.slice(0, 2).map((genre, index) => (
                      <span key={index} className="hover-genre-tag">{genre}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      
      <div className="book-info">
        <h3 className="book-title">{book.title || 'Untitled'}</h3>
        
        {authors.length > 0 && (
          <p className="book-authors">
            {authors.join(', ')}
          </p>
        )}

        {/* Show recommendation reason for recommendations */}
        {book.reason && (
          <p className="book-reason" style={{ 
            fontSize: '0.75rem', 
            color: '#60a5fa', 
            fontStyle: 'italic',
            marginTop: '4px'
          }}>
            {book.reason}
          </p>
        )}

        {variant === 'grid' && (
          <>
            {rating && (
              <div className="book-rating">
                <span className="rating-stars">
                  {'★'.repeat(Math.round(rating))}
                  {'☆'.repeat(5 - Math.round(rating))}
                </span>
                <span className="rating-value">{rating.toFixed(1)}</span>
              </div>
            )}

            {genres.length > 0 && (
              <div className="book-genres">
                {genres.slice(0, 2).map((genre, index) => (
                  <span key={index} className="genre-tag">{genre}</span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default BookCard;
