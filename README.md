# skk — QR scanbooth scanner

Scan QR booth codes, then call the symposium scanbooth endpoint by ID.
Live at **https://skk.dhomanhuri.id**.

## How it works

1. Camera reads a QR containing a numeric ID (e.g. `199`).
2. Browser POSTs the scanned text to `/api/scan`.
3. Server logs in to `simposiumtihulumigas2026.com` (Yii2 session), caches
   the cookie jar **in the container's memory**, calls the scan endpoint.
4. UI shows the ID, status, and participant profile (name/company/email/photo).

Session cookies never reach the browser. The upstream rotates the PHP
session id on every authenticated call; the server folds the new cookie back
into the cached jar after each request and re-logs-in automatically if the
session ever comes back as a redirect (expired/killed).

## Configuration

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose |
| --- | --- |
| `SYMPOSIUM_USERNAME` / `SYMPOSIUM_PASSWORD` | Booth login. **Required** — app returns an error until set. |
| `SYMPOSIUM_LOGIN_PATH` | Login page. Defaults to `/kitchen/default/login`. |
| `SYMPOSIUM_LOGIN_FIELD_USER` / `_PASS` | Login form field names. Defaults suit the stock Yii2 `User` model. |
| `SYMPOSIUM_SCAN_PATH` | Scan endpoint. Defaults to `/kitchen/dson/scanbooth`. |
| `APP_PORT` | Host port docker-compose exposes (currently `3021`). |

After changing `.env`:

```bash
docker compose up -d --build
```

## Deploy / routing

- App runs in Docker, published on `127.0.0.1:3021` only (not exposed
  publicly on its own).
- Public traffic reaches it through the existing Cloudflare Tunnel
  (`aiserver`, id `a16c1d7f-a8c7-4e7b-bd5d-4a30fa1767c9`), which is
  **remotely managed** (config lives in Cloudflare, not a local
  `config.yml`) — no need to touch the `cloudflared` systemd service.
- Ingress rule `skk.dhomanhuri.id → http://localhost:3021` and the CNAME DNS
  record (`skk.dhomanhuri.id → a16c1d7f-....cfargotunnel.com`, proxied) were
  both created via the Cloudflare API using the token at `~/.cf-token`. That
  token has **both** DNS-edit and Zero Trust tunnel-config-edit scope on this
  account, so tunnel ingress rules can be managed from the CLI without
  touching the dashboard.
- No nginx vhost or certbot certificate needed — the tunnel terminates TLS
  and proxies straight to the container over plain HTTP on localhost.

To change the ingress rule later:

```bash
CF_TOKEN=$(cat ~/.cf-token)
ACCOUNT_ID=3d63ab3422b8fdb1f9a43bdf15c7395b
TUNNEL_ID=a16c1d7f-a8c7-4e7b-bd5d-4a30fa1767c9
# GET current config, edit the ingress array, PUT it back (see git history
# of this file for the exact call used to add this rule).
```

## Notes

- Camera requires a secure context — works on `skk.dhomanhuri.id` (HTTPS);
  on `localhost` only for local dev.
- Scanner also accepts a full URL (`.../scanbooth?id=199`), pulling the ID
  out of the `id` query parameter, so a mixed batch of printed codes still
  scans as long as one code style is a bare number and the other carries
  `?id=`.
- Manual ID field at the bottom is a fallback if the camera won't focus.
