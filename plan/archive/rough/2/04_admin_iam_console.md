# 04 - Admin IAM Control Console

**Module**: 04 Admin IAM Control Console  
**Parent Plan**: [Plan 2 Master Index](../2.md)

---

## 1. Visual IAM Management Dashboard

The platform features an embedded **Admin IAM Console** (`/admin/permissions`) allowing administrators and resource owners to inspect and manage access rules visually.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Admin IAM Control Panel                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  Filter Target: [ Resource ID / User ID / Group ID ]                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  Active Bindings:                                                           │
│  - Resource: pdf:q3_contract | Principal: user:bob | Role: denied_viewer    │
│  - Resource: folder:legal    | Principal: group:legal | Role: viewer        │
├─────────────────────────────────────────────────────────────────────────────┤
│  Actions: [+ Add Binding] [- Revoke Binding] [View Relationship Graph]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Capabilities

1. **Tuple Browser**: Real-time listing of OpenFGA relationship tuples.
2. **Permission Simulator**: Interactively test permission evaluations for any user against any resource.
3. **Storage Analytics**: Inspect total MinIO S3 bucket size, asset counts, and bandwidth metrics.
