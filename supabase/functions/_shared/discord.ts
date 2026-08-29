// Shared by every Edge Function in this project. Supabase deploys each
// function's folder independently, but bundles anything imported from a
// sibling `_shared` folder in alongside it — so this isn't deployed on its
// own, it just avoids copy-pasting the same boilerplate into every function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
export const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN")!;
export const APPLICATION_ID = Deno.env.get("DISCORD_APPLICATION_ID")!;

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

// Identifies the caller from their Supabase session — same pattern as the
// tester tracker's Edge Functions. Returns null if not signed in.
export async function getCallerUserId(authHeader: string): Promise<string | null> {
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await callerClient.auth.getUser();
  return user?.id ?? null;
}

const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;

export function hasManageGuild(permissionsStr: string): boolean {
  try {
    const perms = BigInt(permissionsStr);
    return (perms & MANAGE_GUILD) === MANAGE_GUILD || (perms & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

// Re-checks, live, whether the signed-in user currently has Manage Server
// in the given guild. Requires the Discord access token from their
// Supabase session (session.provider_token on the client) — Supabase
// doesn't persist that token server-side, so the client has to send it
// with every request that needs this check. See the README for why.
export async function verifyGuildAccess(discordAccessToken: string, guildId: string): Promise<boolean> {
  if (!discordAccessToken) return false;
  const res = await fetch("https://discord.com/api/v10/users/@me/guilds?limit=200", {
    headers: { Authorization: `Bearer ${discordAccessToken}` },
  });
  if (!res.ok) return false;
  const guilds = await res.json();
  const guild = (guilds as any[]).find((g) => g.id === guildId);
  return !!guild && hasManageGuild(guild.permissions);
}

// Calls the Discord API as the bot (for role/command/member lookups —
// anything that doesn't depend on a specific user's own OAuth token).
export async function discordBotFetch(path: string, init: RequestInit = {}) {
  return fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}
