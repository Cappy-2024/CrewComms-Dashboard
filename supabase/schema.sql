-- ============================================================================
-- Discord Bot Dashboard — schema
-- Run this in Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to re-run in full — everything here is idempotent.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. guild_settings — one row per Discord server: how many points a member
--    earns per tick, and how long a tick is (in minutes).
-- ----------------------------------------------------------------------------
create table if not exists public.guild_settings (
  guild_id        text primary key,
  points_per_tick integer not null default 10,
  tick_minutes    integer not null default 30,
  updated_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. guild_manager_roles — roles that bypass every per-command restriction
--    and can always run every command, regardless of what's set below.
-- ----------------------------------------------------------------------------
create table if not exists public.guild_manager_roles (
  guild_id   text not null,
  role_id    text not null,
  role_name  text not null,
  primary key (guild_id, role_id)
);

-- ----------------------------------------------------------------------------
-- 3. Per-command permissions.
--    guild_command_settings.everyone = true means "@everyone can use this
--    command" — the simplest, and the default, state for every command.
--    Setting everyone = false restricts it to whatever roles are listed in
--    guild_command_roles for that (guild, command) pair.
-- ----------------------------------------------------------------------------
create table if not exists public.guild_command_settings (
  guild_id      text not null,
  command_name  text not null,
  everyone      boolean not null default true,
  primary key (guild_id, command_name)
);

create table if not exists public.guild_command_roles (
  guild_id      text not null,
  command_name  text not null,
  role_id       text not null,
  role_name     text not null,
  primary key (guild_id, command_name, role_id)
);

-- ----------------------------------------------------------------------------
-- 4. guild_point_roles — a leveling ladder: which role gets granted once a
--    member crosses a points threshold.
-- ----------------------------------------------------------------------------
create table if not exists public.guild_point_roles (
  guild_id   text not null,
  role_id    text not null,
  role_name  text not null,
  threshold  integer not null,
  primary key (guild_id, role_id)
);

-- ----------------------------------------------------------------------------
-- 5. guild_multipliers — roles that multiply the points a member earns
--    (e.g. a Booster role earning 1.5x).
-- ----------------------------------------------------------------------------
create table if not exists public.guild_multipliers (
  guild_id    text not null,
  role_id     text not null,
  role_name   text not null,
  multiplier  numeric not null default 1,
  primary key (guild_id, role_id)
);

-- ----------------------------------------------------------------------------
-- 6. guild_user_points — a member's point balance within one server. This
--    is what the User Data Manager page reads and edits, and what the bot
--    itself should read from (and write to, on each tick) to know a
--    member's current balance.
-- ----------------------------------------------------------------------------
create table if not exists public.guild_user_points (
  guild_id    text not null,
  user_id     text not null,
  username    text,
  points      integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (guild_id, user_id)
);

-- ----------------------------------------------------------------------------
-- 7. Row Level Security — enabled with NO policies for anyone, on purpose.
--
--    Every table above only makes sense to read or write after confirming,
--    right now, that the caller has "Manage Server" in that specific Discord
--    guild. That's a live fact that lives in Discord, not something Postgres
--    can check on its own the way the tester tracker's static admin
--    allow-list could — a person's roles and permissions in a server can
--    change at any moment without this database knowing.
--
--    So instead of RLS policies, ALL reads and writes to these tables go
--    through the bot-dashboard / bot-dashboard-users Edge Functions, which
--    use the service role key (bypassing RLS) and re-verify the caller's
--    live Discord permissions on every single request. Enabling RLS with
--    zero policies here means the anon/authenticated client can never
--    touch these tables directly, even by accident — the Edge Functions
--    are the only door in.
-- ----------------------------------------------------------------------------
alter table public.guild_settings enable row level security;
alter table public.guild_manager_roles enable row level security;
alter table public.guild_command_settings enable row level security;
alter table public.guild_command_roles enable row level security;
alter table public.guild_point_roles enable row level security;
alter table public.guild_multipliers enable row level security;
alter table public.guild_user_points enable row level security;
