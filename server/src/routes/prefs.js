import { Router } from 'express';
import User from '../models/User.js';

const router = Router();

router.post('/upsert', async (req, res) => {
  const { email, name, likes = [], dislikes = [] } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const user = await User.findOneAndUpdate(
    { email },
    { name, likes, dislikes },
    { upsert: true, new: true }
  );
  res.json(user);
});

export default router;

