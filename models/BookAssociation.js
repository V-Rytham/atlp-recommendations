import mongoose from 'mongoose';

const bookAssociationSchema = new mongoose.Schema({
  bookKey: { type: String, required: true, index: true },
  recommendedBookKey: { type: String, required: true, index: true },
  weight: { type: Number, required: true, index: true },
  support: { type: Number, default: 0 },
  confidence: { type: Number, default: 0 },
}, { timestamps: true });

bookAssociationSchema.index({ bookKey: 1, recommendedBookKey: 1 }, { unique: true });
bookAssociationSchema.index({ bookKey: 1, weight: -1 });

export const BookAssociation = mongoose.model('BookAssociation', bookAssociationSchema);
