# Netlify + Supabase

This is the selected hosting architecture. The website is static on Netlify; API requests run in a Netlify Function. PostgreSQL records and private images are stored in Supabase and survive Netlify sleeps, restarts and redeploys. No paid Render resource or Cloudflare service is required.

## 1. Create/connect a Supabase Free project

Use a dedicated project in a region appropriate for your residents. Apply `supabase/migrations/202610180001_bliss.sql` once, using the Supabase SQL Editor or a connected migration tool. This creates the private application schema, server-only database function, and private `bliss-files` bucket.

The migration is versioned and is not intended to be rerun manually after it has been applied. Future schema changes should be new migration files.

Retrieve your project URL and a **server-side secret API key** from the project's Connect/API Keys settings. New keys begin with `sb_secret_`. The server also supports a legacy service-role key as a fallback, but publishable or anon keys cannot run this backend.

## 2. Connect Netlify to GitHub

Import `Pratikkarthiya/pg`, choose the Free plan, and use branch `main`. Netlify reads `netlify.toml`:

- Build: `npm test && node scripts/build-netlify.mjs`
- Publish directory: `dist-netlify`
- Functions: `netlify/functions`
- Node: 24

Set the following in Netlify's environment settings, scoped to **Functions**:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project origin |
| `SUPABASE_SECRET_KEY` | The private server-side secret key |
| `BLISS_SETUP_TOKEN` | A private random secret of at least 32 characters |
| `BLISS_PUBLIC_ORIGIN` | Optional custom HTTPS origin; otherwise the function uses Netlify's `URL` |

Generate the setup secret in a trusted password manager. Keep it out of Git and browser code. Do not paste any secret into a chat or issue. The build never embeds these variables in static files.

Deploy after applying the SQL migration and setting the function variables. Verify `/healthz` returns `{"status":"ok"}`. A successful static build alone does not verify Supabase configuration.

## 3. Set up the PG

Open the live `/setup`. Enter your private setup key and choose your admin email and password. This can be completed only once. Open `/admin` to assign residents and copy individual invitation links. Residents activate their account once and sign in at `/resident`.

The existing account workflow is preserved: scrypt password hashes and opaque hashed sessions now persist in Supabase PostgreSQL. This migration does not switch existing users to Supabase Auth or send email invitations. The admin shares invitations manually. Only the Netlify server can call the database function; browser publishable keys and authenticated Supabase clients cannot access the application tables or private bucket.

Payment proofs are private and can be viewed only through the API by their owner or admin. Room photos are public through the API. The bucket itself stays private. Both upload types are limited to **4 MB** because Netlify's binary request limit is lower than its nominal request limit. Each room type can hold six photos.

Monthly dues, payment review, requests and notices work as before. Payment references remain under review until verified; no money is transferred by this application.

## Free-tier limits

Netlify and Supabase have usage limits that can change. Keep both projects on Free, do not enable automatic paid upgrades, and monitor usage. Supabase free projects can pause after low activity; this application does not bypass that policy. Photos consume the project's file-storage allowance. This setup is not a promise of permanent free capacity or uptime.

## Local development and tests

`node server/index.mjs` still starts the separate offline SQLite preview. It does not read or modify hosted data.

For a configured cloud preview, first build, then use the Netlify CLI's `netlify dev` with secrets in an ignored local `.env` and `BLISS_PUBLIC_ORIGIN=http://localhost:8888`. Do not expose the local preview publicly.

`npm test` runs local SQLite tests plus an embedded PostgreSQL test. The cloud test executes the actual migration and API against PGlite, with an in-memory Storage adapter. It verifies SQL behavior and access isolation; it does not replace a live Supabase/Netlify deployment check.

Existing SQLite records and local uploads are not uploaded by Git and are not automatically migrated. Keep the local backup. Moving real resident data needs a separately planned transfer and verification.

## Admin recovery

For the hosted app, run `node scripts/reset-cloud-admin.mjs` in a trusted terminal with `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `BLISS_PUBLIC_ORIGIN` set privately in its environment. It prints a one-time link valid for 30 minutes. Keep that link private. Recovery requires the operator's Supabase secret; it is not exposed as a public HTTP endpoint. The old `scripts/reset-admin.mjs` operates only on the offline SQLite preview.
