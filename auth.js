const Auth = {
  getSession() {
    const raw = localStorage.getItem('att_session');
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      if (session.expiresAt && Date.now() > session.expiresAt) {
        localStorage.removeItem('att_session');
        return null;
      }
      return session;
    } catch {
      return null;
    }
  },

  setSession(accessToken, expiresIn, user) {
    const session = {
      accessToken,
      user,
      expiresAt: Date.now() + expiresIn * 1000
    };
    localStorage.setItem('att_session', JSON.stringify(session));
  },

  logout() {
    localStorage.removeItem('att_session');
    window.location.href = 'index.html';
  },

  requireSession() {
    const session = this.getSession();
    if (!session) {
      window.location.href = 'index.html';
      return null;
    }
    return session;
  },

  loginUrl() {
    const params = new URLSearchParams({
      client_id: CONFIG.DISCORD_CLIENT_ID,
      redirect_uri: CONFIG.REDIRECT_URI,
      response_type: 'code',
      scope: 'identify guilds'
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
  }
};

async function apiFetch(path, options = {}, _retried = false) {
  const session = Auth.getSession();
  const headers = Object.assign({}, options.headers, {
    'Content-Type': 'application/json'
  });
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;

  const res = await fetch(`${CONFIG.API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // 503 here means "Discord API hiccup, not an actual auth problem" —
    // worth one automatic retry before bothering the user.
    if (res.status === 503 && !_retried) {
      await new Promise(r => setTimeout(r, 1000));
      return apiFetch(path, options, true);
    }
    if (res.status === 401) Auth.logout();
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

/** Runs async request functions one at a time instead of all at once,
 *  to avoid bursting Discord's rate limits with simultaneous calls. */
async function apiFetchSequential(fns) {
  const results = [];
  for (const fn of fns) results.push(await fn());
  return results;
}
