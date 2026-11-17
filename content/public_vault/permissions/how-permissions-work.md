---
title: Permissions Deep Dive
slug: permissions-deep-dive
category: permissions
summary: How the three-anchor composable permission model works — folders, tags, and direct grants evaluated simultaneously.
tags: [permissions, access-control, architecture]
is_public: true
tier: public
---

# Permissions Deep Dive

FOSS Workspace uses [OpenFGA](https://openfga.dev) for relationship-based access control (ReBAC). Every resource is a node in the authorization graph.

## Three Permission Anchors

Access to a resource is the **union** of these three anchors, with explicit denies always overriding:

### 1. Folder Hierarchy

When you grant `viewer` on a `folder`, every document, blog, PDF, canvas, or media file inside that folder (and all subfolders) inherits the grant.

```
folder:research → viewer: user:alice
  └── document:paper-1   ← alice can view
  └── folder:drafts
        └── document:draft-2  ← alice can view (nested)
```

### 2. Tags (Lateral Access)

Tags are first-class permission anchors scoped to prevent collisions:

| Scope | Tag ID format | Example |
|:--|:--|:--|
| User | `tag:user_<userId>:<name>` | `tag:user_demo:ml` |
| Vault | `tag:vault_<spaceId>:<name>` | `tag:vault_research:public` |
| Folder | `tag:folder_<folderId>:<name>` | `tag:folder_drafts:internal` |
| System | `tag:system_system:<name>` | `tag:system_system:public-blog` |

Granting `viewer` on a tag to `user:alice` means alice can view **every resource carrying that tag** — regardless of folder location.

### 3. Direct Resource Grants

Grant directly on any resource:
```
user:alice viewer document:my-private-doc
```

### Explicit Denies

Deny trumps all. Add `denied_viewer` to explicitly block even if folder or tag says allow.

## Access Resolution Algorithm

```
if denied_viewer on resource → DENY
else if viewer via direct/folder/tag grant → ALLOW
else → DENY
```

## API Example

```http
POST /api/v1/permissions/grant
{
  "resource": "tag:user_demo:reinforcement-learning",
  "principal": "user:alice",
  "role": "viewer",
  "effect": "allow"
}
```

This single call makes every note Demo has tagged `#reinforcement-learning` visible to DUMMY_NAME.
