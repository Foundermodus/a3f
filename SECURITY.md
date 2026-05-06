# Security review — A3F

## Threat model

| Asset | Threat | Mitigation |
|---|---|---|
| Backend host | RCE via image upload | `sharp` re-encodes with `failOn:'error'`, `limitInputPixels`, server-generated filename, only `image/*` MIME accepted, file size capped (8 MB) |
| Database | SQL injection | Parameterized statements via `better-sqlite3`; `ORDER BY` whitelisted (no string interpolation of user input) |
| ADMIN_KEY | Timing attack | `crypto.timingSafeEqual` for header compare; key ≥24 chars enforced |
| ADMIN_KEY | Weak default | `install.sh` autogenerates 192-bit base64 key on first run |
| Filesystem | Path traversal in static `/uploads/` | Filenames are `${randomBytes(12).hex}.jpg`; `dotfiles:'deny'`, `index:false` |
| CORS | Open access | Allowlist via `CORS_ORIGIN` env, callback rejects unlisted origins |
| Headers | Clickjacking, MIME sniff, info leak | `helmet` middleware + nginx `X-Frame-Options:DENY`, `X-Content-Type-Options:nosniff`, HSTS 2y, Permissions-Policy lockdown |
| TLS | Downgrade | nginx: TLS 1.2+ only, HSTS preload-eligible |
| Process | Privilege escalation | systemd unit: dedicated `a3f` user, `NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths` whitelisted, `MemoryDenyWriteExecute`, `RestrictAddressFamilies` |
| Rate / DoS | Spam, brute force | App-level: 5 submits/min, 30 admin/min, 120 reads/min per IP. nginx: `limit_req` zones reinforce. nginx body & header timeouts. |
| EXIF leak | Photo geo-metadata | `sharp` strips metadata via `.withMetadata({})` (empty whitelist) |
| Dependencies | Supply chain | QR library bundled locally (`frontend/vendor/qrcode.min.js`), no runtime CDN |
| Frontend | XSS | All user data rendered via `textContent` only; no `innerHTML` interpolation |

## Residual risks (accepted)

- **Public PII** — names + sticker photos are deliberately public. Email is no longer collected.
- **No CAPTCHA** — submit is rate-limited but bots could still join. Acceptable for invite-only events; if abused, rotate `ADMIN_KEY` and DELETE.
- **No auth on submit** — anyone with the URL can submit. By design (event flow). Mitigation: rotate the URL or shut down the service after the event.
- **WAL files in `data/`** — readable by service user; DB file contains all participant data. Backup + delete after event.

## Run-time hygiene

```bash
# Rotate admin key
sudo sed -i "s|ADMIN_KEY=.*|ADMIN_KEY=$(head -c 24 /dev/urandom | base64 | tr -d '+/=')|" /opt/a3f/backend/.env
sudo systemctl restart a3f

# Wipe data after event
sudo systemctl stop a3f
sudo rm -f /opt/a3f/backend/data/*.db* /opt/a3f/backend/uploads/*
sudo systemctl start a3f

# Audit dependencies
cd /opt/a3f/backend && npm audit --omit=dev
```
