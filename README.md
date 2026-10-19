# Bliss Girls PG

**Current version: browser-only demo.** Pink liquid-glass website with sample admin and resident dashboards. No database or passwords required. Read [DEMO.md](DEMO.md) and run `npm run dev` to preview. Publish `dist-netlify` on Netlify.

The hosted API is disabled for the demo. The following describes the preserved full backend for reference:

- Netlify serves the website and API.
- Supabase PostgreSQL stores accounts, room assignments, rent records, requests and notices.
- Supabase private Storage stores room photos and payment proofs.
- Resident data is not stored on Netlify's temporary filesystem.
- No Cloudflare services or paid Render resources are used.

Read [NETLIFY-SUPABASE.md](NETLIFY-SUPABASE.md) to connect accounts, apply the migration and deploy from GitHub. A pushed commit is not proof of a live deployment.

## Local offline preview

```powershell
node server/index.mjs
```

Open http://127.0.0.1:5173/setup. This separate SQLite preview does not read or change hosted Supabase data.

## Checks and build

```powershell
npm ci
npm test
npm run build
```

Node 24 is required. The cloud test runs the actual PostgreSQL migration in PGlite and checks the serverless API with a simulated storage service. Real deployment still requires verification against the connected accounts.
