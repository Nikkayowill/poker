/**
 * Public Cloudflare Turnstile site key for the sign-in/sign-up form's bot
 * check. See .env.example for the full setup -- the secret half never lives
 * in this app; it's entered directly into the Supabase Auth dashboard.
 *
 * Empty until configured, which is what turns the widget off: the form works
 * unmodified with no key set.
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || undefined;
