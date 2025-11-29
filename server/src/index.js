import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import uploadRouter from './routes/upload.js';
import booksRouter from './routes/books.js';
import prefsRouter from './routes/prefs.js';

dotenv.config();
const app = express();

// CORS configuration - allow frontend URLs
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173', // Vite default port
  process.env.FRONTEND_URL, // Production frontend URL
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      // In production, you might want to be more strict
      if (process.env.NODE_ENV === 'production') {
        callback(new Error('Not allowed by CORS'));
      } else {
        callback(null, true); // Allow in development
      }
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

connectDB();

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/upload', uploadRouter);
app.use('/api/books', booksRouter);
app.use('/api/prefs', prefsRouter);

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API running on :${port}`);
});
