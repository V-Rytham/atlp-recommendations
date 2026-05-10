export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const l2Normalize = (vector) => {
  const values = Array.from(vector || [], Number);
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 ? values.map((value) => value / norm) : values;
};

export const cosineSimilarity = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let score = 0;
  for (let i = 0; i < a.length; i += 1) score += Number(a[i] || 0) * Number(b[i] || 0);
  return score;
};

export const jaccard = (left, right) => {
  const a = new Set(Array.isArray(left) ? left : []);
  const b = new Set(Array.isArray(right) ? right : []);
  if (!a.size && !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
};
