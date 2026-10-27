const { URL } = require('node:url');

const API_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'movie-watchlist-api'
};

function createGithubOAuth(env = process.env, fetchImpl = fetch) {
  const baseUrl = (env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${env.PORT || 8081}`).replace(/\/+$/, '');
  const callbackUrl = env.GITHUB_CALLBACK_URL || `${baseUrl}/auth/github/callback`;
  const clientId = env.GITHUB_CLIENT_ID;
  const clientSecret = env.GITHUB_CLIENT_SECRET;

  return {
    isConfigured() {
      return Boolean(clientId && clientSecret && callbackUrl);
    },
    authorizationUrl(state) {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', callbackUrl);
      url.searchParams.set('scope', 'read:user user:email');
      url.searchParams.set('state', state);
      return url.toString();
    },
    async getProfile(code) {
      const tokenResponse = await fetchImpl('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callbackUrl }),
        signal: AbortSignal.timeout(10000)
      });
      if (!tokenResponse.ok) throw new Error('OAuth token exchange failed');
      const tokenBody = await tokenResponse.json();
      if (!tokenBody.access_token) throw new Error('OAuth token exchange failed');

      const headers = {
        ...API_HEADERS,
        authorization: `Bearer ${tokenBody.access_token}`
      };
      const profileResponse = await fetchImpl('https://api.github.com/user', {
        headers,
        signal: AbortSignal.timeout(10000)
      });
      if (!profileResponse.ok) throw new Error('OAuth profile request failed');
      const profile = await profileResponse.json();
      if (profile.id === undefined || !profile.login) throw new Error('OAuth profile response was incomplete');

      let email = null;
      const emailsResponse = await fetchImpl('https://api.github.com/user/emails', {
        headers,
        signal: AbortSignal.timeout(10000)
      });
      if (emailsResponse.ok) {
        const emails = await emailsResponse.json();
        email = emails.find((item) => item.primary && item.verified)?.email || null;
      }
      return {
        githubId: String(profile.id),
        username: profile.login,
        displayName: profile.name || profile.login,
        email,
        avatarUrl: profile.avatar_url || null
      };
    }
  };
}

module.exports = { createGithubOAuth };
