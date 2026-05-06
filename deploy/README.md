# Deploy notes — albumyoo

```bash
# On albumyoo, as root
curl -fsSL https://raw.githubusercontent.com/Foundermodus/a3f/main/deploy/install.sh | sudo bash
```

Or step by step:

```bash
sudo apt-get install -y nodejs npm nginx certbot python3-certbot-nginx
sudo git clone https://github.com/Foundermodus/a3f.git /opt/a3f
cd /opt/a3f
sudo bash deploy/install.sh
```

## Update after a push

```bash
cd /opt/a3f
sudo bash deploy/install.sh    # pulls + npm ci + restart
```

## Files

- `a3f.service` — systemd unit (runs as `a3f` user, hardened sandbox)
- `a3f.nginx.conf` — TLS + reverse proxy template
- `install.sh` — idempotent installer (clone / pull, npm ci, enable service, health probe)

## Logs

```bash
journalctl -u a3f -f
```

## Reset

```bash
sudo systemctl stop a3f
sudo rm -rf /opt/a3f/backend/data/*.db /opt/a3f/backend/uploads/*
sudo systemctl start a3f
```
