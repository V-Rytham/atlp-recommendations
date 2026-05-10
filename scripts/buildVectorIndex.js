import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { config } from '../config/recommendations.js';
import { buildVectorIndex } from '../services/recommendation/ingestionService.js';

dotenv.config();

if (!config.mongoUri) throw new Error('MONGODB_URI is required.');

await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
const result = await buildVectorIndex();
console.log(JSON.stringify(result, null, 2));
await mongoose.disconnect();
