// Shared across every page. Loaded after config.js and the supabase-js
// CDN script.
window.BD = (() => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.BOT_DASHBOARD_CONFIG;
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function esc(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
  }

  function formatNumber(n) {
    return new Intl.NumberFormat().format(Math.round(Number(n) || 0));
  }

  // supabase-js collapses any non-2xx Edge Function response into a generic
  // "Edge Function returned a non-2xx status code" and hides the response
  // body — the actual { error: "..." } message is still on the raw
  // Response object at error.context, so pull it out from there.
  async function extractFunctionError(error) {
    if (!error) return "Something went wrong. Try again.";
    try {
      if (error.context && typeof error.context.json === "function") {
        const body = await error.context.json();
        if (body?.error) return body.error;
      }
    } catch (_) {}
    return error.message || "Something went wrong. Try again.";
  }

  // Discord's OAuth access token (needed so the Edge Functions can re-check
  // your live server permissions) only exists on the session object right
  // after signing in — Supabase doesn't persist it across a token refresh.
  // If this comes back empty, the fix is always "sign out and back in".
  async function getDiscordAccessToken() {
    const { data } = await sb.auth.getSession();
    return data.session?.provider_token || null;
  }

  // Every privileged action needs the Discord access token alongside it —
  // this wrapper fetches it fresh and attaches it, so page code never has
  // to think about it.
  async function callFunction(name, body = {}) {
    const discordAccessToken = await getDiscordAccessToken();
    return sb.functions.invoke(name, { body: { ...body, discordAccessToken } });
  }

  function renderAuthArea(mountEl, user) {
    if (!user) {
      mountEl.innerHTML = "";
      return;
    }
    const name = user.user_metadata?.full_name || user.user_metadata?.name || "there";
    const avatarUrl = user.user_metadata?.avatar_url;
    const initial = esc(name.slice(0, 1).toUpperCase());
    mountEl.innerHTML = `
      <div class="auth__user">
        ${avatarUrl ? `<img class="auth__avatar" src="${esc(avatarUrl)}" alt="" style="object-fit:cover" />` : `<span class="auth__avatar">${initial}</span>`}
        <span>${esc(name)}</span>
      </div>
      <button class="btn btn--ghost btn--small" id="logoutBtn">Sign out</button>
    `;
    document.getElementById("logoutBtn").addEventListener("click", () => sb.auth.signOut());
  }

  // supabase-js re-validates the session whenever the tab regains focus,
  // firing the same event a real sign-in fires — this only calls the
  // handler when the signed-in user actually changes, not on every
  // background refresh (otherwise every tab switch would reset the page).
  function initAuth(handler) {
    let lastUserId;
    const maybeHandle = (session) => {
      const uid = session?.user?.id || null;
      if (uid === lastUserId) return;
      lastUserId = uid;
      handler(session);
    };
    sb.auth.onAuthStateChange((_event, session) => maybeHandle(session));
    sb.auth.getSession().then(({ data }) => maybeHandle(data.session));
  }

  // The extra scopes here are the whole reason this works: `identify` is
  // Supabase's default, but `guilds` is what lets the dashboard ask
  // Discord which servers you're actually in (and your permissions in
  // each) — without it, there'd be no way to build the server picker.
  function signInWithDiscord() {
    sb.auth.signInWithOAuth({
      provider: "discord",
      options: {
        scopes: "identify guilds",
        redirectTo: window.location.href,
      },
    });
  }

  // Wires a set of [data-view] tab buttons/links to show/hide matching
  // panels. Returns a setActive(key) function; pass onShow to run
  // something (like a lazy data load) the first time a tab is opened.
  function wireTabs(navEl, panels, { onShow, defaultView } = {}) {
    const shown = new Set();
    function setActive(view) {
      for (const [key, panelEl] of Object.entries(panels)) {
        panelEl.hidden = key !== view;
      }
      for (const btn of navEl.querySelectorAll("[data-view]")) {
        btn.classList.toggle("tab--active", btn.dataset.view === view);
      }
      if (onShow && !shown.has(view)) {
        shown.add(view);
        onShow(view);
      }
    }
    navEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-view]");
      if (btn) setActive(btn.dataset.view);
    });
    if (defaultView) setActive(defaultView);
    return setActive;
  }

  // Reads ?guild=<id> from the current page's URL — every page past the
  // picker needs to know which server it's configuring.
  function getGuildIdFromUrl() {
    return new URLSearchParams(window.location.search).get("guild");
  }

  return {
    sb,
    esc,
    formatNumber,
    extractFunctionError,
    getDiscordAccessToken,
    callFunction,
    renderAuthArea,
    initAuth,
    signInWithDiscord,
    wireTabs,
    getGuildIdFromUrl,
  };
})();
