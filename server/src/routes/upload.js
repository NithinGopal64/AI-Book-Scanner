import { Router } from 'express';
import multer from 'multer';
import { processScanImage } from '../services/agents.js';
import { recommendByMetadata, recommendFromScannedTitles, recommendWithLLM, clearRecommendationCache } from '../services/recommend.js';
import { visionExtractFromBuffer } from '../services/visionExtract.js';
import { filterBooks, getContentFilterSettings, shouldFilterBook } from '../services/contentFilter.js';
import Scan from '../models/Scan.js';
import Book from '../models/Book.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/scan', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Image is required' });
    
    // Clear previously stored books so each scan starts fresh
    // This ensures previous scans don't influence the latest results
    const oldBookIds = (await Book.find({}).select('_id')).map(b => String(b._id));
    await Book.deleteMany({});
    console.log('Cleared previous books from database');
    
    // Clear recommendation cache for old books
    if (oldBookIds.length > 0) {
      clearRecommendationCache(oldBookIds);
    }
    
    // Extract book titles from image first
    const candidates = await visionExtractFromBuffer(req.file.buffer);
    const allScannedTitles = candidates
      .filter(c => c?.title)
      .map(c => c.title)
      .filter(Boolean);

    // Process the image to get full book metadata
    const books = await processScanImage(req.file.buffer);
    
    // Only include titles that were successfully matched to books
    // This ensures "Detected Titles" matches "Your Books"
    const matchedTitles = books.map(b => b.title).filter(Boolean);
    const scannedTitles = matchedTitles.length > 0 ? matchedTitles : allScannedTitles;
    
    // Get recommendations - use LLM-based approach (like the better app)
    // Check if we should use LLM recommendations (default: true)
    const useLLMRecommendations = String(process.env.USE_LLM_RECOMMENDATIONS || 'true').toLowerCase() === 'true';
    
    let recommendations = [];
    let recommendationStats = {
      totalRequested: 5,
      totalFound: 0,
      method: useLLMRecommendations ? 'llm' : 'metadata'
    };
    
    if (useLLMRecommendations && books.length > 0) {
      // NEW: Use LLM-based recommendations with explanations (better approach)
      try {
        const llmRecs = await recommendWithLLM(books, { limit: 5 });
        // LLM recommendations now come pre-enriched with full metadata
        // Flatten structure to match BookCard expectations
        recommendations = llmRecs.map(rec => {
          const bookData = rec.book || {
            title: rec.title,
            authors: [rec.author],
            thumbnail: null,
          };
          return {
            ...(bookData.toObject ? bookData.toObject() : bookData),
            reason: rec.reason,
            confidence: rec.confidence || 0.8,
          };
        });
        recommendationStats.totalFound = recommendations.length;
      } catch (llmError) {
        console.error('LLM recommendation failed, falling back to metadata:', llmError);
        recommendationStats.method = 'metadata_fallback';
        // Fallback to metadata-based
        if (books.length > 0) {
          const results = await recommendByMetadata(books, { limit: 12 });
          recommendations = results.map(({ book, confidence }) => ({
            ...book.toObject ? book.toObject() : book,
            confidence,
            reason: `Similar to books in your collection (${Math.round(confidence * 100)}% match)`,
          }));
        }
        recommendationStats.totalFound = recommendations.length;
      }
    } else {
      // OLD: Use metadata-based recommendations (fallback)
      if (books.length > 0) {
        recommendationStats.method = 'metadata';
        const results = await recommendByMetadata(books, { limit: 12 });
        recommendations = results.map(({ book, confidence }) => ({
          ...book.toObject ? book.toObject() : book,
          confidence,
          reason: `Similar to books in your collection (${Math.round(confidence * 100)}% match)`,
        }));
        recommendationStats.totalFound = recommendations.length;
      } else if (scannedTitles.length > 0) {
        recommendationStats.method = 'scanned_titles';
        const results = await recommendFromScannedTitles(scannedTitles, { limit: 12 });
        recommendations = results.map(({ book, confidence }) => ({
          ...book.toObject ? book.toObject() : book,
          confidence,
          reason: `Based on your scanned titles`,
        }));
        recommendationStats.totalFound = recommendations.length;
      }
    }

    // Get content filter settings (if needed for non-LLM recommendations)
    const filterSettings = getContentFilterSettings();
    
    // Apply content filtering to recommendations
    const recommendationsFiltered = recommendations
      .filter(r => {
        const book = r.book || r;
        // Skip filtering for LLM recommendations (already filtered in prompt)
        if (recommendationStats.method === 'llm') return true;
        
        // Filter inappropriate content for metadata-based recommendations
        if (filterSettings.enabled) {
          const bookObj = book.toObject ? book.toObject() : book;
          if (shouldFilterBook(bookObj, filterSettings)) {
            return false;
          }
        }
        return true;
      })
      .slice(0, recommendationStats.totalRequested);

    // Store the scan with detected titles
    const scan = await Scan.create({ 
      detectedText: scannedTitles, 
      matchedBooks: books.map((b) => b._id) 
    });
    
    const populated = await scan.populate('matchedBooks');
    
    res.json({ 
      scanId: scan._id, 
      scannedTitles,
      matches: populated.matchedBooks, 
      recommendations: recommendationsFiltered,
      stats: {
        ...recommendationStats,
        totalReturned: recommendationsFiltered.length,
        hasLowConfidence: recommendationStats.totalFound < recommendationStats.totalRequested
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'vision or lookup failed', details: e.message });
  }
});

export default router;
