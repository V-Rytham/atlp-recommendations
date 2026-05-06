import { buildRecommendations } from '../services/recommendationsService.js';

const normalizeGenre = (value) => String(value || '').trim().toLowerCase();

export const postRecommendations = async (req, res) => {
  try {
    const rawGenres = Array.isArray(req.body?.genres) ? req.body.genres : [];
    const normalized = Array.from(new Set(rawGenres.map(normalizeGenre).filter(Boolean)));

    if (normalized.length === 0) {
      return res.status(400).json({ message: 'genres must be a non-empty array.' });
    }

    const result = await buildRecommendations({ genres: normalized });

    return res.json({
      books: result.books,
      personalized: true,
    });
  } catch (error) {
    console.error('[RECOMMENDATIONS] Failed:', error?.message || error);
    return res.status(500).json({ message: 'Failed to generate recommendations.' });
  }
};
