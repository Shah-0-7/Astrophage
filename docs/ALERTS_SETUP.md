# Email alerts: setup

Email alerts need three things the plain app does not: a place to keep accounts (Cloudflare D1), a scheduled job (a Cron Trigger)
and a way to send mail (Resend). Until they are configured, the sign-in controls are hidden and nothing else changes.

How it fits together:

- **Sign in with Google** (OpenID Connect, authorization-code flow with PKCE, state and nonce). The ID token is verified against Google's keys.
  The session is a signed, HTTP-only cookie. Only `openid email profile` is requested and no Google tokens are stored.
- **Rules** are saved to D1 when you are signed in (and still kept in the browser). Rules already in the browser are merged in on first sign-in.
- **Cron Trigger** (every 10 minutes) calls `/api/cron/alerts`. The job fetches USGS, EONET and GDACS directly, applies each subscriber's rules,
  skips events already emailed, and sends one batched email per person. Storms are alerted once per storm, not once per position update.
- **Unsubscribe**: every email carries a one-click `List-Unsubscribe` header and a footer link. Users can also delete their account from the panel.

## 1. Cloudflare resources

```bash
npx wrangler login
npx wrangler d1 create astrophage        # prints a database_id
```

Paste the id into `wrangler.jsonc` (`d1_databases[0].database_id`), then create the tables:

```bash
npm run cf:migrate                       # remote
npm run cf:migrate:local                 # local preview
```

## 2. Google OAuth client

1. Google Cloud Console, APIs & Services, **OAuth consent screen**: External, add your app name, support email, and the
   privacy policy URL `https://<your-site>/privacy`. Scopes: `openid`, `email`, `profile` (all non-sensitive).
2. **Credentials**, Create credentials, **OAuth client ID**, type *Web application*.
3. Authorized redirect URI: `https://<your-site>/api/auth/google/callback`
   (and `http://localhost:8787/api/auth/google/callback` for local testing).
4. Copy the client ID into `wrangler.jsonc` (`vars.GOOGLE_CLIENT_ID`) and keep the secret for step 4.

While the consent screen is in *Testing*, only listed test users can sign in. Publish it to open sign-in to everyone.

## 3. Email (Resend)

1. Create an account at resend.com and an API key.
2. Add and verify your sending domain (DNS records). Until a domain is verified Resend only delivers to your own account address,
   which is enough for trying it out with `onboarding@resend.dev` as the sender.
3. Set `vars.EMAIL_FROM` in `wrangler.jsonc`, for example `Astrophage <alerts@yourdomain.com>`.

The sender sits behind a small interface (`src/lib/server/mailer.ts`), so another provider is a one-function change.

## 4. Settings and secrets

In `wrangler.jsonc` set `APP_URL` (your public origin, no trailing slash), `GOOGLE_CLIENT_ID` and `EMAIL_FROM`. Placeholder values are treated as unset.

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET   # 32+ random characters: openssl rand -base64 48
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put CRON_SECRET      # any long random string; the cron handler sends it to the API route
```

## 5. Deploy

```bash
npm run cf:deploy
```

Then open the site, open the alerts panel (bell), add a rule, choose **Continue with Google**, turn on email alerts and press **Send a test**.

## Local testing

Copy `.dev.vars.example` to `.dev.vars`, fill it in, run `npm run cf:migrate:local`, then `npm run cf:preview` (serves on http://localhost:8787).
To trigger the job by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:8787/api/cron/alerts
```

The response reports `subscribers`, `emails`, `alerts`, `failures` and `feedFailures`.

## Data and privacy

Stored per user: Google email, name and picture URL, their rules, the email on/off flag, and a log of event ids already emailed (pruned after about four days).
Deleting the account removes all of it. See `/privacy`.

## Limits worth knowing

- Resend's free tier has a daily send cap; one batched email per subscriber per run keeps usage low.
- The job reads USGS (M2.5+, last 48 h), EONET (last 10 days) and GDACS cyclones. If one feed is down the others still run.
- Cron Triggers can be delayed or skipped by Cloudflare occasionally; an event is only marked sent after its email succeeds, so it is retried on the next run.
