// Fill these in before deploying to GitHub Pages.
const CONFIG = {
  DISCORD_CLIENT_ID: '1380989772113121343',
  // The Edge Function base URL, e.g. https://zhbabjcrjnsjflqcdxhh.supabase.co/functions/v1/dashboard
  API_BASE: 'https://zhbabjcrjnsjflqcdxhh.supabase.co/functions/v1/dashboard',
  // Must exactly match a redirect URI registered in the Discord Developer Portal
  // (Developer Portal > your app > OAuth2 > Redirects), e.g.
  // https://yourusername.github.io/among-tracker-dashboard/callback.html
  REDIRECT_URI: window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'callback.html'
};
