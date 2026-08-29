# Bot Dashboard

A website for editing a Discord bot's per-server settings: who can run which
commands, which role gets awarded at which point thresholds, how many points
are earned per tick (and how long a tick is), role-based point multipliers,
and a page for directly viewing/editing a member's point balance.

**Scope note, up front:** this is the *website* only. It reads and writes
settings to Supabase; it doesn't run the bot itself (the process that
actually grants roles, answers commands, and ticks out points on a
schedule). See "How your bot should use this data" below for exactly what
each table means and how a bot process should read it.

```
docs/       → the static site
supabase/   → schema + the two Edge Functions this needs
```

## How this is different from a typical admin dashboard

Discord server permissions are **live and dynamic** — who can manage a
server can change at any moment (a role gets removed, someone gets kicked,
etc.), and that fact lives entirely in Discord, not in this database. So
unlike a dashboard with a static admin allow-list, access here can't be
checked with a simple database policy — every read and write to a guild's
settings has to re-verify, live, against Discord's API that the caller
currently has **Manage Server** in that specific guild.

That's why every settings table has Row Level Security enabled with **zero
policies** (see `schema.sql`) — the website's own Supabase client can never
touch them directly. All access goes through two Edge Functions
(`bot-dashboard` and `bot-dashboard-users`), which use the service role key
and re-check Discord permissions on every single request, not just once at
login.

## Site structure

```
docs/
  index.html         → https://<user>.github.io/<repo>/            (sign in, pick a server)
  settings/index.html → .../settings/?guild=<id>&name=<name>        (tabbed settings)
  users/index.html    → .../users/?guild=<id>&name=<name>           (user data manager)
  shared/               common.js, style.css, config.js
```

Settings is one page with four tabs — Permissions, Point Roles, Points &
Tick, Multipliers — same "one category, one place" pattern as the tester
tracker dashboard this reused a lot of its design language from.

## 1. Create the Discord application & bot

1. [Discord Developer Portal](https://discord.com/developers/applications) →
   **New Application**.
2. **OAuth2** page: copy the **Client ID** and **Client Secret** — you'll
   need these for Supabase in step 3. Under Redirects, add:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
3. **Bot** page: **Reset Token** → copy it (this is `DISCORD_BOT_TOKEN`,
   needed in step 5 — treat it like a password, never commit it anywhere).
   Also note the **Application ID** from the General Information page
   (this is `DISCORD_APPLICATION_ID`).
4. Still on the Bot page, turn on **Server Members Intent** under
   Privileged Gateway Intents — the User Data Manager's member search
   won't work without it.
5. Invite the bot to a server you manage to test with: **OAuth2 → URL
   Generator** → scopes: `bot`, `applications.commands` → permissions: at
   minimum enough for your bot to function (e.g. `Manage Roles` if it'll be
   granting point roles — and if so, its own role needs to sit *above*
   any role it's expected to grant, in that server's role list) → open the
   generated URL and add it to a server.

## 2. Create the Supabase project

1. [supabase.com](https://supabase.com) → New project.
2. **SQL Editor** → paste in the full contents of `supabase/schema.sql` →
   Run.
3. **Authentication → Providers → Discord** → paste in the Client ID/Secret
   from step 1 → Save.
4. **Authentication → URL Configuration → Redirect URLs** → add a wildcard
   covering the whole site:
   ```
   https://<user>.github.io/<repo>/**
   ```

## 3. Configure the website

`docs/shared/config.js`:
```js
window.BOT_DASHBOARD_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",
};
```

## 4. Deploy the Edge Functions

```
supabase init        # only if you haven't already, from the project root
supabase link --project-ref <your-project-ref>
supabase functions deploy bot-dashboard
supabase functions deploy bot-dashboard-users
```

Set the secrets both functions need:
```
supabase secrets set DISCORD_BOT_TOKEN=your-bot-token
supabase secrets set DISCORD_APPLICATION_ID=your-application-id
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are
usually auto-provided already — only set them manually if a function
errors on startup.)

## 5. Host it on GitHub Pages

Push the whole project with `docs/` as a top-level folder, then **Settings
→ Pages → Source: Deploy from a branch → Branch: main, folder: /docs**.

## A quirk worth knowing about: the Discord access token

Every privileged action needs your Discord OAuth access token (that's how
the Edge Functions re-verify your live permissions). Supabase only hands
this to the *browser* right after you sign in (`session.provider_token`)
— it does **not** persist it across a background session refresh. In
practice this means: if you leave a tab open for a long time and Supabase
silently refreshes your session in the background, that token can go
missing, and actions will fail with "your session expired." The fix is
always the same: sign out and sign back in. This isn't a bug to chase down
— it's just how Supabase's OAuth token handling works, and the error
message is written to point at the fix directly.

## How your bot should use this data

The dashboard writes to these tables; your bot process should read from
them (a cache with a short TTL is reasonable — these change rarely) to
decide what to actually do:

- **`guild_settings`** — `points_per_tick` and `tick_minutes`. Your tick
  loop should award `points_per_tick` (multiplied by whatever
  `guild_multipliers` apply — see below) to active members every
  `tick_minutes`, however your bot defines "active."

- **`guild_manager_roles`** — a member with any of these roles can run
  *any* command, bypassing whatever `guild_command_settings` says.
  **Also let anyone with the Discord `ADMINISTRATOR` permission bypass
  command restrictions the same way**, even if they don't hold a manager
  role — that's a permission Discord itself treats as "can do anything,"
  and commands should respect that by default too.

- **`guild_command_settings`** / **`guild_command_roles`** — for a given
  command, `everyone = true` means anyone can run it (the default, and
  the state for any command that hasn't been touched in the dashboard).
  `everyone = false` means only members holding one of the roles listed in
  `guild_command_roles` for that `(guild_id, command_name)` pair can run
  it — unless they qualify for the manager-role/Administrator bypass
  above.

- **`guild_point_roles`** — `role_id` should be granted once a member's
  balance in `guild_user_points` crosses `threshold`. If you support
  multiple thresholds, typically only the *highest* one they qualify for
  should be actively held (removing lower ones) — but that's a product
  decision the dashboard doesn't make for you; it just stores the ladder.

- **`guild_multipliers`** — when awarding points, multiply the base amount
  by the multiplier for any role a member holds that appears here (if they
  hold more than one, decide whether multipliers stack additively,
  multiplicatively, or only the highest applies — again, the dashboard
  just stores the values).

- **`guild_user_points`** — the source of truth for a member's balance.
  The dashboard reads and writes this directly; your bot should too
  (rather than keeping a separate balance anywhere) so the numbers always
  agree no matter which side changed them last.

## In the future (not built yet)

You mentioned wanting a `!rank`-style command later (showing a member their
own point count and an XP-bar-style view of progress toward their next
point role) and possibly an activity/staff-session overview — both make
sense as later additions and aren't built here. The `!rank` command is bot
code, not a website feature, so it'd live in your bot's command handler,
reading straight from `guild_user_points` and `guild_point_roles`. An
activity view would most likely need its own new table(s) for whatever
"activity" and "staff session" mean concretely in your bot — worth defining
that shape when you're ready to build it.
