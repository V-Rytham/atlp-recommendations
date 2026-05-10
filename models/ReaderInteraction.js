import mongoose from 'mongoose';

const readerInteractionSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  bookKey: { type: String, required: true, index: true },
  source: { type: String, default: '' },
  sourceId: { type: String, default: '' },
  eventType: { type: String, enum: ['read', 'currently_reading', 'saved', 'rated', 'finished'], default: 'read', index: true },
  weight: { type: Number, default: 1 },
  occurredAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

readerInteractionSchema.index({ userId: 1, bookKey: 1, eventType: 1 }, { unique: true });

export const ReaderInteraction = mongoose.model('ReaderInteraction', readerInteractionSchema);
