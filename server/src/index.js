import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import uploadRouter from './routes/upload.js';
import booksRouter from './routes/books.js';
import prefsRouter from './routes/prefs.js';

dotenv.config();
const app = express();
app.use(cors());
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
