import mongoose from 'mongoose';

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Missing MONGODB_URI');
  }
  
  // Trim whitespace
  const trimmedUri = uri.trim();
  
  try {
    await mongoose.connect(trimmedUri, {
      dbName: process.env.MONGODB_DB || 'bookscanner',
      // SSL/TLS options to fix connection errors
      ssl: true,
      tls: true,
      // Connection pool options
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    throw new Error(`Failed to connect to MongoDB: ${error.message}`);
  }
};

