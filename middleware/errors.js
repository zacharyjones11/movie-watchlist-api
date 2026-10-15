function notFound(req, res) {
  res.status(404).json({ error: 'Route not found' });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must be valid JSON' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body exceeds the 100 KB limit' });
  }
  // Do not return database errors, connection strings, or stack traces to clients.
  console.error('Request failed:', error.name);
  return res.status(500).json({ error: 'An unexpected server error occurred' });
}

module.exports = { notFound, errorHandler };
