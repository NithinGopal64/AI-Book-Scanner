import BookCard from './BookCard';
import './BookGrid.css';

function BookGrid({ books }) {
  if (!books || books.length === 0) {
    return (
      <div className="empty-state">
        <p>No books found.</p>
      </div>
    );
  }

  return (
    <div className="book-grid">
      {books.map((book) => (
        <BookCard key={book._id || book.title} book={book} />
      ))}
    </div>
  );
}

export default BookGrid;

