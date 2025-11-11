import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true },
    name: String,
    likes: [String],
    dislikes: [String],
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);

