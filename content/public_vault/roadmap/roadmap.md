---
title: Roadmap
slug: roadmap
category: roadmap
summary: Upcoming features and priorities for FOSS Workspace.
tags: [roadmap, future, features]
is_public: true
tier: public
---

# Roadmap

## Now (Shipped)

- ✅ Vault auto-discovery and sync (YAML frontmatter → DB + OpenFGA)
- ✅ Three-anchor composable permission model (folders + tags + direct grants)
- ✅ Tag-scoped namespaces (user, vault, folder, system)
- ✅ Explicit deny override for all permission layers
- ✅ PDF annotation with per-page permissions
- ✅ Canvas with embedded resource permission double-check
- ✅ OpenFGA 1.1 authorization model with entitlement type

## Next (In Progress)

- 🔄 Public product vault (`content/public_vault/`) as system-level shared knowledge
- 🔄 Billing webhook integration (Stripe/Polar) → automatic entitlement grants
- 🔄 Middleware: resolve tags from DB and pass to `checkMultiAnchorAccess`
- 🔄 Admin UI: tag permission management panel

## Later

- 💡 Entitlement bundles: sell access to curated tag collections
- 💡 Group-level tag grants (e.g. "all Pro users can view #pro-content")
- 💡 Tag-based RSS / public feeds
- 💡 Public vault embeds (embed a tagged subset of your vault in any website)
- 💡 AI-assisted tag suggestion from document content
- 💡 Inter-vault collaboration (cross-user tag sharing agreements)
