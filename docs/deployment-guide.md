# Deployment Guide — QAD Platform

## Prerequisites

- Docker Desktop 4.x+ (or Docker Engine + Compose plugin on Linux)
- Git
- A domain name (for production) or `localhost` (for local/staging)
- Gmail account with OAuth2 configured in n8n (for email notifications)

---

## Local deployment (development)

```bash
git clone <repo-url> qad && cd qad
cp .env.example .env
docker compose up -d
docker exec qad-ollama ollama pull llama3.2
```

Apply schemas (first time only):
```bash
docker exec -i qad_postgres psql -U qad_user -d qad < data_spine/data_spine.sql
docker exec -i qad_postgres psql -U qad_user -d qad < automations/customer_intake_v1/postgres_schema.sql
docker exec -i qad_postgres psql -U qad_user -d qad < automations/document_intake_v1/postgres_schema.sql
docker exec -i qad_postgres psql -U qad_user -d qad < automations/appointment_scheduling_v1/postgres_schema.sql
```

Dashboard: `http://localhost`
n8n: `http://localhost:5678`

---

## Production deployment

### 1. Environment variables

Copy `.env.example` to `.env` and update every value marked **CHANGE THIS**:

```bash
cp .env.example .env
```

| Variable | What to set |
|---|---|
| `POSTGRES_PASSWORD` | Strong random password (min 20 chars) |
| `N8N_ENCRYPTION_KEY` | Random 32-char string — **do not change after first run** |
| `N8N_BASIC_AUTH_PASSWORD` | Strong password for n8n login |
| `WEBHOOK_URL` | `https://your-domain.com/` |
| `N8N_HOST` | `your-domain.com` |
| `GENERIC_TIMEZONE` | Your server timezone (e.g. `America/New_York`) |

### 2. SSL / reverse proxy

QAD does not handle TLS internally. Put a reverse proxy (nginx, Caddy, or Traefik) in front:

**Caddy example** (`/etc/caddy/Caddyfile`):
```
your-domain.com {
    reverse_proxy localhost:80
}

n8n.your-domain.com {
    reverse_proxy localhost:5678
}
```

**nginx example** (simplified):
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://localhost:80;
    }
}
```

### 3. Start the stack

```bash
docker compose up -d
```

Check all services are healthy:
```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
```

All 5 containers should show `Up ... (healthy)` or `Up ...`.

### 4. Apply database schemas

Same as local deployment — run once on first start.

### 5. Pull the Ollama model

```bash
docker exec qad-ollama ollama pull llama3.2
```

This downloads ~2GB. Run it in a screen/tmux session so it completes even if your SSH connection drops:
```bash
screen -S ollama-pull
docker exec qad-ollama ollama pull llama3.2
# Ctrl+A, D to detach
```

### 6. Configure n8n credentials

1. Open n8n at `https://n8n.your-domain.com`
2. Go to **Credentials** → create:
   - **PostgreSQL** — host: `postgres`, port: `5432`, database: `qad`, user/password from `.env`
   - **Gmail OAuth2** — follow n8n's OAuth2 setup with your Google Cloud credentials
3. Import workflows from `automations/*/workflow_upload.json`
4. Update each workflow to use the credentials you just created
5. Activate all three workflows

### 7. Update the React client API URL (if needed)

If your API is at a different URL than `/api`, update the nginx proxy in `dashboard/client/nginx.conf` before building:

```nginx
location /api {
    proxy_pass http://your-api-host:3001;
}
```

Then rebuild: `docker compose build client && docker compose up -d client`

---

## GPU acceleration for Ollama (optional)

If your server has an NVIDIA GPU, uncomment the GPU section in `docker-compose.yml`:

```yaml
ollama:
  # ...
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: all
            capabilities: [gpu]
```

Requires `nvidia-container-toolkit` installed on the host.

---

## Updating the stack

### Update n8n or Ollama image

```bash
docker compose pull n8n ollama
docker compose up -d n8n ollama
```

### Rebuild dashboard after code changes

```bash
docker compose build api client
docker compose up -d api client
```

### Update database views

If `data_spine.sql` changes, re-run it — all statements are idempotent:
```bash
docker exec -i qad_postgres psql -U qad_user -d qad < data_spine/data_spine.sql
```

---

## Backup and restore

### Database backup

```bash
docker exec qad_postgres pg_dump -U qad_user qad > backup_$(date +%Y%m%d).sql
```

### Restore

```bash
docker exec -i qad_postgres psql -U qad_user -d qad < backup_20260515.sql
```

### n8n workflows backup

Export each workflow from the n8n UI (Settings → Export) or use the API:
```bash
curl -H "X-N8N-API-KEY: $N8N_API_KEY" http://localhost:5678/api/v1/workflows \
  > n8n_workflows_backup_$(date +%Y%m%d).json
```

---

## Health checks

```bash
# All containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# API
curl http://localhost:3001/api/health

# n8n
curl http://localhost:5678/healthz

# Database
docker exec qad_postgres pg_isready -U qad_user -d qad

# Ollama
curl http://localhost:11434/api/version
```

---

## Troubleshooting

### n8n won't start — "Mismatching encryption keys"

The `N8N_ENCRYPTION_KEY` in `.env` doesn't match what's stored in the n8n data volume. Use the original key from when the volume was first created. Never change the encryption key on an existing volume — it will break all stored credentials.

### Webhooks return 404

n8n workflows are not active. Open n8n at `:5678` and activate each workflow. After any n8n container restart, check the logs:
```bash
docker logs qad-n8n | grep "Activated workflow"
```

### Dashboard shows no data

1. Check the API: `curl http://localhost:3001/api/health`
2. Check the API can reach postgres: `docker logs qad-dashboard-api | tail -20`
3. Verify the postgres password in `.env` matches the actual container password

### Port conflicts

If something is already using a port (e.g. 5433, 5678, 80), stop that service or change the host-side port mapping in `docker-compose.yml`:
```yaml
ports:
  - "8080:80"  # change left side only
```
