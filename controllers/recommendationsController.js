import { recommendCollaborativeBooks, recommendForLibrary, recommendSimilarBooks } from '../services/recommendation/recommendationEngine.js';

export const postRecommendations = async (req, res) => {
  const result = await recommendForLibrary({ genres: req.body?.genres, limit: req.body?.limit });
  return res.json(result);
};

export const postLibraryRecommendations = async (req, res) => {
  const result = await recommendForLibrary({ genres: req.body?.genres, limit: req.body?.limit });
  return res.json(result);
};

export const postSimilarRecommendations = async (req, res) => {
  const hasBook = req.body?.book && typeof req.body.book === 'object';
  const hasSource = req.body?.source && req.body?.sourceId;
  if (!hasBook && !hasSource) {
    return res.status(400).json({ message: 'Provide either book details or source + sourceId.' });
  }
  const result = await recommendSimilarBooks({ book: req.body?.book, source: req.body?.source, sourceId: req.body?.sourceId, limit: req.body?.limit });
  return res.json(result);
};

export const postCollaborativeRecommendations = async (req, res) => {
  const sourceId = req.body?.sourceId || req.params?.sourceId;
  const result = await recommendCollaborativeBooks({ source: req.body?.source || req.query?.source || 'gutenberg', sourceId, bookKey: req.body?.bookKey, limit: req.body?.limit || req.query?.limit });
  return res.json(result);
};
