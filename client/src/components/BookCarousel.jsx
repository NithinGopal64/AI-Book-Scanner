import { useRef, useState, useEffect } from 'react';
import BookCard from './BookCard';
import './BookCarousel.css';

function BookCarousel({ books, title }) {
  const [scrollPosition, setScrollPosition] = useState(0);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const carouselRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isDragging = useRef(false);

  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768 || 'ontouchstart' in window);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

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

  // Touch event handlers for swipe gestures
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = false;
  };

  const handleTouchMove = (e) => {
    if (!touchStartX.current || !touchStartY.current) return;
    
    const touchX = e.touches[0].clientX;
    const touchY = e.touches[0].clientY;
    const diffX = touchStartX.current - touchX;
    const diffY = touchStartY.current - touchY;
    
    // Determine if this is a horizontal swipe
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
      isDragging.current = true;
      e.preventDefault(); // Prevent scrolling while swiping
    }
  };

  const handleTouchEnd = (e) => {
    if (!touchStartX.current || !isDragging.current) {
      touchStartX.current = 0;
      touchStartY.current = 0;
      return;
    }

    const touchEndX = e.changedTouches[0].clientX;
    const diffX = touchStartX.current - touchEndX;
    const container = scrollContainerRef.current;
    
    if (!container) return;

    // Swipe threshold: 50px
    if (Math.abs(diffX) > 50) {
      const scrollAmount = container.clientWidth * 0.8;
      if (diffX > 0) {
        // Swipe left - scroll right
        scroll('right');
      } else {
        // Swipe right - scroll left
        scroll('left');
      }
    }

    touchStartX.current = 0;
    touchStartY.current = 0;
    isDragging.current = false;
  };

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
        {showLeftArrow && !isMobile && (
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
        
        <div 
          className="carousel-scroll-container" 
          ref={scrollContainerRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
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

        {showRightArrow && !isMobile && (
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

