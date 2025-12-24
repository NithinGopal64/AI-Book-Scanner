import { Router } from 'express';
import multer from 'multer';
import { processScanImage } from '../services/agents.js';
import { recommendByMetadata, recommendFromScannedTitles, recommendWithLLM, clearRecommendationCache } from '../services/recommend.js';
import { visionExtractFromBuffer } from '../services/visionExtract.js';
import { filterBooks, getContentFilterSettings, shouldFilterBook } from '../services/contentFilter.js';
import Scan from '../models/Scan.js';
import Book from '../models/Book.js';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

// Set timeout for the entire request (120 seconds)
router.post('/scan', upload.single('image'), async (req, res) => {
  // Set a timeout for the entire request
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timeout. Processing took too long. Please try again with a smaller image or fewer books.' });
    }
  }, 120000); // 120 seconds

  // Clear timeout if request completes
  const clearTimeoutOnFinish = () => {
    clearTimeout(timeout);
  };

  req.on('close', clearTimeoutOnFinish);
  req.on('aborted', clearTimeoutOnFinish);

  try {
    if (!req.file) {
      clearTimeout(timeout);
      return res.status(400).json({ error: 'Image is required' });
    }

    // Check file size
    if (req.file.size > 10 * 1024 * 1024) {
      clearTimeout(timeout);
      return res.status(413).json({ error: 'Image file is too large. Maximum size is 10MB.' });
    }

    console.log(`[Upload] Processing image: ${req.file.size} bytes, ${req.file.mimetype}`);
    
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
    console.log('[Upload] Extracting book titles from image...');
    const candidates = await visionExtractFromBuffer(req.file.buffer);
    const allScannedTitles = candidates
      .filter(c => c?.title)
      .map(c => c.title)
      .filter(Boolean);
    console.log(`[Upload] Found ${allScannedTitles.length} potential book titles`);

    // Process the image to get full book metadata
    console.log('[Upload] Processing book metadata...');
    const books = await processScanImage(req.file.buffer);
    console.log(`[Upload] Processed ${books.length} books`);
    
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
      console.log('[Upload] Generating LLM recommendations...');
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
    
    clearTimeout(timeout);
    console.log(`[Upload] Successfully processed scan: ${scannedTitles.length} titles, ${books.length} books, ${recommendationsFiltered.length} recommendations`);
    
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
    clearTimeout(timeout);
    console.error('[Upload] Error:', e);
    
    // Check if client disconnected
    if (req.aborted || !res.headersSent) {
      console.log('[Upload] Client disconnected, aborting response');
      return;
    }
    
    // Provide user-friendly error messages
    let errorMessage = 'Failed to process image';
    if (e.message?.includes('timeout') || e.message?.includes('TIMEOUT')) {
      errorMessage = 'Processing timeout. The image may be too large or complex. Please try a smaller image.';
    } else if (e.message?.includes('rate limit') || e.status === 429) {
      errorMessage = 'Service is temporarily busy. Please try again in a moment.';
    } else if (e.message) {
      errorMessage = `Processing error: ${e.message}`;
    }
    
    res.status(500).json({ error: errorMessage, details: process.env.NODE_ENV === 'development' ? e.message : undefined });
  }
});

export default router;
