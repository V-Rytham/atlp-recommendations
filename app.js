import express from 'express';
import cors from 'cors';

import adminRoute from './routes/admin.js';
import recommendationsRoute from './routes/recommendations.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use((req, _res, next) => {
  req.requestStartedAt = Date.now();
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'atlp-recommendations', architecture: 'local-vector-recommendations' });
});

app.use('/admin', adminRoute);
app.use('/api/recommendations', recommendationsRoute);

app.use((error, req, res, _next) => {
  console.error(`[HTTP] ${req.method} ${req.originalUrl} failed:`, error?.stack || error);
  res.status(error?.statusCode || 500).json({ message: error?.message || 'Internal recommendation service error.' });
});

export default app;
