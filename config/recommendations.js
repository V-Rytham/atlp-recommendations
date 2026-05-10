import dotenv from 'dotenv';

dotenv.config();

export const config = {
  mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || '',
  port: Number(process.env.PORT || 3000),
  adminIndexToken: String(process.env.ADMIN_INDEX_TOKEN || '').trim(),
  allowAdminIndexBuild: String(process.env.ALLOW_ADMIN_INDEX_BUILD || 'false').toLowerCase() === 'true',
  embeddingModel: process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2',
  embeddingDimensions: Number(process.env.EMBEDDING_DIMENSIONS || 384),
  embeddingBatchSize: Number(process.env.EMBEDDING_BATCH_SIZE || 16),
  vectorCandidateLimit: Number(process.env.VECTOR_CANDIDATE_LIMIT || 7500),
  defaultLimit: Number(process.env.DEFAULT_RECOMMENDATION_LIMIT || 24),
  maxLimit: Number(process.env.MAX_RECOMMENDATION_LIMIT || 50),
  curatedCollectionSize: Number(process.env.CURATED_COLLECTION_SIZE || 50),
  enableLocalEmbeddings: String(process.env.DISABLE_LOCAL_EMBEDDINGS || 'false').toLowerCase() !== 'true',
};
