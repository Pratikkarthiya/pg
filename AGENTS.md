# Project constraints

- The user explicitly said never to use their Cloudflare account or services. Do not run Cloudflare, Wrangler, Workers, D1, R2 or Sites deployment operations for this project.
- The active application uses Node.js with SQLite and file uploads. The user selected and authorized Render hosting. Use render.yaml and RENDER-DEPLOY.md for deployment; keep local development on loopback.
- Historical framework and hosting files may remain for reference; they are not the active runtime.
- Resident records, payment proofs and complaints are private. Enforce authorization on every request, not only in the UI.
