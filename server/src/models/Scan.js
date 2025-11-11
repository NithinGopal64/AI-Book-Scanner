import mongoose from 'mongoose';

const scanSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    detectedText: [String],
    matchedBooks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Book' }],
    imageMeta: { w: Number, h: Number },
  },
  { timestamps: true }
);

export default mongoose.model('Scan', scanSchema);

