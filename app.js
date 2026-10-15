const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const { notFound, errorHandler } = require('./middleware/errors');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  app.get('/', (req, res) => res.json({
    name: 'Movie Watchlist API',
    documentation: '/api-docs',
    movies: '/movies',
    reviews: '/reviews',
    authentication: 'Lesson 5: public endpoints. OAuth is planned for a later lesson.'
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
  app.use('/', require('./routes'));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
