# 06 - Production Deployment Blueprint & DevOps

**Module**: 06 Production Deployment Blueprint & DevOps  
**Parent Plan**: [Master Index](../1.md)

---

## 1. High-Availability Production Architecture

Production deployment transforms the local docker environment into a resilient, high-availability cluster capable of horizontal scaling and fault-tolerant operation.

```
                           ┌──────────────────────────────────────────────┐
                           │          Traefik Edge Router / SSL           │
                           │           (Let's Encrypt / ACME)             │
                           └──────────────────────┬───────────────────────┘
                                                  │
                                                  ▼
                        ┌────────────────────────────────────────────────────┐
                        │          Astro SSR Node App Cluster                │
                        │        (Autoscaled Stateful/Stateless)             │
                        └─────────┬──────────────────┬───────────────────┬───┘
                                  │                  │                   │
                                  ▼                  ▼                   ▼
                       ┌────────────────────┐ ┌──────────────┐ ┌───────────────────┐
                       │ PostgreSQL Cluster │ │ OpenFGA      │ │ MinIO Distributed │
                       │ (Primary + Replica │ │ Cluster      │ │ High Availability │
                       │  + PgBouncer)      │ │ (ReBAC AuthZ)│ │ S3 Storage        │
                       └────────────────────┘ └──────────────┘ └───────────────────┘
```

---

## 2. Security Hardening & Compliance

1. **Non-Root Container Execution**: All service containers execute using explicit non-root service accounts (`USER node:node` / `USER 10001:10001`).
2. **Network Isolation**: The edge proxy (Traefik) is the **only** container listening on public host ports (80/443). Internal database, authorization, and storage ports (5432, 8081, 9000) are restricted strictly to internal bridge/overlay networks.
3. **Automated Backup & Restore Strategy**:
   - **PostgreSQL**: Daily physical backups via `pg_back/wal-g` shipped to offsite cold storage.
   - **MinIO S3**: Active bucket replication to a secondary remote MinIO/S3 target.
   - **OpenFGA**: Daily tuple snapshot dumps exported via OpenFGA CLI (`fga store export`).

---

## 3. Pivot Notice & Alternatives Matrix

### Pivot Option A: Deployment Engine — Kubernetes (Helm / Kustomize) vs. Docker Swarm vs. Nomad
- **When to Pivot**: If high enterprise traffic requires multi-zone failover, automated pod autoscaling (HPA), or strict GitOps workflows (ArgoCD / Flux).
- **Alternatives**:
  1. **Kubernetes + Helm**: De facto cloud standard.
  2. **Docker Swarm**: Zero-overhead lightweight clustering for small-to-medium teams.
  3. **HashiCorp Nomad**: Elegant single-binary workload orchestrator.
- **Migration Cost**: Low to Moderate.

### Pivot Option B: Database Managed Service — Cloud Managed Postgres (AWS RDS / GCP Cloud SQL / Neon / Supabase)
- **When to Pivot**: If self-hosting PostgreSQL high availability (Patroni/Stolon) incurs unacceptable maintenance overhead.
- **Migration Cost**: Low (standard PostgreSQL connection URI switch).

---

## 4. Next Steps & References
- Review identity & search setup in [07 Identity & Search](07_identity_and_search.md).
- Review master pivot matrix in [08 Pivot Matrix & ADRs](08_pivot_matrix_and_adrs.md).
