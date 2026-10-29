# Deployment & Operations Guide - Global_Fit_Ulttra

This document provides operational instructions for provisioning, configuring, securing, and maintaining the Global_Fit_Ulttra backend in production.

---

## 1. Environment & Secret Provisioning

Generate all cryptographic secrets using OpenSSL before starting:

```bash
# Generate 48-byte cryptographically secure random keys
export JWT_ACCESS_SECRET=$(openssl rand -base64 48)
export JWT_REFRESH_SECRET=$(openssl rand -base64 48)
export REDIS_PASSWORD=$(openssl rand -base64 48)
export MONGO_INITDB_ROOT_PASSWORD=$(openssl rand -base64 48)
export QDRANT_API_KEY=$(openssl rand -base64 48)
export RABBITMQ_DEFAULT_PASS=$(openssl rand -base64 48)
export LITELLM_MASTER_KEY=$(openssl rand -base64 48)
```

Create a production `.env` file from the template:
```bash
cp .env.example backend/.env
# Populate with generated secrets and provider API keys
```

---

## 2. Production Deployment (Docker Compose + Caddy TLS)

The repository provides an isolated multi-network Docker Compose setup:
- **`frontend` Network:** Public bridge. Caddy binds host ports `80` and `443`.
- **`backend` Network:** Internal network (`internal: true`). MongoDB, Redis, Qdrant, RabbitMQ, and LiteLLM are completely unexposed to the host and external network.

### Starting the Production Stack:
```bash
# 1. Validate configuration
docker compose -f docker-compose.yml -f docker-compose.prod.yml config

# 2. Build and run in detached mode
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# 3. Check health and process isolation
docker compose ps
docker compose exec app id   # Confirms running as non-root user (uid=1001, gid=1001)
```

---

## 3. Render.com Deployment Steps

1. **Create Web Service:**
   - Connect repository in Render Dashboard.
   - Choose **Docker** runtime.
   - Build Context: `.`
   - Dockerfile Path: `./Dockerfile`
   - Plan: Starter or higher.
2. **Environment Variables (Set in Render Dashboard):**
   - `PORT`: `10000`
   - `NODE_ENV`: `production`
   - `JWT_ACCESS_SECRET`: `<openssl generated>`
   - `JWT_REFRESH_SECRET`: `<openssl generated>`
   - `MONGODB_URI`: `<MongoDB Atlas URI with TLS/SSL enabled>`
   - `REDIS_URL`: `<Redis Enterprise or Upstash TLS URI>`
   - `REDIS_PASSWORD`: `<Redis Password>`
   - `GROQ_API_KEY`: `<Groq API Key>`
   - `CORS_ORIGIN`: `https://yourdomain.com`
   - `SOCKET_IO_CORS_ORIGIN`: `https://yourdomain.com`
   - `QDRANT_URL`: `<Managed Qdrant Cloud Cluster URL>`
   - `QDRANT_API_KEY`: `<Qdrant API Key>`
3. **Health Check Path:**
   - Set to `/api/v1/health`
4. **Auto-Deploy:**
   - Keep `autoDeploy: false` to require manual promotion or validated CI approvals.

---

## 4. Secret Rotation Procedures

### A. JWT Secrets Rotation
To rotate JWT signing secrets without immediately invalidating all active sessions:
1. Deploy `JWT_ACCESS_SECRET` with the new key, keeping the old key as fallback in verification logic.
2. Invalidate refresh tokens in database on forced security revocation:
   ```javascript
   await User.updateMany({}, { $set: { refreshTokens: [] } });
   ```
3. Users will re-authenticate to obtain fresh token pairs.

### B. Database & Redis Credentials
1. Create new user/password in MongoDB Atlas or Redis Cloud.
2. Update Render/Docker environment variables with the new connection string.
3. Perform rolling container restart.
4. Remove previous user/password from data store.

---

## 5. Database Backup and Disaster Recovery

### MongoDB Backup (mongodump / mongorestore)
```bash
# Automated backup
docker compose exec mongo mongodump \
  --username admin \
  --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  --db global_fit_ulttra \
  --archive=/data/db/backup-$(date +%F).archive --gzip

# Restore
docker compose exec mongo mongorestore \
  --username admin \
  --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  --archive=/data/db/backup-2026-10-29.archive --gzip
```

### Qdrant Vector Snapshots
```bash
# Create collection snapshot
curl -X POST "http://localhost:6333/collections/global_fit_ulttra_financial_documents/snapshots" \
  -H "api-key: $QDRANT_API_KEY"

# Download snapshot archive
curl -O -J "http://localhost:6333/collections/global_fit_ulttra_financial_documents/snapshots/{snapshot_name}" \
  -H "api-key: $QDRANT_API_KEY"
```

---

## 6. Self-Hosting Security & Firewall Hardening

If hosting on bare metal, AWS EC2, or DigitalOcean Droplets:

1. **UFW Firewall Configuration:**
   ```bash
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw allow 22/tcp    # SSH (prefer changing to non-default port)
   sudo ufw allow 80/tcp    # HTTP
   sudo ufw allow 443/tcp   # HTTPS
   sudo ufw enable
   ```
   **DO NOT** expose ports 27017 (Mongo), 6379 (Redis), 6333 (Qdrant), 5672 (RabbitMQ), or 4000 (Node).

2. **SSH Hardening (`/etc/ssh/sshd_config`):**
   - `PermitRootLogin no`
   - `PasswordAuthentication no`
   - `PubkeyAuthentication yes`
   - `MaxAuthTries 3`

3. **Fail2ban:**
   Install `fail2ban` to ban IPs that exhibit repeated authentication failures.
