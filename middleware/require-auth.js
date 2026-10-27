const crypto = require('node:crypto');
const { ObjectId } = require('mongodb');

function requireAuth(db) {
  return async (req, res, next) => {
    const userId = req.authSession?.userId;
    if (!ObjectId.isValid(userId)) return res.status(401).json({ error: 'Sign in with GitHub to access this resource' });
    try {
      const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });
      if (!user) return res.status(401).json({ error: 'Sign in with GitHub to access this resource' });
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const expected = req.authSession?.csrfToken;
  const provided = req.get('X-CSRF-Token');
  if (typeof expected !== 'string' || typeof provided !== 'string') {
    return res.status(403).json({ error: 'A valid X-CSRF-Token header is required for this request' });
  }
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length || !crypto.timingSafeEqual(expectedBytes, providedBytes)) {
    return res.status(403).json({ error: 'A valid X-CSRF-Token header is required for this request' });
  }
  next();
}

module.exports = { requireAuth, requireCsrf };
