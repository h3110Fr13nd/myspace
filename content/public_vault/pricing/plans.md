---
title: Pricing & Tiers
slug: pricing
category: pricing
summary: FOSS Workspace is free to self-host. Managed hosting tiers add team features, larger storage, and priority support.
tags: [pricing, plans, billing]
is_public: true
tier: public
---

# Pricing

FOSS Workspace is **free and open source**. Self-host it on your own infrastructure forever at zero cost.

## Managed Hosting Tiers

For teams who want a ready-to-go cloud experience:

| Plan | Price | What's included |
|:--|:--|:--|
| **Free** | $0/mo | 1 vault, 500 MB storage, public sharing |
| **Pro** | $12/mo | Unlimited vaults, 20 GB storage, tag-based sharing, PDF annotation |
| **Team** | $49/mo (5 seats) | Shared spaces, group permissions, entitlement bundles, audit log |
| **Enterprise** | Custom | SSO, SLA, custom data residency, dedicated support |

## How Entitlements Work

Payments unlock **entitlements** — scoped access tokens that grant access to:

- A specific **vault** (e.g. "user X's research vault — Pro access")
- A **tag bundle** (e.g. "all notes tagged #pro-course")
- A **space** (e.g. "shared team workspace")

When payment succeeds, the billing webhook calls:
```http
POST /api/v1/permissions/grant
{
  "resource": "entitlement:pro-tier",
  "principal": "user:alice",
  "role": "subscriber",
  "action": "grant"
}
```

When subscription lapses, the reverse call revokes access immediately.

## Self-Hosted

No license keys. No phone-home. Clone, deploy, own your data.
[GitHub →](https://github.com)
