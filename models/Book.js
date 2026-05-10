import mongoose from 'mongoose';

const bookSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, index: true },
  author: { type: String, required: true, trim: true, index: true },
  description: { type: String, default: '' },
  coverImage: { type: String, default: '' },
  genres: { type: [String], default: [], index: true },
  subjects: { type: [String], default: [] },
  themes: { type: [String], default: [] },
  emotionalTones: { type: [String], default: [] },
  source: { type: String, required: true, index: true },
  sourceId: { type: String, required: true, index: true },
  canonicalKey: { type: String, required: true, unique: true, index: true },
  popularity: { type: Number, default: 0, index: true },
  rating: { type: Number, default: 0 },
  embeddingText: { type: String, default: '' },
  embedding: { type: [Number], default: undefined, select: false },
  embeddingModel: { type: String, default: '' },
  gutenbergId: { type: Number, default: null, index: true },
  metadataQuality: { type: Number, default: 0, index: true },
  lastAccessedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

bookSchema.index({ source: 1, sourceId: 1 }, { unique: true });
bookSchema.index({ genres: 1, metadataQuality: -1, popularity: -1 });
bookSchema.index({ canonicalKey: 1, metadataQuality: -1 });

export const Book = mongoose.model('Book', bookSchema);
