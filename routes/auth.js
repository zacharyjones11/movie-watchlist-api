const crypto = require('node:crypto');
const { requireAuth, requireCsrf } = require('../middleware/require-auth');

function publicUser(user) {
  return {
    id: user._id.toString(),
    username: user.githubUsername,
    displayName: user.displayName,
    email: user.email,
    avatarUrl: user.avatarUrl
  };
}

function constantTimeMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createAuthRouter(db, provider) {
  const router = require('express').Router();
  router.get('/github', async (req, res, next) => {
    if (!provider.isConfigured()) return res.status(503).json({ error: 'GitHub OAuth is not configured on this server' });
    try {
      const state = crypto.randomBytes(32).toString('base64url');
      await req.createAuthSession({ ...(req.authSession || {}), oauthState: state });
      res.redirect(302, provider.authorizationUrl(state));
    } catch (error) {
      next(error);
    }
  });

  router.get('/github/callback', async (req, res, next) => {
    const { code, state, error: oauthError } = req.query;
    if (oauthError) {
      try { await req.clearAuthSession(); } catch (error) { return next(error); }
      return res.status(401).json({ error: 'GitHub sign-in was cancelled or rejected' });
    }
    if (typeof code !== 'string' || !constantTimeMatch(state, req.authSession?.oauthState)) {
      try { await req.clearAuthSession(); } catch (error) { return next(error); }
      return res.status(400).json({ error: 'Invalid or expired OAuth state; restart sign-in' });
    }

    try {
      const profile = await provider.getProfile(code);
      const now = new Date();
      const result = await db.collection('users').findOneAndUpdate(
        { githubId: profile.githubId },
        {
          $set: {
            githubUsername: profile.username,
            displayName: profile.displayName,
            email: profile.email,
            avatarUrl: profile.avatarUrl,
            updatedAt: now
          },
          $setOnInsert: { createdAt: now }
        },
        { upsert: true, returnDocument: 'after' }
      );
      const user = result;
      await req.createAuthSession({
        userId: user._id.toString(),
        csrfToken: crypto.randomBytes(32).toString('base64url')
      });
      res.redirect(302, '/api-docs/');
    } catch (failure) {
      // Never log OAuth codes, access tokens, secrets, or upstream response bodies.
      console.error('GitHub OAuth sign-in failed');
      next(failure);
    }
  });

  router.get('/me', requireAuth(db), (req, res) => {
    res.json({ user: publicUser(req.user), csrfToken: req.authSession.csrfToken });
  });

  router.post('/logout', requireAuth(db), requireCsrf, async (req, res, next) => {
    try {
      await req.clearAuthSession();
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAuthRouter, publicUser };
