const { ObjectId } = require('mongodb');

async function getAll(req, res) {
  const { limit, skip, movieId } = req.validated.query;
  const filter = { userId: req.user._id };
  if (movieId) filter.movieId = new ObjectId(movieId);
  const reviews = await req.app.locals.db.collection('reviews')
    .find(filter).sort({ _id: 1 }).skip(skip).limit(limit).toArray();
  res.json(reviews);
}

async function getById(req, res) {
  const review = await req.app.locals.db.collection('reviews')
    .findOne({ _id: new ObjectId(req.validated.params.id), userId: req.user._id });
  if (!review) return res.status(404).json({ error: 'Review not found' });
  res.json(review);
}

async function create(req, res) {
  const db = req.app.locals.db;
  const movieId = new ObjectId(req.validated.body.movieId);
  if (!await db.collection('movies').findOne({ _id: movieId, userId: req.user._id })) {
    return res.status(404).json({ error: 'Referenced movie not found' });
  }
  const now = new Date();
  const review = { ...req.validated.body, movieId, userId: req.user._id, createdAt: now, updatedAt: now };
  const result = await db.collection('reviews').insertOne(review);
  res.location(`/reviews/${result.insertedId}`).status(201)
    .json({ ...review, _id: result.insertedId });
}

async function update(req, res) {
  const db = req.app.locals.db;
  const movieId = new ObjectId(req.validated.body.movieId);
  if (!await db.collection('movies').findOne({ _id: movieId, userId: req.user._id })) {
    return res.status(404).json({ error: 'Referenced movie not found' });
  }
  const review = await db.collection('reviews').findOneAndUpdate(
    { _id: new ObjectId(req.validated.params.id), userId: req.user._id },
    { $set: { ...req.validated.body, movieId, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!review) return res.status(404).json({ error: 'Review not found' });
  res.json(review);
}

async function remove(req, res) {
  const result = await req.app.locals.db.collection('reviews')
    .deleteOne({ _id: new ObjectId(req.validated.params.id), userId: req.user._id });
  if (!result.deletedCount) return res.status(404).json({ error: 'Review not found' });
  res.status(204).send();
}

module.exports = { getAll, getById, create, update, remove };
