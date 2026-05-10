import { config } from '../config/recommendations.js';
import { buildVectorIndex } from '../services/recommendation/ingestionService.js';

const isAuthorized = (req) => {
  const provided = String(req.get('x-admin-token') || req.body?.adminToken || '').trim();
  return config.allowAdminIndexBuild && config.adminIndexToken && provided === config.adminIndexToken;
};

export const postBuildVectorIndex = async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(403).json({ message: 'Vector index build endpoint is disabled or unauthorized.' });
  }

  try {
    const result = await buildVectorIndex();
    return res.json(result);
  } catch (error) {
    console.error('[ADMIN] Vector index build failed:', error?.stack || error);
    return res.status(500).json({ message: 'Vector index build failed.', error: error?.message || String(error) });
  }
};
