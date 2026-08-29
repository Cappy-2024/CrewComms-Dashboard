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

    sectionTabs: document.getElementById("sectionTabs"),
    permissionsView: document.getElementById("permissionsView"),
    pointrolesView: document.getElementById("pointrolesView"),
    tickView: document.getElementById("tickView"),
    multipliersView: document.getElementById("multipliersView"),

    managerRolesList: document.getElementById("managerRolesList"),
    saveManagerRolesBtn: document.getElementById("saveManagerRolesBtn"),
    managerRolesMessage: document.getElementById("managerRolesMessage"),

    commandsList: document.getElementById("commandsList"),
    commandsEmpty: document.getElementById("commandsEmpty"),

    pointRoleRows: document.getElementById("pointRoleRows"),
    addPointRoleBtn: document.getElementById("addPointRoleBtn"),
    savePointRolesBtn: document.getElementById("savePointRolesBtn"),
    pointRolesMessage: document.getElementById("pointRolesMessage"),

    pointsPerTickInput: document.getElementById("pointsPerTickInput"),
    tickMinutesInput: document.getElementById("tickMinutesInput"),
    saveTickBtn: document.getElementById("saveTickBtn"),
    tickMessage: document.getElementById("tickMessage"),

    multiplierRows: document.getElementById("multiplierRows"),
    addMultiplierBtn: document.getElementById("addMultiplierBtn"),
    saveMultipliersBtn: document.getElementById("saveMultipliersBtn"),
    multipliersMessage: document.getElementById("multipliersMessage"),
  };

  const roleValueRowTpl = document.getElementById("roleValueRowTemplate");
  const commandCardTpl = document.getElementById("commandCardTemplate");

  let guildData = null; // { roles, commands, settings, managerRoles, pointRoles, multipliers }

  function setMessage(mountEl, text, kind) {
    mountEl.textContent = text || "";
    mountEl.dataset.kind = kind || "";
  }

  function showOnly(sectionEl) {
    for (const s of [el.gate, el.loading, el.denied, el.authorized]) s.hidden = s !== sectionEl;
  }

  // -------------------------------------------------------------- manager roles
  function renderManagerRoles() {
    const selectedIds = new Set(guildData.managerRoles.map((r) => r.id));
    el.managerRolesList.innerHTML = "";
    for (const role of guildData.roles) {
      const label = document.createElement("label");
      label.className = "role-check";
      label.innerHTML = `
        <input type="checkbox" value="${B.esc(role.id)}" ${selectedIds.has(role.id) ? "checked" : ""} />
        <span>${B.esc(role.name)}</span>
      `;
      el.managerRolesList.appendChild(label);
    }
    if (!guildData.roles.length) {
      el.managerRolesList.innerHTML = `<p class="empty-state">No roles found for this server.</p>`;
    }
  }

  el.saveManagerRolesBtn.addEventListener("click", async () => {
    const checked = [...el.managerRolesList.querySelectorAll("input:checked")];
    const roles = checked.map((cb) => {
      const role = guildData.roles.find((r) => r.id === cb.value);
      return { id: cb.value, name: role?.name || cb.value };
    });

    el.saveManagerRolesBtn.disabled = true;
    setMessage(el.managerRolesMessage, "Saving…", "info");
    const { data, error } = await B.callFunction("bot-dashboard", { action: "save-manager-roles", guildId, roles });
    el.saveManagerRolesBtn.disabled = false;

    if (error) return setMessage(el.managerRolesMessage, await B.extractFunctionError(error), "error");
    if (data?.error) return setMessage(el.managerRolesMessage, data.error, "error");
    guildData.managerRoles = roles;
    setMessage(el.managerRolesMessage, "Saved!", "success");
  });

  // -------------------------------------------------------------- commands
  function renderCommands() {
    el.commandsList.innerHTML = "";
    el.commandsEmpty.hidden = guildData.commands.length !== 0;

    for (const command of guildData.commands) {
      const node = commandCardTpl.content.cloneNode(true);
      node.querySelector("[data-command-name]").textContent = `/${command.name}`;

      const badge = node.querySelector("[data-command-badge]");
      badge.textContent = command.everyone ? "Everyone" : "Restricted";
      badge.className = `badge ${command.everyone ? "badge--status-approved" : "badge--status-pending"}`;

      const everyoneCheckbox = node.querySelector("[data-everyone-checkbox]");
      everyoneCheckbox.checked = command.everyone;

      const rolesList = node.querySelector("[data-command-roles]");
      rolesList.hidden = command.everyone;
      const selectedIds = new Set(command.roles.map((r) => r.id));
      for (const role of guildData.roles) {
        const label = document.createElement("label");
        label.className = "role-check";
        label.innerHTML = `
          <input type="checkbox" value="${B.esc(role.id)}" ${selectedIds.has(role.id) ? "checked" : ""} />
          <span>${B.esc(role.name)}</span>
        `;
        rolesList.appendChild(label);
      }

      everyoneCheckbox.addEventListener("change", () => {
        rolesList.hidden = everyoneCheckbox.checked;
      });

      const head = node.querySelector("[data-toggle]");
      const body = node.querySelector("[data-body]");
      head.addEventListener("click", () => {
        body.hidden = !body.hidden;
      });

      const message = node.querySelector("[data-command-message]");
      const saveBtn = node.querySelector("[data-save-command]");
      saveBtn.addEventListener("click", async () => {
        const everyone = everyoneCheckbox.checked;
        const checked = [...rolesList.querySelectorAll("input:checked")];
        const roles = checked.map((cb) => {
          const role = guildData.roles.find((r) => r.id === cb.value);
          return { id: cb.value, name: role?.name || cb.value };
        });

        saveBtn.disabled = true;
        setMessage(message, "Saving…", "info");
        const { data, error } = await B.callFunction("bot-dashboard", {
          action: "save-command-permissions",
          guildId,
          commandName: command.name,
          everyone,
          roles,
        });
        saveBtn.disabled = false;

        if (error) return setMessage(message, await B.extractFunctionError(error), "error");
        if (data?.error) return setMessage(message, data.error, "error");
        badge.textContent = everyone ? "Everyone" : "Restricted";
        badge.className = `badge ${everyone ? "badge--status-approved" : "badge--status-pending"}`;
        setMessage(message, "Saved!", "success");
      });

      el.commandsList.appendChild(node);
    }
  }

  // -------------------------------------------------------------- role+value rows (point roles / multipliers)
  function addRoleValueRow(container, existing, { placeholder, step, min }) {
    const node = roleValueRowTpl.content.cloneNode(true);
    const select = node.querySelector("[data-role-select]");
    const input = node.querySelector("[data-value-input]");
    const removeBtn = node.querySelector("[data-remove-row]");

    select.innerHTML = guildData.roles.map((r) => `<option value="${B.esc(r.id)}">${B.esc(r.name)}</option>`).join("");
    if (existing?.id) select.value = existing.id;

    input.placeholder = placeholder;
    input.step = step;
    input.min = min;
    if (existing?.value != null) input.value = existing.value;

    const rowEl = node.querySelector(".role-value-row");
    removeBtn.addEventListener("click", () => rowEl.remove());

    container.appendChild(node);
  }

  function readRoleValueRows(container) {
    const rows = [...container.querySelectorAll(".role-value-row")];
    const seen = new Map(); // de-dupe by role id, keep the last row for that role
    for (const row of rows) {
      const roleId = row.querySelector("[data-role-select]").value;
      const value = row.querySelector("[data-value-input]").value;
      const role = guildData.roles.find((r) => r.id === roleId);
      seen.set(roleId, { id: roleId, name: role?.name || roleId, value: Number(value) });
    }
    return [...seen.values()];
  }

  function renderPointRoles() {
    el.pointRoleRows.innerHTML = "";
    for (const r of guildData.pointRoles) {
      addRoleValueRow(el.pointRoleRows, { id: r.id, value: r.threshold }, { placeholder: "Points needed", step: 1, min: 0 });
    }
  }
  el.addPointRoleBtn.addEventListener("click", () => {
    addRoleValueRow(el.pointRoleRows, null, { placeholder: "Points needed", step: 1, min: 0 });
  });
  el.savePointRolesBtn.addEventListener("click", async () => {
    const rows = readRoleValueRows(el.pointRoleRows).map((r) => ({ id: r.id, name: r.name, threshold: r.value }));
    el.savePointRolesBtn.disabled = true;
    setMessage(el.pointRolesMessage, "Saving…", "info");
    const { data, error } = await B.callFunction("bot-dashboard", { action: "save-point-roles", guildId, roles: rows });
    el.savePointRolesBtn.disabled = false;
    if (error) return setMessage(el.pointRolesMessage, await B.extractFunctionError(error), "error");
    if (data?.error) return setMessage(el.pointRolesMessage, data.error, "error");
    setMessage(el.pointRolesMessage, "Saved!", "success");
  });

  function renderMultipliers() {
    el.multiplierRows.innerHTML = "";
    for (const r of guildData.multipliers) {
      addRoleValueRow(el.multiplierRows, { id: r.id, value: r.multiplier }, { placeholder: "e.g. 1.5", step: 0.1, min: 0 });
    }
  }
  el.addMultiplierBtn.addEventListener("click", () => {
    addRoleValueRow(el.multiplierRows, null, { placeholder: "e.g. 1.5", step: 0.1, min: 0 });
  });
  el.saveMultipliersBtn.addEventListener("click", async () => {
    const rows = readRoleValueRows(el.multiplierRows).map((r) => ({ id: r.id, name: r.name, multiplier: r.value }));
    el.saveMultipliersBtn.disabled = true;
    setMessage(el.multipliersMessage, "Saving…", "info");
    const { data, error } = await B.callFunction("bot-dashboard", { action: "save-multipliers", guildId, roles: rows });
    el.saveMultipliersBtn.disabled = false;
    if (error) return setMessage(el.multipliersMessage, await B.extractFunctionError(error), "error");
    if (data?.error) return setMessage(el.multipliersMessage, data.error, "error");
    setMessage(el.multipliersMessage, "Saved!", "success");
  });

  // -------------------------------------------------------------- tick
  function renderTick() {
    el.pointsPerTickInput.value = guildData.settings.points_per_tick;
    el.tickMinutesInput.value = guildData.settings.tick_minutes;
  }
  el.saveTickBtn.addEventListener("click", async () => {
    const pointsPerTick = Number(el.pointsPerTickInput.value);
    const tickMinutes = Number(el.tickMinutesInput.value);
    el.saveTickBtn.disabled = true;
    setMessage(el.tickMessage, "Saving…", "info");
    const { data, error } = await B.callFunction("bot-dashboard", {
      action: "save-settings",
      guildId,
      pointsPerTick,
      tickMinutes,
    });
    el.saveTickBtn.disabled = false;
    if (error) return setMessage(el.tickMessage, await B.extractFunctionError(error), "error");
    if (data?.error) return setMessage(el.tickMessage, data.error, "error");
    setMessage(el.tickMessage, "Saved!", "success");
  });

  B.wireTabs(
    el.sectionTabs,
    {
      permissions: el.permissionsView,
      pointroles: el.pointrolesView,
      tick: el.tickView,
      multipliers: el.multipliersView,
    },
    { defaultView: "permissions" }
  );

  // -------------------------------------------------------------- auth flow
  async function loadGuild() {
    showOnly(el.loading);
    const { data, error } = await B.callFunction("bot-dashboard", { action: "get-guild-data", guildId });

    if (error) {
      el.deniedMessage.textContent = await B.extractFunctionError(error);
      showOnly(el.denied);
      return;
    }
    if (data?.error) {
      el.deniedMessage.textContent = data.error;
      showOnly(el.denied);
      return;
    }

    guildData = data;
    renderManagerRoles();
    renderCommands();
    renderPointRoles();
    renderMultipliers();
    renderTick();
    showOnly(el.authorized);
  }

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
    await loadGuild();
  }

  el.loginBtn.addEventListener("click", () => B.signInWithDiscord());

  B.initAuth(handleSession);
})();
