# 05 - Service Resilience & Fallback Cleanliness

**Module**: 05 Service Resilience & Fallback Cleanliness  
**Parent Plan**: [Plan 2 Master Index](../2.md)

---

## 1. Clean Connection Handling for Offline Services

When running in local dev mode without Docker containers active, local service connections (`ECONNREFUSED` on port 8081 for OpenFGA, port 9000 for MinIO, or port 5432 for Postgres) can emit loud stack traces in the server terminal console.

### Resilience Principles
1. **Silent Fallback Evaluation**: `src/lib/openfga.ts` intercepts connection errors (`ECONNREFUSED` / `ENOTFOUND`), logs a single concise info line instead of a multi-line stack trace, and gracefully evaluates local policies.
2. **Offline Local Developer Mode**: Ensures developer workflow remains uninterrupted even when backend microservices are starting up or running in offline mode.
