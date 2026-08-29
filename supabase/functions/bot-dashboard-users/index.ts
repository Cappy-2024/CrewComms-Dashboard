// bot-dashboard-users
//
// Backs the User Data Manager page: searching guild members (via Discord's
// own member search, so there's no need to mirror the whole member list
// into this database) and reading/writing their point balance.
//
// Deploy: supabase functions deploy bot-dashboard-users
// Needs the same secrets as bot-dashboard. Also needs the "Server Members
// Intent" enabled for the bot (Discord Developer Portal → Bot → Privileged
// Gateway Intents) — member search doesn't work without it.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import {
  json,
  CORS_HEADERS,
  adminClient,
  getCallerUserId,
  verifyGuildAccess,
  discordBotFetch,
} from "../_shared/discord.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const callerId = await getCallerUserId(authHeader);
    if (!callerId) return json({ error: "You need to be signed in." }, 401);

    const admin = adminClient();
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const guildId = body.guildId;
    if (!guildId) return json({ error: "Missing guildId." }, 400);

    const hasAccess = await verifyGuildAccess(body.discordAccessToken, guildId);
    if (!hasAccess) return json({ error: "You don't have Manage Server in that guild (or your session expired — try signing in again)." }, 403);

    // -------------------------------------------------------- search-members
    if (action === "search-members") {
      const query = String(body.query || "").trim();
      if (!query) return json({ members: [] });

      const res = await discordBotFetch(
        `/guilds/${guildId}/members/search?query=${encodeURIComponent(query)}&limit=10`
      );
      if (!res.ok) {
        if (res.status === 403) {
          return json({ error: "The bot can't search members here — check it has the Server Members Intent enabled." }, 502);
        }
        return json({ error: "Couldn't search Discord members right now." }, 502);
      }

      const members = await res.json();
      const userIds = (members as any[]).map((m) => m.user.id);

      const { data: pointRows } = userIds.length
        ? await admin.from("guild_user_points").select("user_id, points").eq("guild_id", guildId).in("user_id", userIds)
        : { data: [] };
      const pointsByUser: Record<string, number> = {};
      for (const row of pointRows || []) pointsByUser[row.user_id] = row.points;

      return json({
        members: (members as any[]).map((m) => ({
          id: m.user.id,
          username: m.user.global_name || m.user.username,
          avatar: m.user.avatar
            ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.png?size=32`
            : null,
          points: pointsByUser[m.user.id] ?? 0,
        })),
      });
    }

    // -------------------------------------------------------- set-points
    if (action === "set-points") {
      const userId = String(body.userId || "");
      const username = String(body.username || "");
      const mode = body.mode === "add" ? "add" : "set";
      const amount = Number(body.amount);
      if (!userId) return json({ error: "Missing userId." }, 400);
      if (!Number.isFinite(amount)) return json({ error: "Amount must be a number." }, 400);

      let newPoints = amount;
      if (mode === "add") {
        const { data: existing } = await admin
          .from("guild_user_points")
          .select("points")
          .eq("guild_id", guildId)
          .eq("user_id", userId)
          .maybeSingle();
        newPoints = (existing?.points ?? 0) + amount;
      }
      newPoints = Math.max(0, Math.round(newPoints));

      const { error } = await admin.from("guild_user_points").upsert({
        guild_id: guildId,
        user_id: userId,
        username,
        points: newPoints,
        updated_at: new Date().toISOString(),
      });
      if (error) return json({ error: error.message }, 500);

      return json({ success: true, points: newPoints });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error("bot-dashboard-users error:", err);
    return json({ error: "Unexpected server error." }, 500);
  }
});
