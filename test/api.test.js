const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const { connectDatabase } = require('../data/database');
const { createApp } = require('../app');
const { createGithubOAuth } = require('../auth/github');

let mongo;
let client;
let db;
let app;
let signedIn;
const githubOAuth = {
  isConfigured: () => true,
  authorizationUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
  async getProfile(code) {
    return { githubId: code, username: code, displayName: `Test ${code}`, email: null, avatarUrl: null };
  }
};

async function signIn(username) {
  const agent = request.agent(app);
  const start = await agent.get('/auth/github').expect(302);
  const state = new URL(start.headers.location).searchParams.get('state');
  await agent.get('/auth/github/callback').query({ code: username, state }).expect(302);
  const response = await agent.get('/auth/me').expect(200);
  return { agent, csrfToken: response.body.csrfToken, user: response.body.user };
}

const api = {
  get: (path, identity = signedIn) => identity.agent.get(path),
  post: (path, identity = signedIn) => identity.agent.post(path).set('X-CSRF-Token', identity.csrfToken),
  put: (path, identity = signedIn) => identity.agent.put(path).set('X-CSRF-Token', identity.csrfToken),
  delete: (path, identity = signedIn) => identity.agent.delete(path).set('X-CSRF-Token', identity.csrfToken)
};
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
  mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
  ({ client, db } = await connectDatabase(mongo.getUri(), 'movie_watchlist_test'));
  app = createApp(db, { sessionSecret: 'test-session-secret-value-at-least-32-chars', githubOAuth });
});
beforeEach(async () => {
  await db.collection('reviews').deleteMany({});
  await db.collection('movies').deleteMany({});
  await db.collection('users').deleteMany({});
  await db.collection('sessions').deleteMany({});
  signedIn = await signIn('zach');
});
after(async () => {
  if (client) await client.close();
  if (mongo) await mongo.stop();
});

test('startup creates both collections and health checks MongoDB', async () => {
  const names = (await db.listCollections().toArray()).map((c) => c.name);
  assert.ok(names.includes('movies') && names.includes('reviews') && names.includes('users') && names.includes('sessions'));
  const response = await request(app).get('/health').expect(200);
  assert.equal(response.body.database, 'connected');
});

test('GitHub OAuth checks state, establishes a session, and scopes records to their owner', async () => {
  assert.equal(signedIn.user.username, 'zach');
  assert.equal((await signedIn.agent.get('/auth/me').expect(200)).body.user.displayName, 'Test zach');

  const unauthenticated = request.agent(app);
  await unauthenticated.get('/auth/github/callback').query({ code: 'intruder', state: 'wrong' }).expect(400);
  await unauthenticated.get('/auth/me').expect(401);
  await request(app).get('/movies').expect(401);

  const movieId = (await api.post('/movies').send(movie).expect(201)).body._id;
  const otherUser = await signIn('other');
  assert.deepEqual((await api.get('/movies', otherUser).expect(200)).body, []);
  await api.get(`/movies/${movieId}`, otherUser).expect(404);
  await api.put(`/movies/${movieId}`, otherUser).send(movie).expect(404);
  await api.delete(`/movies/${movieId}`, otherUser).expect(404);
  await api.post('/reviews', otherUser).send({ ...review, movieId }).expect(404);
});

test('GitHub OAuth exchanges a one-time code and stores only a verified public profile', async () => {
  const calls = [];
  const responses = [
    new Response(JSON.stringify({ access_token: 'temporary-private-token' }), { status: 200 }),
    new Response(JSON.stringify({ id: 42, login: 'zach', name: 'Zach Jones', avatar_url: 'https://avatars.example/zach.png' }), { status: 200 }),
    new Response(JSON.stringify([
      { email: 'unverified@example.com', primary: true, verified: false },
      { email: 'zach@example.com', primary: true, verified: true }
    ]), { status: 200 })
  ];
  const oauth = createGithubOAuth({
    GITHUB_CLIENT_ID: 'client-id',
    GITHUB_CLIENT_SECRET: 'private-client-secret',
    GITHUB_CALLBACK_URL: 'http://127.0.0.1:8081/auth/github/callback'
  }, async (url, options) => {
    calls.push({ url, options });
    return responses.shift();
  });
  assert.equal(oauth.isConfigured(), true);
  const authorizationUrl = new URL(oauth.authorizationUrl('random-state'));
  assert.equal(authorizationUrl.searchParams.get('state'), 'random-state');
  assert.equal(authorizationUrl.searchParams.get('scope'), 'read:user user:email');
  const profile = await oauth.getProfile('one-time-code');
  assert.deepEqual(profile, {
    githubId: '42', username: 'zach', displayName: 'Zach Jones',
    email: 'zach@example.com', avatarUrl: 'https://avatars.example/zach.png'
  });
  assert.equal(calls.length, 3);
  assert.equal(JSON.parse(calls[0].options.body).code, 'one-time-code');
  assert.equal(calls[1].options.headers.authorization, 'Bearer temporary-private-token');
});

test('write routes require a valid CSRF token', async () => {
  await signedIn.agent.post('/movies').send(movie).expect(403);
  await signedIn.agent.delete(`/movies/${new ObjectId()}`).expect(403);
  await signedIn.agent.post('/auth/logout').set('X-CSRF-Token', signedIn.csrfToken).expect(204);
  await signedIn.agent.get('/auth/me').expect(401);
});

test('movie CRUD persists fields, filters lists, and preserves creation metadata', async () => {
  const created = await api.post('/movies').send(movie).expect(201);
  const id = created.body._id;
  assert.match(id, /^[a-f0-9]{24}$/);
  assert.equal(created.headers.location, `/movies/${id}`);
  assert.equal((await db.collection('movies').findOne({ _id: new ObjectId(id) })).title, movie.title);
  const fetched = await api.get(`/movies/${id}`).expect(200);
  assert.equal(fetched.body.userId, signedIn.user.id);
  assert.equal(fetched.body.runtimeMinutes, 115);
  assert.equal((await api.get('/movies?watchStatus=want-to-watch&limit=1&skip=0').expect(200)).body.length, 1);
  assert.deepEqual((await api.get('/movies?watchStatus=watched').expect(200)).body, []);
  const updated = await api.put(`/movies/${id}`).send({ ...movie, watchStatus: 'watched' }).expect(200);
  assert.equal(updated.body.watchStatus, 'watched');
  assert.equal(updated.body.createdAt, created.body.createdAt);
  await api.delete(`/movies/${id}`).expect(204);
  await api.get(`/movies/${id}`).expect(404);
  assert.equal(await db.collection('movies').countDocuments(), 0);
});

test('review CRUD uses a real movie reference and prevents deleting a reviewed movie', async () => {
  const createdMovie = await api.post('/movies').send(movie).expect(201);
  const movieId = createdMovie.body._id;
  const created = await api.post('/reviews').send({ ...review, movieId }).expect(201);
  const id = created.body._id;
  assert.equal(created.body.movieId, movieId);
  assert.ok((await db.collection('reviews').findOne({ _id: new ObjectId(id) })).movieId instanceof ObjectId);
  await api.get(`/reviews/${id}`).expect(200);
  assert.equal((await api.get(`/reviews?movieId=${movieId}`).expect(200)).body.length, 1);
  const updated = await api.put(`/reviews/${id}`).send({ ...review, movieId, rating: 8 }).expect(200);
  assert.equal(updated.body.rating, 8);
  assert.equal(updated.body.createdAt, created.body.createdAt);
  await api.delete(`/movies/${movieId}`).expect(409);
  await api.delete(`/reviews/${id}`).expect(204);
  await api.get(`/reviews/${id}`).expect(404);
  await api.delete(`/movies/${movieId}`).expect(204);
});

test('rejects invalid bodies, extra fields, query injection, and malformed IDs without writes', async () => {
  const response = await api.post('/movies').send({ title: 'Incomplete' }).expect(400);
  assert.ok(response.body.details.some((issue) => issue.field === 'director'));
  await api.post('/movies').send({ ...movie, runtimeMinutes: '115' }).expect(400);
  await api.post('/movies').send({ ...movie, _id: 'injected' }).expect(400);
  for (const path of ['/movies/not-an-id', '/reviews/not-an-id', '/movies?limit=0', '/movies?skip=-1', '/movies?watchStatus=no', '/movies?limit=1&limit=2', '/movies?title[$ne]=x', '/reviews?movieId=bad']) {
    await api.get(path).expect(400);
  }
  await api.put(`/movies/${new ObjectId()}`).send({ title: 'Partial update' }).expect(400);
  await api.delete('/reviews/bad').expect(400);
  assert.equal(await db.collection('movies').countDocuments(), 0);
});

test('rejects invalid review ratings, dates, booleans and nonexistent references', async () => {
  const movieId = (await api.post('/movies').send(movie).expect(201)).body._id;
  for (const change of [{ rating: 11 }, { rating: 1.5 }, { watchedOn: '2026-02-30' }, { containsSpoilers: 'false' }, { movieId: 'bad' }]) {
    await api.post('/reviews').send({ ...review, movieId, ...change }).expect(400);
  }
  await api.post('/reviews').send({ ...review, movieId: new ObjectId().toHexString() }).expect(404);
  assert.equal(await db.collection('reviews').countDocuments(), 0);
});

test('missing documents return 404 for reads, updates and deletes', async () => {
  const missing = new ObjectId().toHexString();
  await api.get(`/movies/${missing}`).expect(404);
  await api.put(`/movies/${missing}`).send(movie).expect(404);
  await api.delete(`/movies/${missing}`).expect(404);
  await api.get(`/reviews/${missing}`).expect(404);
  await api.delete(`/reviews/${missing}`).expect(404);
  const movieId = (await api.post('/movies').send(movie).expect(201)).body._id;
  await api.put(`/reviews/${missing}`).send({ ...review, movieId }).expect(404);
});

test('malformed JSON, oversized requests and unknown routes have JSON errors', async () => {
  await api.post('/movies').set('Content-Type', 'application/json').send('{broken').expect(400);
  await api.post('/movies').send({ title: 'a'.repeat(110000) }).expect(413);
  const response = await request(app).get('/unknown').expect(404);
  assert.equal(response.body.error, 'Route not found');
});

test('database failures are handled without exposing credentials or stack traces', async () => {
  const ownerId = new ObjectId();
  const sessionId = crypto.randomBytes(32).toString('base64url');
  const signature = crypto.createHmac('sha256', 'local-test-session-secret-at-least-32-chars').update(sessionId).digest('base64url');
  const cookie = `movie_watchlist_session=${sessionId}.${signature}`;
  const failingApp = createApp({
    collection(name) {
      if (name === 'sessions') return { findOne: async () => ({ data: { userId: ownerId.toString(), csrfToken: 'test-token' } }) };
      if (name === 'users') return { findOne: async () => ({ _id: ownerId }) };
      if (name === 'movies') throw new Error('mongodb://secret-password@private-host');
      throw new Error('unexpected collection');
    },
    command() { throw new Error('private-host'); }
  });
  const response = await request(failingApp).get('/movies').set('Cookie', cookie).expect(500);
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
  assert.ok(document.paths['/auth/github']);
  assert.ok(document.paths['/auth/me']);
  assert.equal(document.components.securitySchemes.csrfToken.name, 'X-CSRF-Token');
});
