import { Router } from 'express';
import multer from 'multer';
import { processScanImage } from '../services/agents.js';
import { recommendByMetadata, recommendFromScannedTitles } from '../services/recommend.js';
import { visionExtractFromBuffer } from '../services/visionExtract.js';
import Scan from '../models/Scan.js';
import Book from '../models/Book.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/scan', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Image is required' });
    
    // Clear previously stored books so each scan starts fresh
    // This ensures previous scans don't influence the latest results
    await Book.deleteMany({});
    console.log('Cleared previous books from database');
    
    // Extract book titles from image first
    const candidates = await visionExtractFromBuffer(req.file.buffer);
    const scannedTitles = candidates
      .filter(c => c?.title)
      .map(c => c.title)
      .filter(Boolean);

    // Process the image to get full book metadata
    const books = await processScanImage(req.file.buffer);
    
    // Get recommendations based on metadata (genre, categories, etc.)
    // This will find books with similar metadata but different authors/titles
    let recommendations = [];
    if (books.length > 0) {
      // Use metadata-based recommendations when we have processed books
      recommendations = await recommendByMetadata(books, { limit: 12 });
    } else if (scannedTitles.length > 0) {
      // Fallback to scanned titles if books weren't processed yet
      recommendations = await recommendFromScannedTitles(scannedTitles, { limit: 12 });
    }

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
      recommendations 
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'vision or lookup failed', details: e.message });
  }
});

export default router;
