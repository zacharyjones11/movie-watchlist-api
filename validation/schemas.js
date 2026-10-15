const { z } = require('zod');

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Must be a 24-character hexadecimal MongoDB ID');
const text = (max) => z.string().trim().min(1).max(max);

const movie = z.object({
  title: text(200),
  releaseYear: z.number().int().min(1888).max(2100),
  genre: text(80),
  director: text(120),
  runtimeMinutes: z.number().int().min(1).max(1440),
  contentRating: z.enum(['G', 'PG', 'PG-13', 'R', 'NC-17', 'NR']),
  synopsis: text(5000),
  watchStatus: z.enum(['want-to-watch', 'watching', 'watched'])
}).strict();

const review = z.object({
  movieId: objectId,
  reviewerName: text(100),
  rating: z.number().int().min(1).max(10),
  reviewText: text(5000),
  watchedOn: z.string().date(),
  containsSpoilers: z.boolean()
}).strict();

// Query parameters arrive as strings. Reject arrays, objects, and empty values.
const queryInteger = (min, max, fallback) => z.string().regex(/^\d+$/)
  .transform(Number).pipe(z.number().int().min(min).max(max)).optional().default(String(fallback));
const pagination = {
  limit: queryInteger(1, 100, 50),
  skip: queryInteger(0, 100000, 0)
};
const movieQuery = z.object({
  ...pagination,
  watchStatus: movie.shape.watchStatus.optional()
}).strict();
const reviewQuery = z.object({ ...pagination, movieId: objectId.optional() }).strict();
const idParams = z.object({ id: objectId }).strict();

module.exports = { movie, review, movieQuery, reviewQuery, idParams };
