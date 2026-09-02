// Supabase Edge Function: "dashboard"
// Handles Discord OAuth2 code exchange + guild settings CRUD for the
// Among Tracker dashboard. This function holds the only copies of the
// Discord client secret, bot token, and Supabase service role key —
// none of those ever reach the static frontend.
//
// Routes (all prefixed with /dashboard, matched on the path AFTER the
// function name, i.e. what the client sees as e.g. POST /oauth):
//   POST  /oauth                        { code, redirect_uri } -> { access_token, expires_in, user }
//   GET   /guilds                       -> manageable guilds (bot present + caller is admin/manager)
//   GET   /guilds/:id/roles             -> guild's roles
//   GET   /guilds/:id/settings          -> all settings sections for the guild
//   PUT   /guilds/:id/settings          -> replace one or more settings sections
//   GET   /guilds/:id/points            -> user_points rows with best-effort usernames
//   PATCH /guilds/:id/points            { user_id, points } -> set a user's point total
//
// Every route except /oauth requires: Authorization: Bearer <discord_access_token>

import { createClient } from 'jsr:@supabase/supabase-js@2';

const DISCORD_API = 'https://discord.com/api/v10';
const CLIENT_ID = Deno.env.get('DISCORD_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('DISCORD_CLIENT_SECRET')!;
const BOT_TOKEN = Deno.env.get('DISCORD_BOT_TOKEN')!;
const ALLOWED_ORIGIN = Deno.env.get('DASHBOARD_ORIGIN') || '*';
const ADMINISTRATOR = 0x8;
const MANAGE_GUILD = 0x20;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

const COMMANDS = ['sessionstart', 'sessionend', 'editpoints', 'leaderboard'];

// ---- Discord API helpers ----

class DiscordApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function discordFetch(path: string, token: string, isBot = false) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: isBot ? `Bot ${token}` : `Bearer ${token}` }
  });
  if (!res.ok) throw new DiscordApiError(res.status, `Discord API ${path} failed: ${res.status}`);
  return res.json();
}

// Short-lived cache for "which guilds can this user manage" so that the
// dashboard's simultaneous /roles, /settings, /points requests (all of
// which independently re-verify the caller) don't trip Discord's rate
// limit by hitting /users/@me/guilds 3x at once with the same token.
const userGuildsCache = new Map<string, { data: any[]; expires: number }>();

async function getUserGuildsCached(token: string) {
  const cached = userGuildsCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.data;

  const data = await discordFetch('/users/@me/guilds', token);
  userGuildsCache.set(token, { data, expires: Date.now() + 8000 });
  return data;
}

async function exchangeCode(code: string, redirectUri: string) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Verifies the caller's Discord token grants them admin/manage rights on guildId,
 *  and that the bot is actually in that guild. Throws a Response on failure. */
async function requireGuildAdmin(req: Request, guildId: string) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw json({ error: 'Missing Authorization header' }, 401);

  let userGuilds: any[];
  try {
    userGuilds = await getUserGuildsCached(token);
  } catch (err) {
    // Only a real 401/403 from Discord means the session is actually invalid.
    // Anything else (429 rate limit, 5xx, network blip) should NOT log the
    // user out — surface it as a retryable error instead.
    if (err instanceof DiscordApiError && (err.status === 401 || err.status === 403)) {
      throw json({ error: 'Invalid or expired Discord session' }, 401);
    }
    throw json({ error: 'Discord API is temporarily unavailable — please try again in a few seconds.' }, 503);
  }

  const membership = userGuilds.find(g => g.id === guildId);
  if (!membership) throw json({ error: 'Not a member of that server' }, 403);

  const perms = BigInt(membership.permissions ?? '0');
  const isAdmin = (perms & BigInt(ADMINISTRATOR)) !== 0n || (perms & BigInt(MANAGE_GUILD)) !== 0n;
  if (!isAdmin) throw json({ error: 'You need Manage Server (or Administrator) to edit settings here' }, 403);

  try {
    await discordFetch(`/guilds/${guildId}`, BOT_TOKEN, true);
  } catch {
    throw json({ error: 'The bot is not in that server' }, 403);
  }

  return token;
}

// ---- Route handlers ----

async function handleOauth(req: Request) {
  const { code, redirect_uri } = await req.json();
  if (!code || !redirect_uri) return json({ error: 'code and redirect_uri are required' }, 400);

  const tokenData = await exchangeCode(code, redirect_uri);
  const user = await discordFetch('/users/@me', tokenData.access_token);

  return json({
    access_token: tokenData.access_token,
    expires_in: tokenData.expires_in,
    user: { id: user.id, username: user.username, avatar: user.avatar }
  });
}

async function handleGuilds(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Missing Authorization header' }, 401);

  let userGuilds: any[], botGuilds: any[];
  try {
    [userGuilds, botGuilds] = await Promise.all([
      getUserGuildsCached(token),
      discordFetch('/users/@me/guilds?limit=200', BOT_TOKEN, true)
    ]);
  } catch (err) {
    if (err instanceof DiscordApiError && (err.status === 401 || err.status === 403)) {
      return json({ error: 'Invalid or expired Discord session' }, 401);
    }
    return json({ error: 'Discord API is temporarily unavailable — please try again in a few seconds.' }, 503);
  }

  const botGuildIds = new Set(botGuilds.map((g: any) => g.id));
  const manageable = userGuilds
    .filter((g: any) => {
      const perms = BigInt(g.permissions ?? '0');
      const isAdmin = (perms & BigInt(ADMINISTRATOR)) !== 0n || (perms & BigInt(MANAGE_GUILD)) !== 0n;
      return isAdmin && botGuildIds.has(g.id);
    })
    .map((g: any) => ({ id: g.id, name: g.name, icon: g.icon }));

  return json({ guilds: manageable });
}

async function handleRoles(req: Request, guildId: string) {
  await requireGuildAdmin(req, guildId);
  const roles = await discordFetch(`/guilds/${guildId}/roles`, BOT_TOKEN, true);
  const filtered = roles
    .filter((r: any) => r.name !== '@everyone')
    .sort((a: any, b: any) => b.position - a.position)
    .map((r: any) => ({ id: r.id, name: r.name, color: r.color }));
  return json({ roles: filtered, everyone_role_id: guildId });
}

async function handleGetSettings(req: Request, guildId: string) {
  await requireGuildAdmin(req, guildId);

  const [settings, managerRoles, cmdPerms, rewards, multipliers] = await Promise.all([
    supabase.from('guild_settings').select('*').eq('guild_id', guildId).maybeSingle(),
    supabase.from('manager_roles').select('role_id').eq('guild_id', guildId),
    supabase.from('command_permissions').select('command_name, role_id').eq('guild_id', guildId),
    supabase.from('role_point_rewards').select('role_id, points_threshold').eq('guild_id', guildId),
    supabase.from('role_multipliers').select('role_id, multiplier').eq('guild_id', guildId)
  ]);

  for (const r of [settings, managerRoles, cmdPerms, rewards, multipliers]) {
    if (r.error) throw r.error;
  }

  return json({
    commands: COMMANDS,
    guild_settings: settings.data || { points_per_tick: 1, tick_minutes: 30, short_session_points: 1 },
    manager_roles: (managerRoles.data || []).map(r => r.role_id),
    command_permissions: cmdPerms.data || [],
    role_point_rewards: rewards.data || [],
    role_multipliers: multipliers.data || []
  });
}

async function handlePutSettings(req: Request, guildId: string) {
  await requireGuildAdmin(req, guildId);
  const body = await req.json();

  if (body.guild_settings) {
    const { points_per_tick, tick_minutes, short_session_points } = body.guild_settings;
    const { error } = await supabase.from('guild_settings').upsert({
      guild_id: guildId,
      points_per_tick: Number(points_per_tick) || 1,
      tick_minutes: Number(tick_minutes) || 30,
      short_session_points: Number(short_session_points) || 1
    });
    if (error) throw error;
  }

  if (Array.isArray(body.manager_roles)) {
    await supabase.from('manager_roles').delete().eq('guild_id', guildId);
    if (body.manager_roles.length) {
      const rows = body.manager_roles.map((role_id: string) => ({ guild_id: guildId, role_id }));
      const { error } = await supabase.from('manager_roles').insert(rows);
      if (error) throw error;
    }
  }

  if (Array.isArray(body.command_permissions)) {
    await supabase.from('command_permissions').delete().eq('guild_id', guildId);
    if (body.command_permissions.length) {
      const rows = body.command_permissions.map((p: any) => ({
        guild_id: guildId,
        command_name: p.command_name,
        role_id: p.role_id
      }));
      const { error } = await supabase.from('command_permissions').insert(rows);
      if (error) throw error;
    }
  }

  if (Array.isArray(body.role_point_rewards)) {
    await supabase.from('role_point_rewards').delete().eq('guild_id', guildId);
    if (body.role_point_rewards.length) {
      const rows = body.role_point_rewards.map((r: any) => ({
        guild_id: guildId,
        role_id: r.role_id,
        points_threshold: Number(r.points_threshold) || 0
      }));
      const { error } = await supabase.from('role_point_rewards').insert(rows);
      if (error) throw error;
    }
  }

  if (Array.isArray(body.role_multipliers)) {
    await supabase.from('role_multipliers').delete().eq('guild_id', guildId);
    if (body.role_multipliers.length) {
      const rows = body.role_multipliers.map((r: any) => ({
        guild_id: guildId,
        role_id: r.role_id,
        multiplier: Number(r.multiplier) || 1
      }));
      const { error } = await supabase.from('role_multipliers').insert(rows);
      if (error) throw error;
    }
  }

  return json({ ok: true });
}

async function handleGetPoints(req: Request, guildId: string) {
  await requireGuildAdmin(req, guildId);

  const { data, error } = await supabase
    .from('user_points')
    .select('user_id, points')
    .order('points', { ascending: false })
    .limit(500);
  if (error) throw error;

  const withNames = await Promise.all(
    (data || []).map(async row => {
      try {
        const user = await discordFetch(`/users/${row.user_id}`, BOT_TOKEN, true);
        return { ...row, username: user.username, avatar: user.avatar };
      } catch {
        return { ...row, username: null, avatar: null };
      }
    })
  );

  return json({ users: withNames });
}

async function handlePatchPoints(req: Request, guildId: string) {
  await requireGuildAdmin(req, guildId);
  const { user_id, points } = await req.json();
  if (!user_id || typeof points !== 'number') {
    return json({ error: 'user_id and numeric points are required' }, 400);
  }

  const { error } = await supabase
    .from('user_points')
    .upsert({ user_id, points, updated_at: new Date().toISOString() });
  if (error) throw error;

  return json({ ok: true });
}

// ---- Router ----

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const url = new URL(req.url);
  // Path looks like /dashboard/oauth or /dashboard/guilds/123/settings
  const parts = url.pathname.split('/').filter(Boolean);
  const afterFnName = parts[0] === 'dashboard' ? parts.slice(1) : parts;

  try {
    if (req.method === 'POST' && afterFnName[0] === 'oauth') {
      return await handleOauth(req);
    }
    if (req.method === 'GET' && afterFnName[0] === 'guilds' && afterFnName.length === 1) {
      return await handleGuilds(req);
    }
    if (afterFnName[0] === 'guilds' && afterFnName.length >= 2) {
      const guildId = afterFnName[1];
      const sub = afterFnName[2];

      if (req.method === 'GET' && sub === 'roles') return await handleRoles(req, guildId);
      if (req.method === 'GET' && sub === 'settings') return await handleGetSettings(req, guildId);
      if (req.method === 'PUT' && sub === 'settings') return await handlePutSettings(req, guildId);
      if (req.method === 'GET' && sub === 'points') return await handleGetPoints(req, guildId);
      if (req.method === 'PATCH' && sub === 'points') return await handlePatchPoints(req, guildId);
    }

    return json({ error: 'Not found' }, 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error(err);
    return json({ error: 'Internal error' }, 500);
  }
});
