import mongoose from 'mongoose';

const bookSchema = new mongoose.Schema(
  {
    title: String,
    authors: [String],
    categories: [String],
    description: String,
    isbn10: String,
    isbn13: String,
    thumbnail: String,
    embedding: { type: [Number], index: false },
    source: { type: String, default: 'openlibrary' },
  },
  { timestamps: true }
);

export default mongoose.model('Book', bookSchema);

