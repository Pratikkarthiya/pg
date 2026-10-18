# Render deployment

The GitHub repository is `https://github.com/Pratikkarthiya/pg`. The root `render.yaml` defines a Node 24 web service in Singapore, a 1 GB persistent disk, automatic deploys from `main`, build-time tests, and `/healthz` checks. Render web services with persistent disks require a paid plan. Confirm the service and disk pricing in Render before creating the resources.

## Deploy from GitHub

1. Connect your Render account and GitHub repository, or open https://render.com/deploy?repo=https://github.com/Pratikkarthiya/pg .
2. Create the Blueprint using `render.yaml`. Keep the persistent disk enabled. The application stores its SQLite database and uploaded images under `/var/data/bliss`.
3. After deployment succeeds, open the URL returned by Render. The server automatically uses Render's `RENDER_EXTERNAL_URL`; do not substitute a guessed hostname.
4. In the service environment settings, reveal `BLISS_SETUP_TOKEN`. Render generates this secret; it is never committed to Git or displayed by the website.
5. Open the deployed site's `/setup`, enter this private setup key, and choose your own administrator email and password. Setup closes after the first administrator is created.
6. Use `/admin` to invite residents. Invitation links now point to the deployed HTTPS website. Residents sign in at `/resident`.

## Configuration

- `NODE_VERSION`: `24.19.0`
- `BLISS_DATA_DIR`: `/var/data/bliss` (inside the persistent disk)
- `BLISS_SETUP_TOKEN`: generated secret with at least 32 characters
- `RENDER_EXTERNAL_URL`: supplied automatically by Render
- Optional `BLISS_PUBLIC_ORIGIN`: your custom HTTPS origin, if a custom domain is connected. The application accepts only this origin when set.

Public mode listens on `0.0.0.0` using Render's `PORT`, validates the public Host and Origin, sets Secure/HttpOnly/SameSite session cookies, and requires a private key for first-admin creation. The server does not trust arbitrary forwarded host headers. Local development continues to use `127.0.0.1` without a setup key.

Use a single instance with the disk; do not run separate application instances with independent SQLite files. A disk preserves state across redeploys, but does not replace a backup and recovery plan. Keep database and upload backups private.

The deployed application starts with a new database. Existing local resident records and uploaded images are not uploaded by pushing Git. Any data migration requires a separate, deliberate transfer.

No Cloudflare account, services or deployment tooling are used. Pushing code alone does not prove deployment; confirm Render's deployment status and health endpoint before sharing the live URL.
