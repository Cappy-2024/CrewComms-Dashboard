# Among Tracker Dashboard

A static (GitHub Pages) frontend + Supabase Edge Function backend for managing
the Among Tracker bot's per-server settings and user points.

## 1. Deploy the Edge Function

The function lives in `functions/dashboard/index.ts`. Deploy it with the
[Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
npm install -g supabase
supabase login
supabase link --project-ref zhbabjcrjnsjflqcdxhh
supabase functions deploy dashboard --project-ref zhbabjcrjnsjflqcdxhh --no-verify-jwt
```

`--no-verify-jwt` is required — this function authenticates callers with
Discord tokens itself, not Supabase auth.

### Set the function's secrets

```bash
supabase secrets set \
  DISCORD_CLIENT_ID=1380989772113121343 \
  DISCORD_CLIENT_SECRET=your-client-secret-here \
  DISCORD_BOT_TOKEN=your-bot-token-here \
  DASHBOARD_ORIGIN=https://yourusername.github.io \
  --project-ref zhbabjcrjnsjflqcdxhh
```

- `DISCORD_CLIENT_SECRET`: Developer Portal → your app → OAuth2 → "Reset Secret" if you don't already have it saved.
- `DISCORD_BOT_TOKEN`: the **new** token you generated after the earlier leak — same one that's in the bot's `.env`.
- `DASHBOARD_ORIGIN`: your GitHub Pages origin (no trailing slash, no path). This restricts which site is allowed to call the API. Use `*` temporarily if you want to test locally first, then tighten it.

## 2. Register the redirect URI in Discord

Developer Portal → your app → OAuth2 → Redirects → add:

```
https://yourusername.github.io/among-tracker-dashboard/callback.html
```

(adjust the path to wherever you actually publish `callback.html`)

## 3. Configure the frontend

Edit `config.js`:

```js
const CONFIG = {
  DISCORD_CLIENT_ID: '1380989772113121343',
  API_BASE: 'https://zhbabjcrjnsjflqcdxhh.supabase.co/functions/v1/dashboard',
  REDIRECT_URI: window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'callback.html'
};
```

The `REDIRECT_URI` auto-detects itself based on wherever the page is hosted, so
you usually only need to double check it matches exactly what you registered
in step 2 (open the browser console on `callback.html` if unsure).

## 4. Publish to GitHub Pages

Push this folder to a repo, then in the repo's Settings → Pages, set the
source to that branch/folder. Everything here is plain HTML/CSS/JS — no build
step needed.

## What's included

| File | Purpose |
|---|---|
| `index.html` | Landing page / "Sign in with Discord" |
| `callback.html` | OAuth redirect target — exchanges the code for a session |
| `guilds.html` | Lists servers you can manage |
| `dashboard.html` + `app.js` | The settings editor (points, permissions, rewards, multipliers, user data) |
| `functions/dashboard/index.ts` | The Supabase Edge Function backend |

## Important: the bot doesn't read these settings yet

This dashboard writes to new Supabase tables (`guild_settings`,
`manager_roles`, `command_permissions`, `role_point_rewards`,
`role_multipliers`), but the bot's command code still uses the hardcoded
values in `config.js` from the bot repo. Let me know when you're ready and
I'll wire the bot up to read from these tables so the settings actually take
effect.
