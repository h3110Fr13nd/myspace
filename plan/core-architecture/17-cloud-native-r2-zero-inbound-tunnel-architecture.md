# Plan 17: Cloud-Native R2 Storage, Zero-Inbound Cloudflare Tunnel & Dual Stack Optimization

## Overview
This specification documents the cloud infrastructure modernization across both the **FOSS Content Workspace** and **Cost-Tracker** production applications co-located on a cost-free Azure VM. It transitions both stacks from heavy self-hosted storage and reverse proxies to zero-inbound Cloudflare Tunnels and Cloudflare R2 object storage.

---

## 1. Architectural Evolution

| Component | Legacy Self-Hosted Pattern | Modern Cloud-Native Pattern | Impact |
| :--- | :--- | :--- | :--- |
| **Object Storage** | `minio/minio` Docker container on VM | **Cloudflare R2** (S3-compatible API) | Saved **~65 MiB RAM** per stack; zero maintenance; 10 GB free + zero egress fees |
| **Edge Ingress & SSL** | `traefik:v3.0` listening on `:80`/`:443` | **Cloudflare Tunnel (`cloudflared`)** | **Zero open inbound ports** on VM; automatic DDoS protection, TLS 1.3, edge caching |
| **Deployment Engine** | Inbound SSH port exposure | **Azure Run Command (`az vm run-command`)** | Complete private VM isolation; deploy triggers over Azure control plane |
| **Compose Profiles** | Single monolithic stack | **Profiles (`default` vs `local-offline`)** | Cloud stack runs lean; MinIO & Traefik preserved for offline testing without internet |

---

## 2. Docker Compose Profiles Specification

Both projects (`foss-content-workspace` and `cost-tracker`) now implement Docker Compose Profiles:

### Default Profile (`docker compose up -d`)
- Optimized for low-memory cloud VM hosting.
- `foss-content-workspace`: `app`, `postgres`, `openfga`, `meilisearch`, `cloudflared`.
- `cost-tracker`: `postgres`, `redis`, `backend`, `frontend`, `tunnel`.

### Local Offline Profile (`docker compose --profile local-offline up -d`)
- Enables full local development and testing without internet access or Cloudflare credentials.
- Activates `minio` on `:9000` (S3 API) and `:9001` (Web Console).
- Activates `traefik` on `:80` and `:8080` (Dashboard).

---

## 3. Storage Layer Unification (Agnostic S3 Client)

The storage client in both TypeScript (`src/lib/storage.ts`) and Python (`backend/app/services/storage.py`) was unified to be completely agnostic across any S3-compatible backend:

```typescript
// Unified credentials resolution (supporting S3, R2, GCS, MinIO, or AWS)
const endpoint = process.env.S3_ENDPOINT_URL || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '';
const region = process.env.S3_REGION || (endpoint?.includes('r2.cloudflarestorage.com') ? 'auto' : 'us-east-1');
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true' || (endpoint?.includes('minio') || endpoint?.includes('localhost'));
```

---

## 4. Resource & Memory Footprint Verification

After removing `minio` containers and switching to Cloudflare R2:
- **Cost-Tracker Stack**: Reduced from **~119 MiB** down to **~51 MiB** RAM total across all 5 containers.
- **VM Available System RAM**: Increased to **367 MiB** free headroom.
- **CI/CD Build Speed**: Enabled persistent BuildKit npm cache mounts (`--mount=type=cache,target=/root/.npm`) and removed `--no-cache`, accelerating image builds from minutes to under 45 seconds.


---

## 📋 Implementation Status & Audit Checklist

**Status**: ✅ Fully Implemented | **Infrastructure**: Cloudflare Tunnel & R2 Cloud Storage

- [x] Zero-inbound Cloudflare Tunnel setup (`cloudflared` container, no open ingress ports)
- [x] Agnostic S3 client supporting Cloudflare R2 and MinIO fallback (`src/lib/storage.ts`)
- [x] Docker Compose profiles (`default` lean cloud stack vs `local-offline` full stack)
- [x] Elimination of VM reverse proxy overhead (Traefik removed from cloud profile)
- [x] BuildKit persistent npm cache acceleration in Dockerfile
- [x] Zero-egress bandwidth configuration
