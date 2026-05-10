import express from 'express';

import {
  postCollaborativeRecommendations,
  postLibraryRecommendations,
  postRecommendations,
  postSimilarRecommendations,
} from '../controllers/recommendationsController.js';

const router = express.Router();

router.post('/', postRecommendations);
router.post('/library', postLibraryRecommendations);
router.post('/similar', postSimilarRecommendations);
router.post('/collaborative', postCollaborativeRecommendations);
router.get('/collaborative/:sourceId', postCollaborativeRecommendations);

export default router;
