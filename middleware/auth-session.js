const crypto = require('node:crypto');

const COOKIE_NAME = 'movie_watchlist_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function signatureFor(id, secret) {
  return crypto.createHmac('sha256', secret).update(id).digest('base64url');
}

function readCookie(req) {
  const cookies = req.headers.cookie || '';
  for (const item of cookies.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== COOKIE_NAME) continue;
    try {
      return decodeURIComponent(item.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function verifiedSessionId(req, secret) {
  const value = readCookie(req);
  if (!value) return null;
  const match = /^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!match) return null;
  const expected = Buffer.from(signatureFor(match[1], secret));
  const actual = Buffer.from(match[2]);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual) ? match[1] : null;
}

function cookieValue(id, secret) {
  return `${COOKIE_NAME}=${id}.${signatureFor(id, secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

function createAuthSessionMiddleware(db, secret) {
  const sessions = () => db.collection('sessions');
  return async function authSessionMiddleware(req, res, next) {
    try {
      const id = verifiedSessionId(req, secret);
      let currentId = id;
      const record = id ? await sessions().findOne({ _id: id, expiresAt: { $gt: new Date() } }) : null;
      req.authSession = record?.data || null;
      req.createAuthSession = async (data) => {
        if (currentId) await sessions().deleteOne({ _id: currentId });
        const newId = crypto.randomBytes(32).toString('base64url');
        await sessions().insertOne({
          _id: newId,
          data,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + SESSION_TTL_MS)
        });
        currentId = newId;
        req.authSession = data;
        res.setHeader('Set-Cookie', cookieValue(newId, secret));
      };
      req.clearAuthSession = async () => {
        if (currentId) await sessions().deleteOne({ _id: currentId });
        currentId = null;
        req.authSession = null;
        res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = { createAuthSessionMiddleware, SESSION_TTL_MS };
