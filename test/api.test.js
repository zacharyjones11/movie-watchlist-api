const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const { connectDatabase } = require('../data/database');
const { createApp } = require('../app');

let mongo;
let client;
let db;
let app;
const movie = {
  title: 'The Incredibles', releaseYear: 2004, genre: 'Animation',
  director: 'Brad Bird', runtimeMinutes: 115, contentRating: 'PG',
  synopsis: 'A family of superheroes returns to action.', watchStatus: 'want-to-watch'
};
const review = {
  reviewerName: 'Test Reviewer', rating: 9, reviewText: 'A fun movie.',
  watchedOn: '2026-10-15', containsSpoilers: false
};

before(async () => {
  // Real, disposable local MongoDB. Never reads .env or touches the Atlas account.
  mongo = await MongoMemoryServer.create();
  ({ client, db } = await connectDatabase(mongo.getUri(), 'movie_watchlist_test'));
  app = createApp(db);
});
beforeEach(async () => {
  await db.collection('reviews').deleteMany({});
  await db.collection('movies').deleteMany({});
});
after(async () => {
  if (client) await client.close();
  if (mongo) await mongo.stop();
});

test('startup creates both collections and health checks MongoDB', async () => {
  const names = (await db.listCollections().toArray()).map((c) => c.name);
  assert.ok(names.includes('movies') && names.includes('reviews'));
  const response = await request(app).get('/health').expect(200);
  assert.equal(response.body.database, 'connected');
});

test('movie CRUD persists fields, filters lists, and preserves creation metadata', async () => {
  const created = await request(app).post('/movies').send(movie).expect(201);
  const id = created.body._id;
  assert.match(id, /^[a-f0-9]{24}$/);
  assert.equal(created.headers.location, `/movies/${id}`);
  assert.equal((await db.collection('movies').findOne({ _id: new ObjectId(id) })).title, movie.title);
  const fetched = await request(app).get(`/movies/${id}`).expect(200);
  assert.equal(fetched.body.runtimeMinutes, 115);
  assert.equal((await request(app).get('/movies?watchStatus=want-to-watch&limit=1&skip=0').expect(200)).body.length, 1);
  assert.deepEqual((await request(app).get('/movies?watchStatus=watched').expect(200)).body, []);
  const updated = await request(app).put(`/movies/${id}`).send({ ...movie, watchStatus: 'watched' }).expect(200);
  assert.equal(updated.body.watchStatus, 'watched');
  assert.equal(updated.body.createdAt, created.body.createdAt);
  await request(app).delete(`/movies/${id}`).expect(204);
  await request(app).get(`/movies/${id}`).expect(404);
  assert.equal(await db.collection('movies').countDocuments(), 0);
});

test('review CRUD uses a real movie reference and prevents deleting a reviewed movie', async () => {
  const createdMovie = await request(app).post('/movies').send(movie).expect(201);
  const movieId = createdMovie.body._id;
  const created = await request(app).post('/reviews').send({ ...review, movieId }).expect(201);
  const id = created.body._id;
  assert.equal(created.body.movieId, movieId);
  assert.ok((await db.collection('reviews').findOne({ _id: new ObjectId(id) })).movieId instanceof ObjectId);
  await request(app).get(`/reviews/${id}`).expect(200);
  assert.equal((await request(app).get(`/reviews?movieId=${movieId}`).expect(200)).body.length, 1);
  const updated = await request(app).put(`/reviews/${id}`).send({ ...review, movieId, rating: 8 }).expect(200);
  assert.equal(updated.body.rating, 8);
  assert.equal(updated.body.createdAt, created.body.createdAt);
  await request(app).delete(`/movies/${movieId}`).expect(409);
  await request(app).delete(`/reviews/${id}`).expect(204);
  await request(app).get(`/reviews/${id}`).expect(404);
  await request(app).delete(`/movies/${movieId}`).expect(204);
});

test('rejects invalid bodies, extra fields, query injection, and malformed IDs without writes', async () => {
  const response = await request(app).post('/movies').send({ title: 'Incomplete' }).expect(400);
  assert.ok(response.body.details.some((issue) => issue.field === 'director'));
  await request(app).post('/movies').send({ ...movie, runtimeMinutes: '115' }).expect(400);
  await request(app).post('/movies').send({ ...movie, _id: 'injected' }).expect(400);
  for (const path of ['/movies/not-an-id', '/reviews/not-an-id', '/movies?limit=0', '/movies?skip=-1', '/movies?watchStatus=no', '/movies?limit=1&limit=2', '/movies?title[$ne]=x', '/reviews?movieId=bad']) {
    await request(app).get(path).expect(400);
  }
  await request(app).put(`/movies/${new ObjectId()}`).send({ title: 'Partial update' }).expect(400);
  await request(app).delete('/reviews/bad').expect(400);
  assert.equal(await db.collection('movies').countDocuments(), 0);
});

test('rejects invalid review ratings, dates, booleans and nonexistent references', async () => {
  const movieId = (await request(app).post('/movies').send(movie).expect(201)).body._id;
  for (const change of [{ rating: 11 }, { rating: 1.5 }, { watchedOn: '2026-02-30' }, { containsSpoilers: 'false' }, { movieId: 'bad' }]) {
    await request(app).post('/reviews').send({ ...review, movieId, ...change }).expect(400);
  }
  await request(app).post('/reviews').send({ ...review, movieId: new ObjectId().toHexString() }).expect(404);
  assert.equal(await db.collection('reviews').countDocuments(), 0);
});

test('missing documents return 404 for reads, updates and deletes', async () => {
  const missing = new ObjectId().toHexString();
  await request(app).get(`/movies/${missing}`).expect(404);
  await request(app).put(`/movies/${missing}`).send(movie).expect(404);
  await request(app).delete(`/movies/${missing}`).expect(404);
  await request(app).get(`/reviews/${missing}`).expect(404);
  await request(app).delete(`/reviews/${missing}`).expect(404);
  const movieId = (await request(app).post('/movies').send(movie).expect(201)).body._id;
  await request(app).put(`/reviews/${missing}`).send({ ...review, movieId }).expect(404);
});

test('malformed JSON, oversized requests and unknown routes have JSON errors', async () => {
  await request(app).post('/movies').set('Content-Type', 'application/json').send('{broken').expect(400);
  await request(app).post('/movies').send({ title: 'a'.repeat(110000) }).expect(413);
  const response = await request(app).get('/unknown').expect(404);
  assert.equal(response.body.error, 'Route not found');
});

test('database failures are handled without exposing credentials or stack traces', async () => {
  const failingApp = createApp({
    collection() { throw new Error('mongodb://secret-password@private-host'); },
    command() { throw new Error('private-host'); }
  });
  const response = await request(failingApp).get('/movies').expect(500);
  assert.deepEqual(response.body, { error: 'An unexpected server error occurred' });
  await request(failingApp).get('/health').expect(503);
});

test('Swagger serves all implemented CRUD operations with portable server URL', async () => {
  await request(app).get('/api-docs/').expect('Content-Type', /html/).expect(200);
  const { body: document } = await request(app).get('/swagger.json').expect(200);
  assert.equal(document.servers[0].url, '/');
  for (const resource of ['movies', 'reviews']) {
    for (const verb of ['get', 'post']) assert.ok(document.paths[`/${resource}`][verb]);
    for (const verb of ['get', 'put', 'delete']) assert.ok(document.paths[`/${resource}/{id}`][verb]);
  }
  assert.equal(document.components.schemas.MovieInput.required.length, 8);
});
