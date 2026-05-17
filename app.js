import express from "express";
import cors from "cors";

import recommendationsRoute from "./routes/recommendations.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/api/recommendations", recommendationsRoute);

export default app;