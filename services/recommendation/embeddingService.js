import { config } from '../../config/recommendations.js';
import { l2Normalize } from './math.js';
import { tokenize } from './text.js';

let extractorPromise = null;

const hashToken = (token) => {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const deterministicHashEmbedding = (text, dimensions = config.embeddingDimensions) => {
  const vector = new Array(dimensions).fill(0);
  for (const token of tokenize(text)) {
    const hash = hashToken(token);
    const index = hash % dimensions;
    const sign = hash & 1 ? 1 : -1;
    vector[index] += sign / Math.sqrt(Math.max(1, token.length));
  }
  return l2Normalize(vector);
};

const getExtractor = async () => {
  if (!config.enableLocalEmbeddings) return null;
  if (!extractorPromise) {
    extractorPromise = import('@huggingface/transformers').then(async ({ env, pipeline }) => {
      env.allowRemoteModels = true;
      env.allowLocalModels = true;
      return pipeline('feature-extraction', config.embeddingModel);
    });
  }
  return extractorPromise;
};

export const embedText = async (text) => {
  const normalized = String(text || '').trim();
  if (!normalized) return deterministicHashEmbedding('empty book metadata');

  try {
    const extractor = await getExtractor();
    if (!extractor) return deterministicHashEmbedding(normalized);
    const output = await extractor(normalized, { pooling: 'mean', normalize: true });
    return l2Normalize(Array.from(output.data, Number));
  } catch (error) {
    console.warn('[EMBEDDINGS] Falling back to deterministic hash embedding:', error?.message || error);
    return deterministicHashEmbedding(normalized);
  }
};
