import express from 'express';

import { postBuildVectorIndex } from '../controllers/adminController.js';

const router = express.Router();

router.post('/build-vector-index', postBuildVectorIndex);

export default router;
