# Bliss administrator

For the hosted Netlify + Supabase app, see NETLIFY-SUPABASE.md. Configure the server-side secrets, apply the Supabase migration, verify /healthz, then open /setup with the private setup key to create the first administrator.

Use /admin to assign residents and manage rent, payment review, requests, notices and room photos. Residents use one-time invitations and sign in at /resident.

The local server remains available as an offline preview using a separate SQLite database. Its setup, data and recovery script do not affect hosted data.
