import mongoose from 'mongoose';

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Missing MONGODB_URI');
  }
  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB || 'bookscanner',
  });
  console.log('MongoDB connected');
};

