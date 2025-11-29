import { useRef, useState, useEffect } from 'react';
import BookCard from './BookCard';
import './BookCarousel.css';

function BookCarousel({ books, title }) {
  const [scrollPosition, setScrollPosition] = useState(0);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  const carouselRef = useRef(null);
  const scrollContainerRef = useRef(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollLeft = container.scrollLeft;
      const maxScroll = container.scrollWidth - container.clientWidth;
      
      setScrollPosition(scrollLeft);
      setShowLeftArrow(scrollLeft > 0);
      setShowRightArrow(scrollLeft < maxScroll - 10);
    };

    container.addEventListener('scroll', handleScroll);
    handleScroll(); // Initial check

    return () => container.removeEventListener('scroll', handleScroll);
  }, [books]);

  const scroll = (direction) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollAmount = container.clientWidth * 0.8;
    const newPosition = direction === 'left' 
      ? container.scrollLeft - scrollAmount
      : container.scrollLeft + scrollAmount;

    container.scrollTo({
      left: newPosition,
      behavior: 'smooth'
    });
  };

  if (!books || books.length === 0) {
    return null;
  }

  return (
    <section className="book-carousel-section fade-in">
      {title && (
        <h2 className="carousel-title">{title}</h2>
      )}
      <div className="carousel-container" ref={carouselRef}>
        {showLeftArrow && (
          <button 
            className="carousel-arrow carousel-arrow-left"
            onClick={() => scroll('left')}
            aria-label="Scroll left"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
        )}
        
        <div className="carousel-scroll-container" ref={scrollContainerRef}>
          <div className="carousel-content">
            {books.map((book, index) => (
              <div 
                key={book._id || book.title || index} 
                className="carousel-item"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <BookCard book={book} variant="carousel" />
              </div>
            ))}
          </div>
        </div>

        {showRightArrow && (
          <button 
            className="carousel-arrow carousel-arrow-right"
            onClick={() => scroll('right')}
            aria-label="Scroll right"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        )}
      </div>
    </section>
  );
}

export default BookCarousel;

