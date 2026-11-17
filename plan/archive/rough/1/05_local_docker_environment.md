# 05 - Local Environment Setup & Docker Compose

**Module**: 05 Local Environment Setup & Docker Compose  
**Parent Plan**: [Master Index](../1.md)

---

## 1. Local Environment Architecture

Local development requires zero external SaaS cloud dependencies. The entire system spins up on a developer's machine using **Docker Compose V2**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Traefik V3 Edge Proxy                            │
│                                 (Port 80)                                   │
└──────┬──────────────┬──────────────┬──────────────┬──────────────┬──────────┘
       │              │              │              │              │
       ▼              ▼              ▼              ▼              ▼
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ Astro App  │ │ PostgreSQL │ │ OpenFGA    │ │ MinIO S3   │ │Meilisearch │
│ (Port 4321)│ │ (Port 5432)│ │ (Port 8081)│ │ (Port 9000)│ │ (Port 7700)│
└────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘
```

---

## 2. Environment Configuration (`.env.example`)

```env
# General Stack Configuration
NODE_ENV=development
PORT=4321
HOST=0.0.0.0

# Database Settings
POSTGRES_DB=workspace_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=
DATABASE_URL=postgresql://postgres@postgres:5432/workspace_db

# OpenFGA Authorization Settings
OPENFGA_API_URL=http://openfga:8081
OPENFGA_STORE_ID=01HQ0000000000000000000000

# MinIO S3 Asset Storage
MINIO_ENDPOINT=http://minio:9000
MINIO_ROOT_USER=minio_admin
MINIO_ROOT_PASSWORD=minio_dev_password
MINIO_BUCKET_NAME=workspace-private

# Meilisearch Engine
MEILI_MASTER_KEY=meili_dev_master_key
MEILISEARCH_URL=http://meilisearch:7700

# Authentik OIDC Credentials
OIDC_ISSUER_URL=http://authentik:9000/application/o/workspace/
OIDC_CLIENT_ID=workspace_client_id
OIDC_CLIENT_SECRET=workspace_client_secret
```

---

## 3. Developer Quickstart Commands

```bash
# 1. Clone workspace and navigate to template
git clone <repository_url>
cd template

# 2. Copy environment file
cp .env.example .env

# 3. Start local Docker Compose stack
docker compose up -d

# 4. Apply database migrations & seed OpenFGA tuple store
docker compose exec app npm run db:migrate
docker compose exec app npm run authz:seed

# 5. Access services locally:
# - Astro Web App:      http://localhost
# - Traefik Dashboard:  http://localhost:8080
# - OpenFGA Playground: http://localhost:3000
# - MinIO Web Console:  http://localhost:9001
```

---

## 4. Next Steps & References
- Review production deployment strategies in [06 Production Deployment & DevOps](06_production_deployment_and_devops.md).
- Review identity & search details in [07 Identity & Search](07_identity_and_search.md).
