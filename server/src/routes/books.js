import { Router } from 'express';
import { buildRecQueryFromPrefs } from '../services/agents.js';
import { recommendByQueryEmbedding, recommendFromScannedTitles } from '../services/recommend.js';
import Book from '../models/Book.js';

const router = Router();

// Get recommendations based on user preferences (likes/dislikes)
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
    
    res.json(books);
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

