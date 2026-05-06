# A3F — Backend-Migration auf neuen Server (Cloudflare Tunnel)

Stand: 2026-05-06. Ziel: Backend von `albumyoo` (aktuell hinter Tailscale Funnel) auf einen neuen Server umziehen, der per Cloudflare Tunnel erreichbar ist. **Frontend bleibt unverändert** auf GitHub Pages.

## Übersicht

```
                  ┌──────────────────────────┐
                  │ GitHub Pages (unverändert)│
                  │ foundermodus.github.io/a3f│
                  └─────────────┬────────────┘
                                │ HTTPS
                                ▼
                  ┌─────────────────────────────┐
                  │ Cloudflare Edge (TLS, DDoS) │
                  │  a3f-api.<deine-domain>     │
                  └─────────────┬───────────────┘
                                │ Cloudflare Tunnel (outbound, kein Port-Forward)
                                ▼
                  ┌─────────────────────────────┐
                  │ Neuer Server                │
                  │  cloudflared.service        │
                  │  a3f.service (Node.js:3301) │
                  │  /opt/a3f                   │
                  └─────────────────────────────┘
```

## Was du brauchst

| Item | Beschreibung |
|------|-------------|
| **Domain** | Bei Cloudflare als Site hinzugefügt (Nameserver-Wechsel). |
| **Subdomain** | z.B. `a3f-api.deine-domain.ch` — wird automatisch via CF Tunnel angelegt. |
| **CF Tunnel-Token** | Aus `dash.cloudflare.com` → Zero Trust → Networks → Tunnels → Create. Ein langer `eyJh…`-String. |
| **Server** | Linux mit sudo-Zugriff. Node.js 20+ wird im Setup installiert. |
| **Daten-Tarball** | `data.tar.gz` (siehe unten — wird vom alten Server kopiert). |

## Schritt-für-Schritt

### 1) Repo klonen + Backend installieren

```bash
sudo apt-get update && sudo apt-get install -y nodejs npm git curl
sudo git clone https://github.com/Foundermodus/a3f.git /opt/a3f
cd /opt/a3f
sudo bash deploy/install.sh
```

`install.sh` macht:
- legt Service-User `a3f` an
- `npm ci` im backend/
- generiert `.env` mit zufälligem ADMIN_KEY (chmod 600)
- aktiviert `a3f.service` (systemd) auf Port 3301

### 2) Daten vom alten Server importieren

Der Daten-Tarball enthält:
- `data/a3f.db` (SQLite mit Teilnehmer-Einträgen)
- `data/a3f.db-shm` und `data/a3f.db-wal` (WAL-Files)
- `uploads/*.jpg` (Sticker-Fotos + Thumbnails)
- `.env` (ADMIN_KEY und Konfig)

Pfad zum Export auf dem alten Server (albumyoo): siehe Telegram-Nachricht oder `~/a3f-export-<datum>/data.tar.gz`.

```bash
# Auf dem neuen Server
sudo systemctl stop a3f.service
sudo tar xzf data.tar.gz -C /opt/a3f/backend/
sudo chown -R a3f:a3f /opt/a3f/backend/data /opt/a3f/backend/uploads
sudo chmod 600 /opt/a3f/backend/.env
sudo systemctl start a3f.service
sudo systemctl status a3f.service
curl -fsS http://127.0.0.1:3301/health   # → {"ok":true,...}
```

### 3) `.env` an neuen Hostnamen anpassen

```bash
sudo nano /opt/a3f/backend/.env
# Ändern:
#   CORS_ORIGIN=https://foundermodus.github.io
#   PUBLIC_BASE_URL=https://a3f-api.deine-domain.ch
sudo systemctl restart a3f.service
```

### 4) Cloudflared installieren

```bash
# Debian/Ubuntu
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

### 5) Cloudflared mit Token starten (als systemd-Service)

Vom Cloudflare-Dashboard kopierst du den **Tunnel-Token** (lange `eyJh…`-String).

```bash
sudo cloudflared service install <DEIN_TUNNEL_TOKEN>
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
journalctl -u cloudflared -f
# Zeile "Connection registered" muss erscheinen.
```

### 6) Public Hostname im CF-Dashboard setzen

`Zero Trust → Networks → Tunnels → a3f → Public Hostname → Add`:

| Feld | Wert |
|------|------|
| Subdomain | `a3f-api` |
| Domain | `<deine-domain>` |
| Path | (leer) |
| Type | `HTTP` |
| URL | `localhost:3301` |

CF erstellt automatisch den DNS-Eintrag und das TLS-Zertifikat.

Test:

```bash
curl -fsS https://a3f-api.<deine-domain>/health
# {"ok":true,"ts":...}
```

### 7) Frontend-config umstellen

Im Repo:

```bash
git clone https://github.com/Foundermodus/a3f.git /tmp/a3f
cd /tmp/a3f
# frontend/config.js — eine Zeile anpassen:
#   window.A3F_API_BASE = 'https://a3f-api.<deine-domain>';
git add frontend/config.js
git commit -m "frontend: switch API to Cloudflare Tunnel"
git push origin main
```

GitHub Actions deployt das Frontend automatisch (~1 Min).

### 8) Alte Tailscale-Funnel-Route deaktivieren

```bash
# Auf albumyoo
sudo tailscale funnel reset
sudo tailscale serve reset
```

### 9) End-to-End-Test

```bash
# Auf irgendeinem Rechner
~/a3f/tests/e2e.sh
# (vorher tests/e2e.sh anpassen: API="https://a3f-api.<deine-domain>"
#  und PUB_IP/RESOLVE-Zeilen entfernen, weil Cloudflare normales DNS hat)
```

## Wartung & Notfall

```bash
# Backup
sudo tar czf a3f-backup-$(date +%F).tar.gz -C /opt/a3f/backend data uploads .env

# Logs
sudo journalctl -u a3f.service -f
sudo journalctl -u cloudflared -f

# Update
cd /opt/a3f && sudo bash deploy/install.sh   # idempotent: pull + npm ci + restart

# ADMIN_KEY rotieren (für DELETE-Endpoint)
sudo sed -i "s|ADMIN_KEY=.*|ADMIN_KEY=$(head -c 24 /dev/urandom | base64 | tr -d +/=)|" /opt/a3f/backend/.env
sudo systemctl restart a3f.service

# Eintrag löschen
KEY=$(sudo grep ^ADMIN_KEY /opt/a3f/backend/.env | cut -d= -f2)
curl -X DELETE -H "X-Admin-Key: $KEY" https://a3f-api.<deine-domain>/api/participants/<id>

# Daten komplett wipen (z.B. nach Event)
sudo systemctl stop a3f.service
sudo rm /opt/a3f/backend/data/*.db* /opt/a3f/backend/uploads/*.jpg
sudo systemctl start a3f.service
```

## API-Referenz (für Frontend-Konsistenz)

| Method | Path                    | Body                                     | Headers                |
|--------|-------------------------|------------------------------------------|------------------------|
| GET    | `/health`               | —                                        | —                      |
| POST   | `/api/submit`           | multipart: name, photo?, photo2?, email?, phone? | `X-Idempotency-Key` (Browser-UUID) |
| GET    | `/api/participants`     | —                                        | —                      |
| GET    | `/api/stats`            | —                                        | —                      |
| DELETE | `/api/participants/:id` | —                                        | `X-Admin-Key`          |
| GET    | `/uploads/<file>`       | —                                        | —                      |

Antworten siehe `backend/server.js`. Validierungen: `name` Pflicht, `email`/`phone` Format-checked, MIME-Whitelist (jpeg/png/webp/heic/heif), max 8 MB pro Foto, max 2 Fotos.

## Status zum Migrationszeitpunkt

- 4 Teilnehmer-Einträge in der DB
- 12 Foto-Dateien (8 Original + 4 Thumbnails — Backfill bereits gelaufen)
- Daten-Tarball: ~990 KB
- ADMIN_KEY ist im Tarball enthalten (`.env`); falls du einen neuen willst, einfach via Befehl oben rotieren.
