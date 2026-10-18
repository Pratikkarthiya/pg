# Project constraints

- The user explicitly said never to use their Cloudflare account or services. Do not run Cloudflare, Wrangler, Workers, D1, R2 or Sites deployment operations for this project.
- The user selected free-tier Netlify hosting with Supabase PostgreSQL and private Storage. Use netlify.toml and NETLIFY-SUPABASE.md. Do not provision paid Render resources.
- Netlify uses cloud/api.mjs and Supabase migrations; server/index.mjs is an offline SQLite preview only. Never use SQLite or Netlify's local filesystem for hosted resident data.
- SUPABASE_SECRET_KEY and BLISS_SETUP_TOKEN belong only in server-side function environment variables. Never include them in the publish directory, browser code, Git or logs.
- Historical framework and hosting files may remain for reference; they are not the active runtime.
- Resident records, payment proofs and complaints are private. Enforce authorization on every request, not only in the UI.
