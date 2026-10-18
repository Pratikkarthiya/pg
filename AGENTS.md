# Project constraints

- The user explicitly said never to use their Cloudflare account or services. Do not run Cloudflare, Wrangler, Workers, D1, R2 or Sites deployment operations for this project.
- The active application runs locally on Node.js with SQLite and local uploads. Keep it local unless the user selects and authorizes a different hosting provider.
- Historical framework and hosting files may remain for reference; they are not the active runtime.
- Resident records, payment proofs and complaints are private. Enforce authorization on every request, not only in the UI.
