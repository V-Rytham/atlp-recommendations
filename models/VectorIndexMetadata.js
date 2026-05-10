import mongoose from 'mongoose';

const vectorIndexMetadataSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  status: { type: String, enum: ['building', 'ready', 'failed'], default: 'building' },
  embeddingModel: { type: String, default: '' },
  dimensions: { type: Number, default: 0 },
  bookCount: { type: Number, default: 0 },
  associationCount: { type: Number, default: 0 },
  error: { type: String, default: '' },
  builtAt: { type: Date, default: null },
}, { timestamps: true });

export const VectorIndexMetadata = mongoose.model('VectorIndexMetadata', vectorIndexMetadataSchema);
