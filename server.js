import dotenv from 'dotenv';
import mongoose from 'mongoose';

import app from './app.js';
import { config } from './config/recommendations.js';
import { loadVectorIndex } from './services/recommendation/vectorIndex.js';

dotenv.config();

const connectMongo = async () => {
  if (!config.mongoUri) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 10),
  });
  console.info('[MONGO] Connected.');
};

const start = async () => {
  await connectMongo();
  loadVectorIndex().catch((error) => {
    console.warn('[VECTOR_INDEX] Initial in-memory load skipped:', error?.message || error);
  });

  app.listen(config.port, () => {
    console.info(`[SERVER] Recommendation service listening on port ${config.port}.`);
  });
};

start().catch((error) => {
  console.error('[SERVER] Failed to start:', error?.stack || error);
  process.exit(1);
});
