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

async function apiFetch(path, options = {}) {
  const session = Auth.getSession();
  const headers = Object.assign({}, options.headers, {
    'Content-Type': 'application/json'
  });
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;

  const res = await fetch(`${CONFIG.API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) Auth.logout();
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}
