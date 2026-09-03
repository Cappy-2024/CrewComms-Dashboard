const session = Auth.requireSession();
const urlParams = new URLSearchParams(window.location.search);
const GUILD_ID = urlParams.get('guild');
const GUILD_NAME = urlParams.get('name') || 'Server';

if (!GUILD_ID) window.location.href = 'guilds.html';

let ROLES = [];
let USERS = [];
let SETTINGS = null;

document.getElementById('whoami').textContent = session.user.username;
document.getElementById('guildName').textContent = GUILD_NAME;

// ---- Tabs ----
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => (p.style.display = 'none'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).style.display = 'block';
  });
});

function toast(message, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show ${type}`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ROLES never changes after the initial load, so the lookup map and the
// <option> markup are built once instead of on every render. Rebuilding the
// option list per row was O(rows x roles) string concatenation, which shows
// up on servers with a lot of roles.
let ROLE_NAMES = new Map();
let ROLE_OPTIONS_HTML = '';

function indexRoles() {
  ROLE_NAMES = new Map(ROLES.map(r => [r.id, r.name]));
  ROLE_OPTIONS_HTML =
    '<option value="everyone">@everyone</option>' +
    ROLES.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
}

function roleName(roleId) {
  if (roleId === 'everyone') return '@everyone';
  return ROLE_NAMES.get(roleId) || `Unknown role (${roleId})`;
}

/** Options markup only — callers set the current value on the <select>
 *  afterwards via selectRole(), which is equivalent to the `selected`
 *  attribute this used to inline per option. */
function roleOptionsHtml() {
  return ROLE_OPTIONS_HTML;
}

function selectRole(select, roleId) {
  if (roleId) select.value = roleId;
}

// ---- Initial load ----
async function init() {
  try {
    const [rolesRes, settingsRes, usersRes] = await apiFetchSequential([
      () => apiFetch(`/guilds/${GUILD_ID}/roles`),
      () => apiFetch(`/guilds/${GUILD_ID}/settings`),
      () => apiFetch(`/guilds/${GUILD_ID}/points`)
    ]);
    ROLES = rolesRes.roles;
    SETTINGS = settingsRes;
    USERS = usersRes.users;

    indexRoles();
    indexUsers();

    renderPointsSettings();
    renderManagerRoles();
    renderCommandPerms();
    renderRewards();
    renderMultipliers();
    renderUsers();
  } catch (err) {
    toast(err.message, 'error');
  }
}
init();

// ---- Points settings ----
function renderPointsSettings() {
  document.getElementById('pointsPerTick').value = SETTINGS.guild_settings.points_per_tick;
  document.getElementById('tickMinutes').value = SETTINGS.guild_settings.tick_minutes;
  document.getElementById('shortSessionPoints').value = SETTINGS.guild_settings.short_session_points;
}

async function savePointsSettings() {
  try {
    await apiFetch(`/guilds/${GUILD_ID}/settings`, {
      method: 'PUT',
      body: JSON.stringify({
        guild_settings: {
          points_per_tick: Number(document.getElementById('pointsPerTick').value),
          tick_minutes: Number(document.getElementById('tickMinutes').value),
          short_session_points: Number(document.getElementById('shortSessionPoints').value)
        }
      })
    });
    toast('Point settings saved');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---- Manager roles ----
function renderManagerRoles() {
  const container = document.getElementById('managerRolesList');
  container.innerHTML = '';
  ROLES.forEach(r => {
    const checked = SETTINGS.manager_roles.includes(r.id) ? 'checked' : '';
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<label><input type="checkbox" value="${r.id}" class="manager-role-checkbox" ${checked}/> ${r.name}</label>`;
    container.appendChild(row);
  });
  if (!ROLES.length) container.innerHTML = '<p class="muted">No roles found.</p>';
}

async function saveManagerRoles() {
  const selected = Array.from(document.querySelectorAll('.manager-role-checkbox:checked')).map(el => el.value);
  try {
    await apiFetch(`/guilds/${GUILD_ID}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ manager_roles: selected })
    });
    SETTINGS.manager_roles = selected;
    toast('Manager roles saved');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---- Command permissions ----
function renderCommandPerms() {
  const container = document.getElementById('commandPermsList');
  container.innerHTML = '';

  SETTINGS.commands.forEach(cmd => {
    const existing = SETTINGS.command_permissions.filter(p => p.command_name === cmd).map(p => p.role_id);
    const wrapper = document.createElement('div');
    wrapper.className = 'card';
    wrapper.style.background = 'transparent';
    wrapper.innerHTML = `
      <div class="field-row" style="border-bottom:none;">
        <strong>/${cmd}</strong>
      </div>
      <div id="cmdRoles-${cmd}"></div>
      <div class="field-row" style="border-bottom:none;">
        <select id="cmdAdd-${cmd}">${roleOptionsHtml()}</select>
        <button class="btn secondary small" onclick="addCommandRole('${cmd}')">+ Add role</button>
      </div>
    `;
    container.appendChild(wrapper);

    const list = wrapper.querySelector(`#cmdRoles-${cmd}`);
    existing.forEach(roleId => list.appendChild(commandRoleChip(cmd, roleId)));
  });
}

function commandRoleChip(cmd, roleId) {
  const chip = document.createElement('div');
  chip.className = 'list-row';
  chip.dataset.role = roleId;
  chip.innerHTML = `<span class="badge">${roleName(roleId)}</span>`;
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn secondary small';
  removeBtn.textContent = 'Remove';
  removeBtn.onclick = () => chip.remove();
  chip.appendChild(removeBtn);
  return chip;
}

function addCommandRole(cmd) {
  const select = document.getElementById(`cmdAdd-${cmd}`);
  const roleId = select.value;
  const list = document.getElementById(`cmdRoles-${cmd}`);
  if (list.querySelector(`[data-role="${roleId}"]`)) return; // already added
  list.appendChild(commandRoleChip(cmd, roleId));
}

async function saveCommandPerms() {
  const permissions = [];
  SETTINGS.commands.forEach(cmd => {
    const list = document.getElementById(`cmdRoles-${cmd}`);
    Array.from(list.children).forEach(chip => {
      permissions.push({ command_name: cmd, role_id: chip.dataset.role });
    });
  });
  try {
    await apiFetch(`/guilds/${GUILD_ID}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ command_permissions: permissions })
    });
    SETTINGS.command_permissions = permissions;
    toast('Command permissions saved');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---- Role rewards ----
function renderRewards() {
  const container = document.getElementById('rewardsList');
  container.innerHTML = '';
  SETTINGS.role_point_rewards.forEach(r => addRewardRow(r.role_id, r.points_threshold));
  if (!SETTINGS.role_point_rewards.length) addRewardRow();
}

function addRewardRow(roleId = null, threshold = 0) {
  const container = document.getElementById('rewardsList');
  const row = document.createElement('div');
  row.className = 'list-row';
  row.innerHTML = `
    <select class="reward-role">${roleOptionsHtml()}</select>
    <span>at</span>
    <input type="number" class="reward-threshold" value="${threshold}" min="0" style="width:100px" />
    <span>points</span>
  `;
  selectRole(row.querySelector('.reward-role'), roleId);
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn secondary small';
  removeBtn.textContent = 'Remove';
  removeBtn.onclick = () => row.remove();
  row.appendChild(removeBtn);
  container.appendChild(row);
}

async function saveRewards() {
  const rows = document.querySelectorAll('#rewardsList .list-row');
  const rewards = Array.from(rows).map(row => ({
    role_id: row.querySelector('.reward-role').value,
    points_threshold: Number(row.querySelector('.reward-threshold').value)
  }));
  try {
    await apiFetch(`/guilds/${GUILD_ID}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ role_point_rewards: rewards })
    });
    toast('Role rewards saved');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---- Multipliers ----
function renderMultipliers() {
  const container = document.getElementById('multipliersList');
  container.innerHTML = '';
  SETTINGS.role_multipliers.forEach(r => addMultiplierRow(r.role_id, r.multiplier));
  if (!SETTINGS.role_multipliers.length) addMultiplierRow();
}

function addMultiplierRow(roleId = null, multiplier = 1) {
  const container = document.getElementById('multipliersList');
  const row = document.createElement('div');
  row.className = 'list-row';
  row.innerHTML = `
    <select class="mult-role">${roleOptionsHtml()}</select>
    <span>x</span>
    <input type="number" class="mult-value" value="${multiplier}" min="0" step="0.1" style="width:100px" />
  `;
  selectRole(row.querySelector('.mult-role'), roleId);
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn secondary small';
  removeBtn.textContent = 'Remove';
  removeBtn.onclick = () => row.remove();
  row.appendChild(removeBtn);
  container.appendChild(row);
}

async function saveMultipliers() {
  const rows = document.querySelectorAll('#multipliersList .list-row');
  const multipliers = Array.from(rows).map(row => ({
    role_id: row.querySelector('.mult-role').value,
    multiplier: Number(row.querySelector('.mult-value').value)
  }));
  try {
    await apiFetch(`/guilds/${GUILD_ID}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ role_multipliers: multipliers })
    });
    toast('Multipliers saved');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---- User data manager ----
/** Precompute the lowercased haystack each row is searched against, so the
 *  filter below doesn't re-lowercase every username on every keystroke. */
function indexUsers() {
  USERS.forEach(u => {
    u._search = `${(u.username || '').toLowerCase()} ${u.user_id}`;
  });
}

function renderUsers() {
  const filter = (document.getElementById('userSearch')?.value || '').toLowerCase();
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = '';

  const filtered = filter ? USERS.filter(u => u._search.includes(filter)) : USERS;

  // Rows go into a fragment and land in the DOM in one insertion — appending
  // each <tr> directly forces the browser to reflow once per row, which is
  // what made typing in the search box feel sticky on big servers.
  const fragment = document.createDocumentFragment();

  filtered.forEach(u => {
    const tr = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.textContent = u.username ? `${u.username} (${u.user_id})` : u.user_id;

    const pointsCell = document.createElement('td');
    const pointsInput = document.createElement('input');
    pointsInput.type = 'number';
    pointsInput.value = u.points;
    pointsInput.style.width = '90px';
    pointsCell.appendChild(pointsInput);

    const actionCell = document.createElement('td');
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn secondary small';
    saveBtn.textContent = 'Save';
    saveBtn.onclick = () => updateUserPoints(u.user_id, Number(pointsInput.value));
    actionCell.appendChild(saveBtn);

    tr.appendChild(nameCell);
    tr.appendChild(pointsCell);
    tr.appendChild(actionCell);
    fragment.appendChild(tr);
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="muted">No users found.</td></tr>';
    return;
  }

  tbody.appendChild(fragment);
}

async function updateUserPoints(userId, points) {
  try {
    await apiFetch(`/guilds/${GUILD_ID}/points`, {
      method: 'PATCH',
      body: JSON.stringify({ user_id: userId, points })
    });
    const u = USERS.find(u => u.user_id === userId);
    if (u) u.points = points;
    toast('Points updated');
  } catch (err) {
    toast(err.message, 'error');
  }
}
