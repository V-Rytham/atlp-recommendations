import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { config } from '../config/recommendations.js';
import { Book } from '../models/Book.js';
import { normalizeBookRecord } from '../services/recommendation/ingestionService.js';

dotenv.config();

const subjects = String(process.env.OPENLIBRARY_SUBJECTS || 'fantasy,science_fiction,mystery,romance,historical_fiction,adventure,horror,poetry,biography,philosophy')
  .split(',')
  .map((subject) => subject.trim())
  .filter(Boolean);
const limitPerSubject = Number(process.env.OPENLIBRARY_LIMIT_PER_SUBJECT || 100);

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OpenLibrary request failed ${response.status}: ${url}`);
  return response.json();
};

if (!config.mongoUri) throw new Error('MONGODB_URI is required.');
await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });

let imported = 0;
for (const subject of subjects) {
  const url = `https://openlibrary.org/subjects/${encodeURIComponent(subject)}.json?limit=${limitPerSubject}`;
  const payload = await fetchJson(url);
  const works = Array.isArray(payload.works) ? payload.works : [];
  const operations = works.map((work, index) => {
    const sourceId = String(work.key || '').replace('/works/', '') || `${subject}-${index}`;
    const book = normalizeBookRecord({
      title: work.title,
      author: work.authors?.[0]?.name || 'Unknown',
      description: Array.isArray(work.subject) ? work.subject.slice(0, 12).join(', ') : '',
      coverImage: work.cover_id ? `https://covers.openlibrary.org/b/id/${work.cover_id}-L.jpg` : '',
      genres: [subject, ...(Array.isArray(work.subject) ? work.subject.slice(0, 20) : [])],
      subjects: Array.isArray(work.subject) ? work.subject : [subject],
      source: 'openlibrary',
      sourceId,
      popularity: Number(work.edition_count || 0),
    }, imported + index);
    return { updateOne: { filter: { source: book.source, sourceId: book.sourceId }, update: { $set: book }, upsert: true } };
  });
  if (operations.length) {
    const result = await Book.bulkWrite(operations, { ordered: false });
    imported += (result.upsertedCount || 0) + (result.modifiedCount || 0);
  }
  console.log(`Imported subject ${subject}: ${operations.length} works`);
}

console.log(JSON.stringify({ imported }, null, 2));
await mongoose.disconnect();
