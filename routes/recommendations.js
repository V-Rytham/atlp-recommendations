import express from "express";

import { postRecommendations } from "../controllers/recommendationsController.js";

const router = express.Router();

router.post("/", postRecommendations);

export default router;