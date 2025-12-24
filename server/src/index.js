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
    
    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    
    if (process.env.NODE_ENV === 'production') {
     
      if (origin && (origin.includes('.onrender.com') || origin.includes('render.com'))) {
        return callback(null, true);
      }
      // Allow specific frontend URL if set (with or without trailing slash)
      if (process.env.FRONTEND_URL) {
        const frontendUrl = process.env.FRONTEND_URL.replace(/\/$/, ''); // Remove trailing slash
        const originUrl = origin.replace(/\/$/, '');
        if (originUrl === frontendUrl) {
          return callback(null, true);
        }
      }
     
      console.warn(`CORS: Blocked origin: ${origin}`);
      return callback(new Error('Not allowed by CORS'));
    }
    
    // Allow all in development
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

connectDB();

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/upload', uploadRouter);
app.use('/api/books', booksRouter);
app.use('/api/prefs', prefsRouter);

const port = process.env.PORT || 4000;
app.listen(port, '0.0.0.0', () => {
  console.log(`API running on port ${port}`);
});
