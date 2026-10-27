const fs = require('node:fs');
const path = require('node:path');
const { zodToJsonSchema } = require('zod-to-json-schema');
const schemas = require('../validation/schemas');

const movieExample = {
  title: 'The Incredibles', releaseYear: 2004, genre: 'Animation',
  director: 'Brad Bird', runtimeMinutes: 115, contentRating: 'PG',
  synopsis: 'A family of superheroes returns to action.', watchStatus: 'want-to-watch'
};
const reviewExample = {
  movieId: '507f1f77bcf86cd799439011', reviewerName: 'Zach', rating: 9,
  reviewText: 'A fun story with memorable characters.', watchedOn: '2026-10-15', containsSpoilers: false
};
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema) => ({ 'application/json': { schema } });
const error = (description) => ({ description, content: json(ref('Error')) });
const unauthorized = error('Sign-in is required');
const csrfFailure = error('Missing or invalid X-CSRF-Token header');
const idParameter = {
  name: 'id', in: 'path', required: true,
  description: 'MongoDB document ID returned by POST or GET.',
  schema: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }
};
const pageParameters = [
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
  { name: 'skip', in: 'query', schema: { type: 'integer', minimum: 0, maximum: 100000, default: 0 } }
];
const paths = {};
for (const [resource, model] of [['movies', 'Movie'], ['reviews', 'Review']]) {
  const common = { tags: [model === 'Movie' ? 'Movies' : 'Reviews'] };
  const failures = { 400: error('Invalid path, query, or request body'), 401: unauthorized, 500: error('Unexpected server or database error') };
  const body = {
    required: true,
    content: { 'application/json': { schema: ref(`${model}Input`), example: model === 'Movie' ? movieExample : reviewExample } }
  };
  const filter = model === 'Movie'
    ? { name: 'watchStatus', in: 'query', schema: { type: 'string', enum: ['want-to-watch', 'watching', 'watched'] } }
    : { name: 'movieId', in: 'query', schema: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } };
  paths[`/${resource}`] = {
    get: {
      ...common, operationId: `list${model}s`, summary: `List ${resource}`,
      description: 'Requires GitHub sign-in. The authenticated session only sees this user\'s documents. Returns an array ordered by document ID. Unknown query parameters are rejected.',
      parameters: [...pageParameters, filter],
      responses: { 200: { description: 'Matching documents (empty array if none)', content: json({ type: 'array', items: ref(model) }) }, ...failures }
    },
    post: {
      ...common, operationId: `create${model}`, summary: `Create a ${model.toLowerCase()}`,
      description: 'Requires GitHub sign-in and the X-CSRF-Token returned by GET /auth/me. The server sets userId; all input fields are required and extra fields are rejected.',
      requestBody: body,
      security: [{ csrfToken: [] }],
      responses: {
        201: { description: 'Created document', headers: { Location: { description: 'Relative URL of the created document', schema: { type: 'string' } } }, content: json(ref(model)) },
        ...(model === 'Review' ? { 404: error('Referenced movie does not exist or is not owned by you') } : {}), ...failures, 403: csrfFailure, 413: error('Body exceeds 100 KB')
      }
    }
  };
  paths[`/${resource}/{id}`] = {
    parameters: [idParameter],
    get: {
      ...common, operationId: `get${model}`, summary: `Get a ${model.toLowerCase()} by ID`,
      description: 'Requires GitHub sign-in. Documents owned by another user are returned as not found.',
      responses: { 200: { description: 'Requested document', content: json(ref(model)) }, 404: error('Document not found'), ...failures }
    },
    put: {
      ...common, operationId: `update${model}`, summary: `Update a ${model.toLowerCase()}`,
      description: 'Requires GitHub sign-in and the X-CSRF-Token returned by GET /auth/me. Send all input fields, including unchanged fields. The original ID, owner, and createdAt are preserved; updatedAt is set by the server. Does not create a missing document.',
      requestBody: body,
      security: [{ csrfToken: [] }],
      responses: { 200: { description: 'Updated document', content: json(ref(model)) }, 404: error('Document or referenced movie not found'), ...failures, 403: csrfFailure, 413: error('Body exceeds 100 KB') }
    },
    delete: {
      ...common, operationId: `delete${model}`, summary: `Delete a ${model.toLowerCase()}`,
      description: `Requires GitHub sign-in and the X-CSRF-Token returned by GET /auth/me. ${model === 'Movie' ? 'Delete your associated reviews first. A movie with reviews returns 409.' : 'Permanently removes this review.'}`,
      security: [{ csrfToken: [] }],
      responses: { 204: { description: 'Deleted successfully; no response body' }, 404: error('Document not found'), ...(model === 'Movie' ? { 409: error('Movie still has reviews') } : {}), ...failures, 403: csrfFailure }
    }
  };
}

const inputSchema = (schema, example) => {
  const { $schema, ...result } = zodToJsonSchema(schema, { target: 'openApi3' });
  return { ...result, example };
};
const outputSchema = (name) => ({
  allOf: [ref(`${name}Input`), {
    type: 'object', required: ['_id', 'userId', 'createdAt', 'updatedAt'],
    properties: {
      _id: { type: 'string', readOnly: true, pattern: '^[a-fA-F0-9]{24}$' },
      userId: { type: 'string', readOnly: true, pattern: '^[a-fA-F0-9]{24}$', description: 'MongoDB ID of the authenticated owner.' },
      createdAt: { type: 'string', format: 'date-time', readOnly: true },
      updatedAt: { type: 'string', format: 'date-time', readOnly: true }
    }
  }]
});
// Flatten output schemas because additionalProperties:false on Input would
// otherwise reject the server-managed fields inside an allOf.
const movieInput = inputSchema(schemas.movie, movieExample);
const reviewInput = inputSchema(schemas.review, reviewExample);
const output = (name, input) => {
  const managed = outputSchema(name).allOf[1];
  return { ...input, required: [...input.required, ...managed.required], properties: { ...input.properties, ...managed.properties }, example: { ...input.example, _id: '507f1f77bcf86cd799439011', userId: '507f1f77bcf86cd799439012', createdAt: '2026-10-15T12:00:00.000Z', updatedAt: '2026-10-15T12:00:00.000Z' } };
};
const document = {
  openapi: '3.0.3',
  info: {
    title: 'Movie Watchlist API', version: '1.0.0',
    description: 'CSE 341 Project 2 — sign in with GitHub, then manage your private movie watchlist and reviews. Open /auth/github in a browser to sign in. Movie and review routes require your session; POST, PUT, and DELETE also require the X-CSRF-Token from GET /auth/me. Users can only see and change their own documents. Create a movie before posting a review, using its returned _id as movieId. Requests and responses use JSON. PUT requires every input field.'
  },
  // Relative URL makes Swagger Try it out use localhost or Render automatically.
  servers: [{ url: '/', description: 'The server hosting this documentation' }],
  tags: [{ name: 'Authentication', description: 'GitHub OAuth sign-in, current user, and logout' }, { name: 'Movies', description: 'Movie details and watchlist status' }, { name: 'Reviews', description: 'Reviews linked to existing movies' }, { name: 'System', description: 'Service information and database health' }],
  paths: {
    '/': { get: { tags: ['System'], operationId: 'getInfo', summary: 'API information', responses: { 200: { description: 'API name, links, and sign-in instructions', content: json({ type: 'object', properties: { name: { type: 'string' }, documentation: { type: 'string' }, movies: { type: 'string' }, reviews: { type: 'string' }, authentication: { type: 'string' } } }) } } } },
    '/health': { get: { tags: ['System'], operationId: 'getHealth', summary: 'Check MongoDB connectivity', responses: { 200: { description: 'Database responds to ping', content: json(ref('Health')) }, 503: { description: 'Database unavailable', content: json(ref('Health')) } } } },
    '/auth/github': { get: { tags: ['Authentication'], operationId: 'startGithubLogin', summary: 'Sign in with GitHub', description: 'Open this route in a browser. On successful sign-in, GitHub returns to the callback and the API redirects to Swagger UI. OAuth state is validated to prevent login CSRF.', responses: { 302: { description: 'Redirect to GitHub authorization' }, 503: error('GitHub OAuth is not configured') } } },
    '/auth/github/callback': { get: { tags: ['Authentication'], operationId: 'githubCallback', summary: 'GitHub OAuth callback', description: 'Completes the authorization-code exchange, upserts the GitHub user, rotates the session, and redirects to Swagger UI.', parameters: [{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }, { name: 'state', in: 'query', required: true, schema: { type: 'string' } }], responses: { 302: { description: 'Sign-in succeeded; redirects to /api-docs/' }, 400: error('Invalid or expired OAuth state'), 401: error('Sign-in was cancelled or rejected'), 500: error('Sign-in could not be completed') } } },
    '/auth/me': { get: { tags: ['Authentication'], operationId: 'getCurrentUser', summary: 'Get the signed-in user and CSRF token', description: 'Requires a signed-in browser session. Copy csrfToken into the X-CSRF-Token authorization field before running POST, PUT, or DELETE requests in Swagger.', responses: { 200: { description: 'Signed-in GitHub profile and session CSRF token', content: json(ref('CurrentUser')) }, 401: unauthorized } } },
    '/auth/logout': { post: { tags: ['Authentication'], operationId: 'logout', summary: 'Sign out', description: 'Requires a signed-in session and the X-CSRF-Token returned by GET /auth/me.', security: [{ csrfToken: [] }], responses: { 204: { description: 'Session deleted and cookie cleared' }, 401: unauthorized, 403: csrfFailure } } },
    ...paths
  },
  components: { securitySchemes: { csrfToken: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token', description: 'Get the current value from GET /auth/me after opening /auth/github in the same browser.' } }, schemas: {
    MovieInput: movieInput, ReviewInput: reviewInput,
    Movie: output('Movie', movieInput), Review: output('Review', reviewInput),
    Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' }, details: { type: 'array', items: { type: 'object', required: ['field', 'message'], properties: { field: { type: 'string' }, message: { type: 'string' } } } } } },
    User: { type: 'object', required: ['id', 'username', 'displayName'], properties: { id: { type: 'string', readOnly: true }, username: { type: 'string' }, displayName: { type: 'string' }, email: { type: 'string', nullable: true }, avatarUrl: { type: 'string', nullable: true } } },
    CurrentUser: { type: 'object', required: ['user', 'csrfToken'], properties: { user: ref('User'), csrfToken: { type: 'string' } } },
    Health: { type: 'object', required: ['status', 'database'], properties: { status: { type: 'string', enum: ['ok', 'unavailable'] }, database: { type: 'string', enum: ['connected', 'disconnected'] } } }
  } }
};

fs.writeFileSync(path.join(__dirname, '..', 'swagger.json'), JSON.stringify(document, null, 2) + '\n');
console.log('Generated swagger.json from the shared validation schemas.');
