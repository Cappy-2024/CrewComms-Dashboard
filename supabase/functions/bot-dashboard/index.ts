// bot-dashboard
//
// One action-dispatched function handling everything on the guild picker
// and Settings pages. Every action (including reads) re-verifies, live,
// that the caller has Manage Server in the target guild — see schema.sql
// for why that can't just be a Postgres RLS policy here.
//
// Deploy: supabase functions deploy bot-dashboard
// Secrets needed (supabase secrets set NAME=value):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (usually auto-provided)
//   DISCORD_BOT_TOKEN        — from the Discord Developer Portal (Bot → Token)
//   DISCORD_APPLICATION_ID   — same page, "Application ID"

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import {
  json,
  CORS_HEADERS,
  adminClient,
  getCallerUserId,
  hasManageGuild,
  verifyGuildAccess,
  discordBotFetch,
  APPLICATION_ID,
} from "../_shared/discord.ts";

// Roles that don't make sense to offer in a picker: @everyone (its id is
// always the guild id) and roles Discord itself manages (bot integration
// roles, server boosting tiers created by Discord, etc).
function selectableRoles(guildId: string, roles: any[]) {
  return roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, color: r.color }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const callerId = await getCallerUserId(authHeader);
    if (!callerId) return json({ error: "You need to be signed in." }, 401);

    const admin = adminClient();
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    // -------------------------------------------------------- list-guilds
    if (action === "list-guilds") {
      const discordAccessToken = body.discordAccessToken;
      if (!discordAccessToken) {
        return json({ error: "Missing Discord access token — try signing in again." }, 400);
      }

      const [userGuildsRes, botGuildsRes] = await Promise.all([
        fetch("https://discord.com/api/v10/users/@me/guilds?limit=200", {
          headers: { Authorization: `Bearer ${discordAccessToken}` },
        }),
        discordBotFetch("/users/@me/guilds?limit=200"),
      ]);

      if (!userGuildsRes.ok) {
        return json({ error: "Couldn't read your Discord servers. Try signing out and back in." }, 502);
      }
      if (!botGuildsRes.ok) {
        return json({ error: "Couldn't reach the bot's Discord account. Check the bot token secret." }, 502);
      }

      const userGuilds = await userGuildsRes.json();
      const botGuilds = await botGuildsRes.json();
      const botGuildIds = new Set((botGuilds as any[]).map((g) => g.id));

      const manageable = (userGuilds as any[])
        .filter((g) => botGuildIds.has(g.id) && hasManageGuild(g.permissions))
        .map((g) => ({
          id: g.id,
          name: g.name,
          icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
        }));

      return json({ guilds: manageable });
    }

    // Every action below operates on one guild, so re-verify access once
    // here rather than repeating this in each branch.
    const guildId = body.guildId;
    if (!guildId) return json({ error: "Missing guildId." }, 400);

    const hasAccess = await verifyGuildAccess(body.discordAccessToken, guildId);
    if (!hasAccess) return json({ error: "You don't have Manage Server in that guild (or your session expired — try signing in again)." }, 403);

    // -------------------------------------------------------- get-guild-data
    if (action === "get-guild-data") {
      const [rolesRes, globalCmdRes, guildCmdRes, settingsRow, managerRoles, pointRoles, multipliers, cmdSettings, cmdRoles] =
        await Promise.all([
          discordBotFetch(`/guilds/${guildId}/roles`),
          discordBotFetch(`/applications/${APPLICATION_ID}/commands`),
          discordBotFetch(`/applications/${APPLICATION_ID}/guilds/${guildId}/commands`),
          admin.from("guild_settings").select("*").eq("guild_id", guildId).maybeSingle(),
          admin.from("guild_manager_roles").select("*").eq("guild_id", guildId),
          admin.from("guild_point_roles").select("*").eq("guild_id", guildId).order("threshold"),
          admin.from("guild_multipliers").select("*").eq("guild_id", guildId),
          admin.from("guild_command_settings").select("*").eq("guild_id", guildId),
          admin.from("guild_command_roles").select("*").eq("guild_id", guildId),
        ]);

      if (!rolesRes.ok) return json({ error: "Couldn't load this server's roles from Discord." }, 502);

      const roles = selectableRoles(guildId, await rolesRes.json());

      const globalCmds = globalCmdRes.ok ? await globalCmdRes.json() : [];
      const guildCmds = guildCmdRes.ok ? await guildCmdRes.json() : [];
      const commandNames = [...new Set([...globalCmds, ...guildCmds].map((c: any) => c.name))].sort();

      const commandRolesByName: Record<string, any[]> = {};
      for (const row of cmdRoles.data || []) {
        (commandRolesByName[row.command_name] ??= []).push({ id: row.role_id, name: row.role_name });
      }
      const commandSettingsByName: Record<string, boolean> = {};
      for (const row of cmdSettings.data || []) commandSettingsByName[row.command_name] = row.everyone;

      return json({
        roles,
        commands: commandNames.map((name) => ({
          name,
          everyone: commandSettingsByName[name] ?? true,
          roles: commandRolesByName[name] || [],
        })),
        settings: settingsRow.data || { points_per_tick: 10, tick_minutes: 30 },
        managerRoles: (managerRoles.data || []).map((r) => ({ id: r.role_id, name: r.role_name })),
        pointRoles: (pointRoles.data || []).map((r) => ({ id: r.role_id, name: r.role_name, threshold: r.threshold })),
        multipliers: (multipliers.data || []).map((r) => ({ id: r.role_id, name: r.role_name, multiplier: r.multiplier })),
      });
    }

    // -------------------------------------------------------- save-settings
    if (action === "save-settings") {
      const pointsPerTick = Number(body.pointsPerTick);
      const tickMinutes = Number(body.tickMinutes);
      if (!Number.isFinite(pointsPerTick) || pointsPerTick < 0) return json({ error: "Points per tick must be 0 or more." }, 400);
      if (!Number.isFinite(tickMinutes) || tickMinutes <= 0) return json({ error: "Tick minutes must be a positive number." }, 400);

      const { error } = await admin.from("guild_settings").upsert({
        guild_id: guildId,
        points_per_tick: pointsPerTick,
        tick_minutes: tickMinutes,
        updated_at: new Date().toISOString(),
      });
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    // -------------------------------------------------------- save-manager-roles
    if (action === "save-manager-roles") {
      const roles = Array.isArray(body.roles) ? body.roles : [];
      await admin.from("guild_manager_roles").delete().eq("guild_id", guildId);
      if (roles.length) {
        const { error } = await admin
          .from("guild_manager_roles")
          .insert(roles.map((r: any) => ({ guild_id: guildId, role_id: r.id, role_name: r.name })));
        if (error) return json({ error: error.message }, 500);
      }
      return json({ success: true });
    }

    // -------------------------------------------------------- save-point-roles
    if (action === "save-point-roles") {
      const roles = Array.isArray(body.roles) ? body.roles : [];
      for (const r of roles) {
        if (!Number.isFinite(Number(r.threshold)) || Number(r.threshold) < 0) {
          return json({ error: `Invalid threshold for ${r.name || r.id}.` }, 400);
        }
      }
      await admin.from("guild_point_roles").delete().eq("guild_id", guildId);
      if (roles.length) {
        const { error } = await admin.from("guild_point_roles").insert(
          roles.map((r: any) => ({ guild_id: guildId, role_id: r.id, role_name: r.name, threshold: Number(r.threshold) }))
        );
        if (error) return json({ error: error.message }, 500);
      }
      return json({ success: true });
    }

    // -------------------------------------------------------- save-multipliers
    if (action === "save-multipliers") {
      const roles = Array.isArray(body.roles) ? body.roles : [];
      for (const r of roles) {
        if (!Number.isFinite(Number(r.multiplier)) || Number(r.multiplier) < 0) {
          return json({ error: `Invalid multiplier for ${r.name || r.id}.` }, 400);
        }
      }
      await admin.from("guild_multipliers").delete().eq("guild_id", guildId);
      if (roles.length) {
        const { error } = await admin.from("guild_multipliers").insert(
          roles.map((r: any) => ({ guild_id: guildId, role_id: r.id, role_name: r.name, multiplier: Number(r.multiplier) }))
        );
        if (error) return json({ error: error.message }, 500);
      }
      return json({ success: true });
    }

    // -------------------------------------------------------- save-command-permissions
    if (action === "save-command-permissions") {
      const commandName = String(body.commandName || "").trim();
      const everyone = !!body.everyone;
      const roles = Array.isArray(body.roles) ? body.roles : [];
      if (!commandName) return json({ error: "Missing commandName." }, 400);

      const { error: settingsErr } = await admin
        .from("guild_command_settings")
        .upsert({ guild_id: guildId, command_name: commandName, everyone });
      if (settingsErr) return json({ error: settingsErr.message }, 500);

      await admin.from("guild_command_roles").delete().eq("guild_id", guildId).eq("command_name", commandName);
      if (!everyone && roles.length) {
        const { error } = await admin.from("guild_command_roles").insert(
          roles.map((r: any) => ({ guild_id: guildId, command_name: commandName, role_id: r.id, role_name: r.name }))
        );
        if (error) return json({ error: error.message }, 500);
      }
      return json({ success: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error("bot-dashboard error:", err);
    return json({ error: "Unexpected server error." }, 500);
  }
});
