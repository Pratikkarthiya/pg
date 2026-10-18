# Bliss — local resident management

The active application uses Node.js 24+, built-in SQLite, and local file storage. It does not use Cloudflare, Workers, D1, R2, Wrangler, Sites hosting, or ChatGPT sign-in. Historical framework files remain in the checkout for reference and are not loaded by the active server.

## Start

From `sakhi-pg`, run:

```powershell
node server/index.mjs
```

Or run `node preview.cjs` from the workspace root. Open `http://127.0.0.1:5173`. No dependency installation or cloud account is needed.

1. On the first run, open `/setup` to create the administrator with an email and password of at least 12 characters. Setup closes after the first administrator is created.
2. Open `/admin`. Under **Residents**, enter the resident's email, room, sharing type, bed, move-in date, monthly rent and recorded deposit.
3. Copy the invitation link and share it manually. No emails are sent. The link expires in 72 hours and can be used once to choose a password. Local links work only on this computer.
4. Residents sign in at `/resident` or `/login`. Each resident sees only their own stay, rent records, payment proofs and requests, plus shared notices.

The server deliberately binds only to loopback. This is a working local application, not a publicly hosted resident portal. A non-Cloudflare host, domain, HTTPS and a production operating plan must be chosen before residents can use it remotely. No deployment has been performed.

## Workflows

- **Residents:** invitation → activate login → dashboard → view stay / rent → submit transaction reference and optional screenshot → wait for admin verification.
- **Monthly rent:** admin selects month and due date → generates one full monthly charge per active resident who has moved in during or before that month → resident submits reference → admin verifies receipt and marks paid, or returns it to pending with a note. There is no payment gateway or automatic payment verification. Charges are not prorated automatically.
- **Rent changes:** assigned rent affects future generated dues; existing dues keep their recorded amount. Publicly advertised room rent is separate from individual stay rent.
- **Requests:** resident submits → New → Acknowledged → In progress → Resolved. Admin notes are visible only to the resident who raised the request and the admin.
- **Notices:** admin publishes → all active residents can read → admin archives or restores.
- **Move-out:** admin ends the stay → bed becomes free → login and existing sessions are disabled. Rent and request history remain available to the admin. Deposit refunds are not calculated automatically.
- **Photos:** under Rooms, the admin can manage advertised rent and up to six photos per room type. These update the local visitor website.

## Storage and backup

Data is stored in `.local/bliss.sqlite` and uploaded images in `.local/uploads/`. These paths are ignored by Git and excluded from the build. Stop the server before copying the entire `.local` directory as a backup. Keep backups private. `BLISS_DATA_DIR` can select a different local data directory, and `PORT` can select a different loopback port.

Passwords are salted and hashed using scrypt. Sessions use opaque, hashed tokens and HttpOnly/SameSite cookies. Every mutation checks its origin, and private reads enforce the signed-in user's identity. A screenshot remains under review until the administrator verifies it.

For a resident password reset, use **New login invitation**. For administrator recovery, stop the server and run `node scripts/reset-admin.mjs`; it prints a one-time local password-reset link and does not change the password until the link is used.

## Build and checks

```powershell
node --test tests/local-portal.test.mjs tests/room-validation.test.ts
node scripts/build-local.mjs
```

`dist-local/` contains a standalone copy of the Node server and website. It excludes resident data, cloud metadata and historical Cloudflare code. The old hosted website remains unchanged; its previous online room settings and photos are not automatically copied into this local database.
