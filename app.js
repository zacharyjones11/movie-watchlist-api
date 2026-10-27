const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const { notFound, errorHandler } = require('./middleware/errors');
const { createAuthSessionMiddleware } = require('./middleware/auth-session');
const { createGithubOAuth } = require('./auth/github');
const { createAuthRouter } = require('./routes/auth');
const { createApiRouter } = require('./routes');

function createApp(db, options = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;
  const sessionSecret = options.sessionSecret || process.env.SESSION_SECRET || 'local-test-session-secret-at-least-32-chars';
  const allowedOrigins = new Set((process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean));
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    }
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(createAuthSessionMiddleware(db, sessionSecret));
  app.get('/', (req, res) => res.json({
    name: 'Movie Watchlist API',
    documentation: '/api-docs',
    movies: '/movies',
    reviews: '/reviews',
    authentication: 'GitHub OAuth. Sign in at /auth/github; movie and review routes require an authenticated session.'
  }));
  app.get('/health', async (req, res) => {
    try {
      await db.command({ ping: 1 });
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'disconnected' });
    }
  });
  app.get('/swagger.json', (req, res) => res.json(swaggerDocument));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
    swaggerOptions: { persistAuthorization: false },
    customSiteTitle: 'Movie Watchlist API Documentation'
  }));
  app.use('/auth', createAuthRouter(db, options.githubOAuth || createGithubOAuth(process.env)));
  app.use('/', createApiRouter(db));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
