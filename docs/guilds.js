(() => {
  const B = window.BD;

  const el = {
    authArea: document.getElementById("authArea"),
    gate: document.getElementById("gate"),
    loading: document.getElementById("loading"),
    noGuilds: document.getElementById("noGuilds"),
    noGuildsError: document.getElementById("noGuildsError"),
    guildListView: document.getElementById("guildListView"),
    guildGrid: document.getElementById("guildGrid"),
    loginBtn: document.getElementById("loginBtn"),
  };

  function showOnly(sectionEl) {
    for (const s of [el.gate, el.loading, el.noGuilds, el.guildListView]) {
      s.hidden = s !== sectionEl;
    }
  }

  function renderGuilds(guilds) {
    el.guildGrid.innerHTML = "";
    for (const g of guilds) {
      const card = document.createElement("a");
      card.className = "guild-card";
      card.href = `settings/?guild=${encodeURIComponent(g.id)}&name=${encodeURIComponent(g.name)}`;
      card.innerHTML = `
        ${g.icon ? `<img class="guild-card__icon" src="${B.esc(g.icon)}" alt="" />` : `<span class="guild-card__icon guild-card__icon--fallback">${B.esc(g.name.slice(0, 1).toUpperCase())}</span>`}
        <span class="guild-card__name">${B.esc(g.name)}</span>
      `;
      el.guildGrid.appendChild(card);
    }
  }

  async function loadGuilds() {
    showOnly(el.loading);

    const { data, error } = await B.callFunction("bot-dashboard", { action: "list-guilds" });

    if (error) {
      el.noGuildsError.textContent = await B.extractFunctionError(error);
      showOnly(el.noGuilds);
      return;
    }
    if (data?.error) {
      el.noGuildsError.textContent = data.error;
      showOnly(el.noGuilds);
      return;
    }

    const guilds = data?.guilds || [];
    if (!guilds.length) {
      el.noGuildsError.textContent = "";
      showOnly(el.noGuilds);
      return;
    }

    renderGuilds(guilds);
    showOnly(el.guildListView);
  }

  async function handleSession(session) {
    if (!session) {
      B.renderAuthArea(el.authArea, null);
      showOnly(el.gate);
      return;
    }
    B.renderAuthArea(el.authArea, session.user);
    await loadGuilds();
  }

  el.loginBtn.addEventListener("click", () => B.signInWithDiscord());

  B.initAuth(handleSession);
})();
