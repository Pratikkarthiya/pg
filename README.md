# Bliss Girls PG

The active app runs locally using Node.js 24, SQLite and local uploads. It does not use Cloudflare.

Run from this directory:

```powershell
node server/index.mjs
```

Open http://127.0.0.1:5173/setup to create the first administrator. Then use /admin to invite residents and /resident for resident login.

Includes room and bed assignments, monthly rent records, payment-reference review, private screenshots, complaints, notices, room photos and advertised rent.

Read LOCAL-SETUP.md for complete workflows, storage, backup, password recovery and limitations. No deployment has been performed. Historical framework files are not the active runtime.

Checks: `node --test tests/local-portal.test.mjs tests/room-validation.test.ts`

Local bundle: `node scripts/build-local.mjs`
