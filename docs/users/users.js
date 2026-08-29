(() => {
  const B = window.BD;
  const guildId = B.getGuildIdFromUrl();
  const guildName = new URLSearchParams(window.location.search).get("name") || "this server";

  const el = {
    authArea: document.getElementById("authArea"),
    guildEyebrow: document.getElementById("guildEyebrow"),
    guildTitle: document.getElementById("guildTitle"),
    settingsLink: document.getElementById("settingsLink"),
    usersLink: document.getElementById("usersLink"),
    gate: document.getElementById("gate"),
    loading: document.getElementById("loading"),
    denied: document.getElementById("denied"),
    deniedMessage: document.getElementById("deniedMessage"),
    authorized: document.getElementById("authorized"),
    loginBtn: document.getElementById("loginBtn"),
    searchInput: document.getElementById("searchInput"),
    memberResults: document.getElementById("memberResults"),
    memberEmpty: document.getElementById("memberEmpty"),
  };

  const memberRowTpl = document.getElementById("memberRowTemplate");

  function setMessage(mountEl, text, kind) {
    mountEl.textContent = text || "";
    mountEl.dataset.kind = kind || "";
  }

  function showOnly(sectionEl) {
    for (const s of [el.gate, el.loading, el.denied, el.authorized]) s.hidden = s !== sectionEl;
  }

  function renderMember(member) {
    const node = memberRowTpl.content.cloneNode(true);
    const avatar = node.querySelector("[data-avatar]");
    avatar.src = member.avatar || "https://cdn.discordapp.com/embed/avatars/0.png";
    node.querySelector("[data-name]").textContent = member.username;
    const pointsEl = node.querySelector("[data-points]");
    pointsEl.textContent = `${B.formatNumber(member.points)} pts`;

    const editBtn = node.querySelector("[data-edit-btn]");
    const editor = node.querySelector("[data-editor]");
    editBtn.addEventListener("click", () => {
      editor.hidden = !editor.hidden;
    });

    const modeSelect = node.querySelector("[data-mode]");
    const amountInput = node.querySelector("[data-amount]");
    const confirmBtn = node.querySelector("[data-confirm-btn]");
    const message = node.querySelector("[data-editor-message]");

    confirmBtn.addEventListener("click", async () => {
      const amount = Number(amountInput.value);
      if (!Number.isFinite(amount)) {
        setMessage(message, "Enter a number.", "error");
        return;
      }
      confirmBtn.disabled = true;
      setMessage(message, "Saving…", "info");

      const { data, error } = await B.callFunction("bot-dashboard-users", {
        action: "set-points",
        guildId,
        userId: member.id,
        username: member.username,
        mode: modeSelect.value,
        amount,
      });

      confirmBtn.disabled = false;

      if (error) return setMessage(message, await B.extractFunctionError(error), "error");
      if (data?.error) return setMessage(message, data.error, "error");

      member.points = data.points;
      pointsEl.textContent = `${B.formatNumber(data.points)} pts`;
      amountInput.value = "";
      setMessage(message, "Saved!", "success");
    });

    return node;
  }

  let searchTimer = null;
  el.searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 300);
  });

  async function runSearch() {
    const query = el.searchInput.value.trim();
    if (!query) {
      el.memberResults.innerHTML = "";
      el.memberEmpty.hidden = true;
      return;
    }

    const { data, error } = await B.callFunction("bot-dashboard-users", { action: "search-members", guildId, query });

    if (error || data?.error) {
      console.error("search-members error:", error || data.error);
      el.memberResults.innerHTML = "";
      el.memberEmpty.hidden = false;
      el.memberEmpty.textContent = (data && data.error) || "Couldn't search right now.";
      return;
    }

    const members = data?.members || [];
    el.memberResults.innerHTML = "";
    el.memberEmpty.hidden = members.length !== 0;
    el.memberEmpty.textContent = "No members found — try a different search.";
    for (const m of members) el.memberResults.appendChild(renderMember(m));
  }

  // -------------------------------------------------------------- auth flow
  async function handleSession(session) {
    if (!guildId) {
      el.deniedMessage.textContent = "No server selected — go back and pick one.";
      showOnly(el.denied);
      return;
    }

    const qs = `?guild=${encodeURIComponent(guildId)}&name=${encodeURIComponent(guildName)}`;
    el.settingsLink.href = `../settings/${qs}`;
    el.usersLink.href = `../users/${qs}`;
    el.guildTitle.textContent = guildName;
    el.guildEyebrow.textContent = "Configuring";

    if (!session) {
      B.renderAuthArea(el.authArea, null);
      showOnly(el.gate);
      return;
    }
    B.renderAuthArea(el.authArea, session.user);

    // A cheap access check: try a search-members call with an empty query
    // (returns instantly, no Discord call) — a 403 confirms we shouldn't
    // show this page before the user types anything real.
    showOnly(el.loading);
    const { data, error } = await B.callFunction("bot-dashboard-users", { action: "search-members", guildId, query: "" });
    if (error || data?.error) {
      el.deniedMessage.textContent = (data && data.error) || (await B.extractFunctionError(error));
      showOnly(el.denied);
      return;
    }
    showOnly(el.authorized);
  }

  el.loginBtn.addEventListener("click", () => B.signInWithDiscord());

  B.initAuth(handleSession);
})();
