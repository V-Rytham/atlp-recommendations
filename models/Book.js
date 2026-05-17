import mongoose from 'mongoose';

const bookSchema = new mongoose.Schema({
  title: { type: String, required: true },
  author: { type: String, required: true },
  gutenbergId: {
    type: Number,
    required: true,
    unique: true,
    index: true,
  },
  lastAccessedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

bookSchema.index({ title: 1 });
bookSchema.index({ lastAccessedAt: -1 });

export const Book = mongoose.model('Book', bookSchema);
