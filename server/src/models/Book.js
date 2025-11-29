import mongoose from 'mongoose';

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, index: true },
    authors: [String],
    categories: [String],
    genre: [String], // Specific genre tags
    description: String,
    series: {
      name: String,
      number: Number, // Book number in series
    },
    publicationYear: Number,
    pageCount: Number,
    publisher: String,
    isbn10: String,
    isbn13: String,
    thumbnail: String,
    language: String,
    // Advanced metadata
    advancedMetadata: {
      averageRating: Number,
      ratingsCount: Number,
      maturityRating: String, // e.g., "NOT_MATURE", "MATURE"
      printType: String, // e.g., "BOOK"
      previewLink: String,
      infoLink: String,
      canonicalVolumeLink: String,
      subtitle: String,
      publishedDate: String, // Full date string
      industryIdentifiers: {
        type: [
          {
            identifierType: { type: String }, // e.g., "ISBN_13", "ISBN_10"
            identifier: String,
          },
        ],
        default: [],
      },
      dimensions: {
        height: String,
        width: String,
        thickness: String,
      },
      mainCategory: String,
      contentVersion: String,
      imageLinks: {
        smallThumbnail: String,
        thumbnail: String,
        small: String,
        medium: String,
        large: String,
        extraLarge: String,
      },
    },
    embedding: { type: [Number], index: false },
    source: { type: String, default: 'googlebooks' }, // Changed default to googlebooks
  },
  { timestamps: true }
);

// Index for faster searches
bookSchema.index({ title: 1, authors: 1 });
bookSchema.index({ 'series.name': 1 });
bookSchema.index({ genre: 1 });
bookSchema.index({ publicationYear: 1 });

export default mongoose.model('Book', bookSchema);

