import { Router } from 'express';
import mongoose from 'mongoose';
import { buildRecQueryFromPrefs } from '../services/agents.js';
import { recommendByQueryEmbedding, recommendFromScannedTitles, recommendWithLLM, recommendWithLLMAndFilters, getAvailableFilterOptions } from '../services/recommend.js';
import { filterBooks, getContentFilterSettings } from '../services/contentFilter.js';
import Book from '../models/Book.js';

const { Types } = mongoose;

const router = Router();

// Get recommendations based on user preferences 
router.get('/recommendations', async (req, res) => {
  try {
    const likes = String(req.query.likes || '').split(',').filter(Boolean);
    const dislikes = String(req.query.dislikes || '').split(',').filter(Boolean);
    const emb = await buildRecQueryFromPrefs({ likes, dislikes });
    const recs = await recommendByQueryEmbedding(emb, { limit: 12 });
    res.json(recs);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'recommendation failed', details: e.message });
  }
});

// Get recommendations based on scanned book titles
router.post('/recommendations/from-titles', async (req, res) => {
  try {
    const { titles } = req.body;
    if (!titles || !Array.isArray(titles) || titles.length === 0) {
      return res.status(400).json({ error: 'titles array is required' });
    }
    const recs = await recommendFromScannedTitles(titles, { limit: 12 });
    res.json(recs);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'recommendation failed', details: e.message });
  }
});

// Get LLM-based recommendations with explanations 
router.get('/recommendations/llm', async (req, res) => {
  try {
    // Get all books from database (scanned books)
    const books = await Book.find({}).limit(50).sort({ createdAt: -1 });
    
    if (!books || books.length === 0) {
      return res.json({ recommendations: [] });
    }

    const limit = parseInt(req.query.limit) || 5;
    const recommendations = await recommendWithLLM(books, { limit });
    
    res.json({ recommendations });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'recommendation failed', details: e.message });
  }
});

// Get filtered recommendations with user-selected filters
router.post('/recommendations/filtered', async (req, res) => {
  try {
    const {
      authorPreference = 'negative',
      languages = [],
      genres = [],
      limit = 5,
      useCache = true,
      scannedBookIds = [], // IDs of books from the current scan
      excludeTitles = [], // Titles of already recommended books to exclude
    } = req.body;

    // Validate filters
    if (languages.length > 4) {
      return res.status(400).json({ error: 'Maximum 4 languages allowed' });
    }

    if (!['positive', 'negative', 'neutral'].includes(authorPreference)) {
      return res.status(400).json({ error: 'authorPreference must be positive, negative, or neutral' });
    }

    // Use scanned book IDs if provided, otherwise fall back to all books 
    let books;
    if (scannedBookIds && scannedBookIds.length > 0) {
      // Convert string IDs to ObjectIds 
      const validIds = scannedBookIds
        .filter(id => Types.ObjectId.isValid(id))
        .map(id => new Types.ObjectId(id));
      
      if (validIds.length > 0) {
        // Use only the scanned books for preference analysis
        books = await Book.find({ _id: { $in: validIds } });
      } else {
        // If IDs are invalid, fall back to all books
        books = await Book.find({}).limit(50).sort({ createdAt: -1 });
      }
    } else {
      // Fallback: use all books from database (scanned books)
      books = await Book.find({}).limit(50).sort({ createdAt: -1 });
    }
    
    if (!books || books.length === 0) {
      return res.json({ recommendations: [], filters: req.body, cached: false });
    }

    const filters = {
      authorPreference,
      languages: Array.isArray(languages) ? languages.map(l => String(l).toLowerCase().trim()) : [],
      genres: Array.isArray(genres) ? genres.map(g => String(g).trim()) : [],
      useCache,
    };

    const recommendations = await recommendWithLLMAndFilters(books, filters, { 
      limit,
      excludeTitles: Array.isArray(excludeTitles) ? excludeTitles : [],
    });
    
    res.json({
      recommendations,
      filters,
      cached: false, // TODO: Track cache hits if needed
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'recommendation failed', details: e.message });
  }
});

// Get available filter options from scanned books
router.get('/filter-options', async (req, res) => {
  try {
    const books = await Book.find({}).limit(50).sort({ createdAt: -1 });
    const options = getAvailableFilterOptions(books);
    res.json(options);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to get filter options', details: e.message });
  }
});

// Get all books with full metadata
router.get('/', async (req, res) => {
  try {
    const { limit = 50, skip = 0, genre, series, author, year } = req.query;
    const query = {};
    
    if (genre) query.genre = { $in: [genre] };
    if (series) query['series.name'] = { $regex: new RegExp(series, 'i') };
    if (author) query.authors = { $in: [new RegExp(author, 'i')] };
    if (year) query.publicationYear = parseInt(year);
    
    const books = await Book.find(query)
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .sort({ createdAt: -1 });
    
    // Apply content filtering
    const filterSettings = getContentFilterSettings();
    const filteredBooks = filterSettings.enabled 
      ? filterBooks(books, filterSettings)
      : books;
    
    res.json(filteredBooks);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to fetch books', details: e.message });
  }
});

// Get a single book by ID
router.get('/:id', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ error: 'Book not found' });
    }
    res.json(book);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to fetch book', details: e.message });
  }
});

export default router;

