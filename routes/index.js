const express = require('express');
const { requireAuth, requireCsrf } = require('../middleware/require-auth');

function createApiRouter(db) {
  const router = express.Router();
  router.use('/movies', requireAuth(db), requireCsrf, require('./movies'));
  router.use('/reviews', requireAuth(db), requireCsrf, require('./reviews'));
  return router;
}

module.exports = { createApiRouter };
