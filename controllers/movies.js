const { ObjectId } = require('mongodb');

async function getAll(req, res) {
  const { limit, skip, watchStatus } = req.validated.query;
  const filter = watchStatus ? { watchStatus } : {};
  const movies = await req.app.locals.db.collection('movies')
    .find(filter).sort({ _id: 1 }).skip(skip).limit(limit).toArray();
  res.json(movies);
}

async function getById(req, res) {
  const movie = await req.app.locals.db.collection('movies')
    .findOne({ _id: new ObjectId(req.validated.params.id) });
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  res.json(movie);
}

async function create(req, res) {
  const now = new Date();
  const movie = { ...req.validated.body, createdAt: now, updatedAt: now };
  const result = await req.app.locals.db.collection('movies').insertOne(movie);
  res.location(`/movies/${result.insertedId}`).status(201)
    .json({ ...movie, _id: result.insertedId });
}

async function update(req, res) {
  const movie = await req.app.locals.db.collection('movies').findOneAndUpdate(
    { _id: new ObjectId(req.validated.params.id) },
    { $set: { ...req.validated.body, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  res.json(movie);
}

async function remove(req, res) {
  const db = req.app.locals.db;
  const id = new ObjectId(req.validated.params.id);
  if (await db.collection('reviews').findOne({ movieId: id })) {
    return res.status(409).json({ error: 'Delete this movie\'s reviews before deleting the movie' });
  }
  const result = await db.collection('movies').deleteOne({ _id: id });
  if (!result.deletedCount) return res.status(404).json({ error: 'Movie not found' });
  res.status(204).send();
}

module.exports = { getAll, getById, create, update, remove };
