# Access Control Architecture — Hardening, Hierarchical Permissions & Sharing UX

**Status:** 🔴 P0 security (verified live exploit) · 🟠 P1 architecture · 🟡 P2 UX parity
**Category:** `core-architecture` — governs all authorization. Nothing here is optional.
**Supersedes:** the previous draft of this document.

---

## 0. Direct answer to the question asked

> *"it's not leaking my permissions to shared user right. cuz that'd be not good."*

**It is leaking. And the leak is not the serious part.** I verified four distinct vulnerabilities against the running stack. One of them is an **unauthenticated remote privilege escalation** — I used it to write a live ACL tuple granting myself access to `canvas:my-canvas`, then removed it. Details and evidence in §1.

| # | Vulnerability | Severity | Verified |
|---|:---|:---|:---|
| **V1** | **`x-user-id` header trusted from any caller** → impersonate any user, including owners | 🔴 **Critical** | ✅ Exploited |
| **V2** | `POST /api/v1/permissions/check` has **no authentication** → free ReBAC oracle for any (user, relation, object) | 🔴 **Critical** | ✅ 200 OK anonymously |
| **V3** | `GET /api/v1/permissions/resource` has **no authentication** → full ACL disclosure | 🔴 **Critical** | ✅ 200 OK anonymously |
| **V4** | `/admin/permissions` ships the **entire tuple set into the SSR HTML** to any logged-in user | 🔴 **Critical** | ✅ Code path unambiguous |

Plus two fail-open correctness bugs:

| # | Bug | Severity |
|---|:---|:---|
| **V5** | **`user:admin` was a hardcoded bypass in two places** — self-claimable at registration, granting workspace-wide edit and unfiltered search over private + draft documents | 🔴 **Critical** | ✅ Exploited |
| **B1** | `denied_viewer` is declared on 11 types but **referenced in zero `viewer` unions** — it does nothing. Any "restrict" UI built on it **silently fails open** | 🔴 High |
| **B2** | `commenter` is offered in every role dropdown but **is not in the model** — every such grant is rejected | 🟠 Medium |

And the reason you couldn't see your own shares:

| # | Bug | Severity |
|---|:---|:---|
| **B3** | `fgaClient.read()` is called **unpaginated and unfiltered** in 3 places → returns the first **50 of 3,253** tuples. The Share modal is empty and the troubleshooter lies | 🔴 High |

> **The critical ordering consequence:** the empty Share modal is a *side effect* of the leak being masked. **Fixing B3 before fixing V3 would convert a cosmetic bug into a full ACL disclosure to the internet.** Security first, then correctness. My previous draft had this backwards.

---

## 1. Security findings (verified against the live stack)

All reproduced against `workspace_app` on the running containers. Store `01M2R8CPFP9THCTZ2NHBCXEKWK`, model `01M2RHTDKD4AZPVZJX8X65VWPV`.

### V1 — Unauthenticated impersonation via `x-user-id` 🔴

`src/middleware.ts:196-202`:

```ts
} else {
  const serviceUser = context.request.headers.get('x-user-id');
  if (serviceUser) {
    currentUser = serviceUser;      // ← trusted from ANY caller
    authType = 'service';
  }
}
```

The comment says `// Priority C: x-user-id service header (Internal)`. **There is no check that the request is internal.** Any client can become any user.

**Proof — privilege escalation, executed and reverted:**

```
POST /api/v1/permissions/grant
  headers: { x-user-id: "user:dummy_mail" }
  body:    { resource: "canvas:my-canvas", principal: "user:dummy_mail", role: "viewer" }

→ 200 {"success":true,"granted":{"principal":"user:dummy_mail",...}}

tuples now on canvas:my-canvas:
  folder:user_demo_root [parent_folder]
  user:dummy_mail [owner]
  user:dummy_mail [editor]
  user:dummy_mail [viewer]        ← written by an anonymous client
```

Reverted immediately via the same path; `canvas:my-canvas` is back to its original 3 tuples. **No other state was modified.**

### V2 — Unauthenticated ReBAC oracle 🔴

`src/pages/api/v1/permissions/check.ts:4` — `export const POST: APIRoute = async ({ request }) => {` with **no `locals` parameter and no auth check**. Middleware only protects `/api/v1/assets/*`, `/admin`, `/settings`.

```
POST /api/v1/permissions/check   (no credentials)
{"user":"user:dummy_mail","action":"owner","resource":"space:main"}
→ 200 {"allowed":false,"user":"...","action":"owner","resource":"space:main",...}
```

The `user` and `resource` parameters are **fully attacker-controlled**. This is an oracle over the entire authorization graph, unthrottled and unaudited.

### V3 — Unauthenticated ACL read 🔴

`src/pages/api/v1/permissions/resource.ts:6` — no auth check. Returns `directTuples`, `inheritedTuples`, `isPublic`, `isOwner`, `currentUser`.

It currently returns empty tuple arrays **only because of B3**. Two further defects in the same handler:
- Bare-slug lookup misses: `WHERE id = 'my-canvas'` does not match the row `canvas:my-canvas`, so it returns `fgaObjectId: "my-canvas"`, `owner_id: null`, and `type: "document"` — a fabricated resource. (`grant.ts:61-66` has the correct `LIKE '%:' || $1` fallback; `resource.ts` and `troubleshoot.ts` do not.)
- `isOwner` is computed from the broken read, so it is `false` for ~99% of resources. Any authz gate built on it would lock everyone out.

### V4 — Full permission graph serialized into SSR HTML 🔴

`src/pages/admin/permissions.astro:40-63`:

```astro
const res = await fgaClient.read();      // ← no auth, no pagination
liveTuples = raw.map(...)                // entire tuple set
---
<IamStudio client:load initialTuples={liveTuples} ... />
```

`isAdmin` is computed at line 21 but gates **only** `allResources` (line 31). `liveTuples` is fetched unconditionally and hydrated into the browser. Middleware redirects only `user:anonymous`. Therefore **any logged-in user** can view-source `/admin/permissions` and read the whole authorization graph.

Also at line 60: `style="max-width: 1300px; margin: 0 auto; padding: 1.5rem;"` — a hardcoded inline layout style, violating `AGENTS.md` § Design System.

### V5 — `user:admin` was a guessable superuser 🔴

Found while explaining the `is_public` caveat, not during the original audit.

Two call sites granted capability by comparing a user id to a literal:

- `src/lib/permissions.ts:64` — `if (currentUser === 'user:admin') return true;`
  inside `canUserEditResource`, **before** the ReBAC evaluation.
- `src/pages/api/v1/search.ts:156` — the same comparison set the Meilisearch
  filter to `undefined`, returning every indexed document.

`userId` is derived from the email local part at registration
(`src/pages/api/v1/auth/register.ts`: `` `user:${email.split('@')[0]}` ``), and
registration is open. So the "superuser" was not an account — it was a string
anyone could sign up for.

**Proof (executed, then reverted):**

```
POST /api/v1/auth/register  { email: "dummy_mail", ... }
→ 201 { "userId": "user:admin" }

PUT /api/v1/resources/canvas/canvas:my-canvas   (owned by another user)
→ 200 { "success": true, "message": "Canvas saved successfully" }

FGA check(user:admin, editor, canvas:my-canvas) → false      ← graph said no
```

The write **overwrote the owner's canvas** with empty data. Restored from git
(`git checkout -- content/public_vault/canvas/my-canvas.canvas`, 2 nodes /
1 edge) and the Postgres `metadata.canvasData` mirror resynced; the test account,
its tuples, its resources, and its audit rows were deleted.

Two aggravating factors:

- The unauthorized write left **no audit row**. `writeAudit` is called by the
  permission endpoints but not by content mutations, so an intrusion through this
  path was invisible to the audit trail.
- `search.ts:164` builds a Meilisearch filter by escaping `'` as `\'` and
  interpolating the user id. That is not a safe escaping strategy for a filter
  language and deserves its own audit.

**Fix:** both comparisons now call `isWorkspaceAdmin()`, which resolves
`manage_grants` over `space:main` — the same OpenFGA root of trust as everything
else, and not derivable from an email address. Registration additionally refuses
a set of reserved ids so no account can *look* like an administrator.
`tests/unit/acl-source-guards.spec.ts` now walks `src/` and fails if any file
compares a user id to a privileged literal.

### B1 — `denied_viewer` is a no-op (fail-open) 🔴

Declared at `authz/model.fga:25, 33, 41, 55, 62, 76, 84, 98, 106, 114, 135` (11 types). Referenced in **zero** `viewer` unions. E.g. `model.fga:48`:

```
relation viewer: [user, group#member, service_account] or editor or viewer from parent_folder
```

A `denied_viewer` tuple therefore changes nothing. Shipping a "block access" UI against this model ships a **silent security hole**. This is the same class of bug as B2 and it will recur — hence the permanent guard test in §9.

### B2 — `commenter` does not exist 🔴→🟠

`model.fga` defines no `commenter` on any type. It is offered at `GcpStylePermissionManager.tsx:561`, defined in `SYSTEM_ROLES` (`types.ts:62-70`), and probed in the `effectiveRole` ladder (`troubleshoot.ts:162`) where the resulting 400 is swallowed by `catch {}` — so it can never be a result, yet is always selectable. `downloader` (`types.ts:25`) is likewise unused.

---

## 2. Competitive analysis — what to take, what to reject

Full research is in the session log. The decision-relevant conclusions:

### The three systems disagree on the fundamental invariant

| System | Propagation | Invariant | Narrowing mechanism |
|---|---|---|---|
| **Confluence** | parent → child | **∩ intersect** — "A content item cannot have greater access than its container" | Native page restrictions (the whole point) |
| **Google Drive** | parent → child | **∪ union** — "A file inside a shared folder has the same or higher sharing permissions as the folder" | "Limited access" — **folders only, system-applied, irreversibly lost** |
| **Notion** | parent → child | **∪ union**, no deny at all | Shadowing — you lose the parent's rules entirely |

**None of the three lets a child be narrower than its parent while keeping the parent's other grants.** Confluence can't widen; Drive and Notion can't narrow. Both directions are load-bearing for a real product, and both products handle the missing half badly.

> [[../temp/perms/confluence/perms.md]] and [[../temp/perms/notion/perms.md]]


### The single most important finding

Notion has the complete grant graph and **refuses to show it to the person editing**:

> The *only* provenance string in Notion's entire sharing UI is about **you** — *"You have full access to this page via Marketing"* — not about other people. You cannot see *"Anna gets Can view via the parent page."* Inherited and direct grants are visually identical rows. There is no effective-access count.

Confluence's `People who can view` and DC `Inspect permissions` are the artifacts worth copying — provenance explanations like *"The user, or a group they're a member of, are not listed in the page restrictions dialog, so they have 'no access.'"*

**This is precisely the gap you hit, and it is the differentiator.** The product to build is the one that shows the effective access graph with per-row provenance, and that supports real narrowing without Drive's dead ends.

### Steal verbatim

| Pattern | Source | Why |
|---|---|---|
| **Two-axis split**: named-principal rows × one exclusive **General access** audience slot, each with its own role | Notion | Most legible part of their model; composes additively |
| `Full access` is defined **only** as "can also share" | Notion | The one bit of real semantics in their ladder. `Can edit` vs `Full access` is the distinction both Confluence and Drive muddy |
| **4-value audience enum** — `Private` / `Shared internally` / `Shared externally` / `Public link`, "most permissive wins" | Notion admin content search | Cheap, high-signal, what security teams actually ask for |
| **"Can access detailed file permissions" is a separate capability from read** — `owner/organizer/writer` yes, `commenter/reader` **no** | Drive v3 role matrix | The correct ACL-read gate. Notion and Confluence both leak this to viewers |
| **Provenance explanations**, not booleans | Confluence `Inspect permissions` | Engine-native via `expand()` |
| **"People who can view"** effective-ACL view | Confluence DC | Closest existing analogue to a ReBAC `listUsers` |
| Monotone **ceiling**: containers can only tighten, never loosen past the workspace setting | Notion teamspace security | Prevents a sub-admin from widening org policy |
| **Request-access routing**: owner → creator → last editor → space admin | Confluence | Implementable deterministically with `check()` |
| **Non-existence signalling**: 404-shaped when the container is invisible, 403-shaped when the item is restricted; strip the container key from URLs | Confluence | Prevents enumeration of what exists |

### Reject explicitly

| Anti-pattern | Source | Why we reject it |
|---|---|---|
| Deny that **loses** to a direct grant with no warning | Drive "Access removed" | Produces "I removed Anna and she still has access" — unacceptable |
| No deny at all; "restrict" = shadow | Notion | Loses the parent's entire rule set as a side effect |
| Edit does **not** inherit view's restriction | Confluence (CONFSERVER-5095, unfixed) | Almost certainly not what users expect |
| Silently fails open on copy / re-type / move | Confluence (copy, page→blog), Drive (move = simultaneous gain + loss) | Must be previewable and fail-closed |
| Inherited and direct rows visually identical | Notion | The core complaint |
| No impact preview on revocation, no notification to affected users | Notion, Confluence | Highest-value cheap fix in the industry |
| Two independent public surfaces with confusing names; unpublishing one leaves the other open | Notion (`Anyone with link` vs `Publish`) | Design one surface with unambiguous names |
| Contributor names + emails in public page metadata | Notion | Explicit PII leak |
| `Restricted` meaning four different things | Notion | One word, one meaning |
| Fully-expanded group members in the ACL view | Confluence | Leaks org structure; show group name + count instead |
| Admin can silently self-grant on any page | Notion Enterprise, Confluence admin key | Make it explicit, banner-announced, time-boxed, and **notify the owner** |
| Filters/sorts presented as if they were access control | Notion | Never let a UI imply a security boundary it isn't |

---

## 3. Target architecture — three planes

The root design error in the current codebase is that **the UI re-derives authorization state from raw tuples, and does it four different ways**. That is precisely why the troubleshooter's verdict is right while its explanation is wrong, and why the Share modal is empty.

Three concerns are conflated today and must be separated:

```
┌─────────────────────────────────────────────────────────────────┐
│ PLANE 3 — PROJECTION (derived, Postgres, read-optimized)        │
│   resource_effective_acl  ·  provenance · audience enum          │
│   Feeds: Share dialog · Troubleshooter · Shared-By-Me · counts  │
│   ⚠ A CACHE. Never an authorization input.                      │
└───────────────────────────▲─────────────────────────────────────┘
                            │ projector: readChanges() + full reconcile
┌───────────────────────────┴─────────────────────────────────────┐
│ PLANE 2 — AUTHORIZATION (OpenFGA ReBAC, AUTHORITATIVE)         │
│   Every allow/deny decision. Custom relations, groups, tags,   │
│   service accounts, API scopes, temporal grants, what-if.       │
└───────────────────────────▲─────────────────────────────────────┘
                            │ compile (projector is the ONLY writer)
┌───────────────────────────┴─────────────────────────────────────┐
│ PLANE 1 — DECLARATIVE GRANTS (Postgres, human-authored intent)  │
│   resource_grants · resource_audience · break_inheritance       │
│   The Share dialog reads & writes THIS, never raw tuples.      │
└─────────────────────────────────────────────────────────────────┘
```

### Which plane is authoritative?

**Plane 2 (OpenFGA) is the source of truth. Plane 1 is a durable, queryable projection of human intent, and Plane 3 is a rebuildable cache.**

Reasoning, and this reverses my earlier draft:

- FGA is *already* authoritative — 3,253 tuples, and 15+ seed/registration scripts (`grant_superadmin.ts`, `init-openfga.ts`, `register_*.ts`, `seed_*.py`, `generate_*.py`) write it directly.
- The reverse (Postgres → compile → FGA) would require migrating 3,253 tuples **and** rewriting 15+ scripts, in the same change as a security fix. Unacceptable risk.
- OpenFGA exposes **`readChanges()`** — a monotonic ULID change feed. That is a purpose-built incremental-projection primitive, and it makes Plane 3 cheap and exactly-consistent-by-construction.

Consequence: the projector may be briefly behind. **That is the safe direction** (enforcement is fail-closed, only the display lags) and the UI must say so. Confluence has this same staleness and does not admit it; we will.

---

## 4. The permission model

### 4.1 One lattice, derived capabilities

`commenter` is a **first-class rung** in Drive v3 and Notion. Drive v2 modelled it as `additionalRoles[]` and it was awkward; v3 promoted it to a primary role. Do it right the first time:

```
owner  >  editor  >  commenter  >  viewer  >  none
```

**Capabilities are derived from the rung, never stored.** One table, one source of truth:

| Capability | viewer | commenter | editor | owner |
|---|:-:|:-:|:-:|:-:|
| `read_content` | ✅ | ✅ | ✅ | ✅ |
| `read_acl` | ❌ | ❌ | ✅ | ✅ |
| `create_comment` | ❌ | ✅ | ✅ | ✅ |
| `write_content` | ❌ | ❌ | ✅ | ✅ |
| `manage_grants` | ❌ | ❌ | ❌ | ✅ |
| `delete_resource` | ❌ | ❌ | ❌ | ✅ |
| `manage_settings` | ❌ | ❌ | ❌ | ✅ |

`read_acl` and `manage_grants` are **distinct relations in `authz/model.fga`**, not a UI affordment. This is Drive's "Can access detailed file permissions" row, promoted to a first-class primitive. It is the single most important security control in this plan.

- `editor` = "can edit, **cannot** share" (Notion's `Can edit`)
- `owner` = "can edit **and** share" (Notion's `Full access`)

`commenter` is **not added to the model yet** — nothing enforces comments. But because the lattice is derived from `ModelIndex`, adding it later is a model deploy plus **zero code changes**.

### 4.2 Inheritance: compute live, narrow explicitly

Confluence and Drive disagree and both are wrong in the same way — one has no widening, the other has no narrowing. Our contract, stated explicitly:

**Resolution — widest wins (Notion/Drive ∪):**
```
effective_role(principal, resource) = max(rung) over ALL grant paths reaching them
```
Computed **live** via the `parent_folder` / `parent_space` tuples already in the model. Never materialized onto children. This is structurally fail-closed — Confluence's `CONFANCESTORS` cache desync produces a documented **fail-open**, and live computation makes that class of bug impossible.

**Narrowing — an explicit deny, applied in the guard layer:**
```
allow  ⟺  principal ∉ deny_set(object) AND ∃ positive path
deny beats EVERY grant path, without exception
```
> **As-built correction.** This was originally specified as model-level negation
> (`viewer: (...) and not denied_viewer`). That is **not expressible on the
> pinned engine**: OpenFGA v1.5's JSON model API rejects every `exclusion`
> userset shape with `invalid userset rewrite definition`, while `union` and
> `intersection` validate normally. Verified by bisection against the running
> server across base/child combinations, both schemas, and assignable/non-
> assignable variants. Attempting it anyway is the dangerous path — a model that
> refuses to deploy, or worse, deploys with the exclusion silently dropped.
>
> Denial is therefore an explicit `check()` in `src/lib/acl/guards.ts`, which is
> the single enforcement chokepoint. `denied_viewer` / `denied_editor` remain
> ordinary assignable relations, so the engine still owns the decision.
> `compileModel()` **throws** if `RelationSpec.not` is used, so nobody
> reintroduces the broken construct.

**Deny beats a direct grant too.** This is stricter than Google Drive, whose
"Access removed" list loses to any direct grant — which is how Drive produces
"I removed Anna and she still has access". Instead of shipping that state, the
contradictory combination is made **uncreatable**: `preflightGrant()` refuses to
write a deny against a subject holding a direct grant and names the grant to
remove first.

**Deny precedence is cumulative down the ladder.** A subject blocked from
*viewing* must not retain *write* access. Checking only the deny matching the
requested relation exactly let `denied_viewer` pass straight through an `editor`
check — write without read, a fail-open. Found by
`tests/unit/acl-guards.spec.ts`; fixed via `denyBlocks()`:

| Requested | Blocked by |
|---|---|
| `viewer`, `read_acl`, `manage_grants` | `denied_viewer` |
| `editor`, `owner` | `denied_viewer`, `denied_editor` |

**Precedence, highest first:**
```
1. General access / audience grant   (public link, workspace)
2. Direct grant on this object
3. Group / team membership
4. Inherited grant (parent_folder / parent_space chain)
   ── deny_set consulted against 4 only ──
5. Deny (explicit "Blocked here")
```

**Invariants we adopt and Confluence/Drive do not:**
- **Edit inherits** (fixes CONFSERVER-5095).
- **Move / copy / re-type re-evaluate** inherited access and emit a **previewable diff** — `gained[]` and `lost[]` — before committing. Drive's move is a simultaneous escalation and revocation with no preview.
- **Monotone ceiling**: a `space` can only tighten relative to the workspace, never loosen. (Notion teamspace security, done as an actual model constraint.)
- **Last-shareholder guard**: the final `manage_grants` principal on an object cannot be removed. (Notion has this rule; it is correct.)
- **Container cycles are impossible** — `resources_parent_id_fkey` prevents them in Postgres and `parent_folder` is only ever written on create/move.

### 4.3 Root of trust

`resources.owner_id` is the immutable root. The `owner` FGA tuple is **derived from it**, which breaks the circularity of "who can edit the ACL that grants ownership". Required because `read_acl` is gated at `editor`+ — without a root outside ReBAC, a resource with a lost ACL tuple becomes unmanageable.

Live `resources` also has **no `owner_id` index** and returned `owner_id: null` on the bare-slug path, so §5 includes a repair pass for orphaned rows.

---

## 5. Data model

### 5.1 Plane 1 — declarative grants

```sql
-- Explicit, human-authored grants. Durable intent, survives projection rebuilds.
CREATE TABLE resource_grants (
  id             BIGSERIAL PRIMARY KEY,
  resource_id    VARCHAR(512) NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  subject_type   VARCHAR(16)  NOT NULL,   -- user | group | service_account | audience
  subject_id     VARCHAR(256) NOT NULL,   -- user:dummy_mail | group:eng | audience:workspace
  rung           VARCHAR(16)  NOT NULL,   -- viewer | commenter | editor | owner
  source         VARCHAR(16)  NOT NULL DEFAULT 'direct',  -- direct | deny
  granted_by     VARCHAR(256),
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at     TIMESTAMPTZ,             -- soft revoke = grant history
  UNIQUE (resource_id, subject_type, subject_id, rung, source)
);
CREATE INDEX idx_grants_subject  ON resource_grants (subject_type, subject_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_grants_resource ON resource_grants (resource_id) WHERE revoked_at IS NULL;

-- The Notion "General access" slot: exactly one row per resource.
CREATE TABLE resource_audience (
  resource_id  VARCHAR(512) PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  audience     VARCHAR(16) NOT NULL,  -- restricted | workspace | public_link
  rung         VARCHAR(16),           -- NULL when audience = restricted
  expires_at   TIMESTAMPTZ
);

-- Explicit inheritance break, with a reversible inverse.
ALTER TABLE resources ADD COLUMN acl_inheritance TEXT NOT NULL DEFAULT 'inherit'
  CHECK (acl_inheritance IN ('inherit', 'restricted'));
```

### 5.2 Plane 3 — projection

```sql
-- Grant graph with provenance. Groups are NOT expanded into members.
CREATE TABLE resource_effective_acl (
  resource_id      VARCHAR(512) NOT NULL,
  subject_type     VARCHAR(16)  NOT NULL,
  subject_id       VARCHAR(256) NOT NULL,
  rung             VARCHAR(16)  NOT NULL,
  source           VARCHAR(16)  NOT NULL,  -- direct | group | inherited | audience | deny
  source_resource  VARCHAR(512),           -- the ancestor that granted it
  via_relation     VARCHAR(32),            -- parent_folder | parent_space
  depth            SMALLINT NOT NULL DEFAULT 0,
  projected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (resource_id, subject_type, subject_id, rung, source)
);
CREATE INDEX idx_eacl_subject  ON resource_effective_acl (subject_type, subject_id);
CREATE INDEX idx_eacl_resource ON resource_effective_acl (resource_id);
CREATE INDEX idx_eacl_owner_out ON resource_effective_acl (subject_type, subject_id, rung)
  WHERE source = 'direct';   -- powers "Shared by me"
```

**Groups are deliberately not expanded.** Expansion is O(groups × members × resources) and it **leaks org structure** — Confluence's "People who can view" lists every member of every group, which tells an insider who reports to whom. We render `Platform team · 14 members` and expand individuals only for groups the viewer may already see.

**`Shared by me`** — the outbound view — is `WHERE source='direct' AND subject_id = <me>`, i.e. resources where I hold a grant. Notion has this only on Enterprise; Drive v3 has **no `sharedByMe` search term at all** (Microsoft Graph does). It is a genuine differentiator and a direct answer to the original request.

### 5.3 Migrations

Next in sequence is `migrations/0006_access_control.{up,down}.sql`, plus:

```sql
ALTER TABLE resources ADD COLUMN IF NOT EXISTS owner_id_fixed VARCHAR(512);
CREATE INDEX IF NOT EXISTS idx_resources_owner ON resources (owner_id);
```

**Must be mirrored into both schema sources.** The repo carries two competing definitions and the live DB is the `docker/postgres/init.sql` variant, which lacks `content` and `idx_resources_owner`. See `plan/features/folder-view.md` §1.1.

Plus a **repair pass**: backfill `owner_id` where NULL/orphaned, and flag every `resources` row with no `owner` tuple.

---

## 6. API surface — authorization per endpoint

**This table is the security contract.** Every row is enforced in a shared guard; none is enforced ad hoc in a handler.

| Endpoint | Auth | Relation required | Returns |
|---|---|---|---|
| `POST /permissions/check` | 🔴 **currently none** | self only | own allow/deny. Arbitrary subjects require `read_acl` + audit |
| `GET /permissions/resource` | 🔴 **currently none** | `read_acl` | ACL + provenance. **403 for viewer/commenter** |
| `POST /permissions/grant` | 🔴 any user | `manage_grants` on target | 403 otherwise |
| `POST /permissions/revoke` | 🔴 any user | `manage_grants` on target | + last-shareholder guard |
| `GET /permissions/troubleshoot` | 🔴 any user | `read_acl` on target | engine provenance |
| `POST /permissions/simulate` | **new** | `manage_grants` | what-if, `contextualTuples`, **zero writes** |
| `GET /permissions/shared-by-me` | **new** | self only | outbound grants |
| `GET /permissions/effective?resource=` | **new** | `read_acl` | the effective-ACL view |
| `POST /permissions/reparent` | **new** | `manage_grants` | `dryRun` → `{gained, lost}` |

### 6.1 Non-existence signalling

Adopt Confluence's contract, which most systems get wrong:

| Caller state | Response |
|---|---|
| No `read_acl` **and** cannot see the resource | **404**, container key stripped from any echoed identifier |
| Can see the container, not the item | **403** with a `request_access` affordance |
| Can `read_acl` | Full ACL |

Restricted resources must be filtered from **search, the tree, and breadcrumb components** — not just the nav. Confluence documents macros as a leak vector people forget.

### 6.2 The troubleshooter must stop being an oracle

Even correctly gated, an arbitrary-principal probe is a **membership oracle**: an owner asking "does intern@x have access" learns whether that person exists in the workspace. Mitigations:

- Principal autocomplete is restricted to **self + principals already in this object's ACL** + workspace members **only** for `owner` callers.
- The **object** must be one the caller can `read_acl`; otherwise 404.
- Rate-limit per `(actor, subject, object)` via the existing `src/lib/rateLimit.ts`.
- Audit every probe with a distinct `permission.probe` event.
- Never reveal whether the resource *exists* to a caller who cannot see it.

### 6.3 `x-user-id` must die

Options, in order of preference:
1. **Delete it.** If no internal caller needs it, remove the branch.
2. Bind it to a shared secret header (`X-Internal-Token`, constant-time compared against `INTERNAL_SERVICE_TOKEN`) **and** require the request to originate from the internal network.
3. As an absolute floor: reject it when `config.isProd`.

Whichever is chosen, add a regression test asserting `x-user-id: <owner>` cannot escalate in any environment.

---

## 7. UX specification

### 7.1 The role ladder in the UI

Derive options from `ModelIndex.relationsByType[type]` intersected with the capability table. `commenter` disappears automatically because the model lacks it. **No hardcoded role array anywhere** — `SYSTEM_ROLES` becomes derived.

### 7.2 Share dialog

```
┌─ Share ─────────────────────────────────────────────────────────┐
│ [ search people or groups…                    ▾ role ] [Invite] │
│                                                                  │
│ YOUR ACCESS                                                      │
│  👤 You have Full access · via folder "Demo's Vault"            │  provenance for you
│                                                                  │
│ PEOPLE WITH ACCESS                                  4 · 2 groups │  ← the count Notion lacks
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 👤 dummy_mail          Can edit    Direct          ⋯  ✕     │  │  Direct = solid row
│  │ 👥 Platform team      Can view    Inherited ▸     ⋯  ✕     │  │  Inherited = ghosted + source
│  │ 🌐 Anyone with link   Can view    General access   ⋯  ✕    │  │
│  │ ⛔ dummy_mail          No access   Blocked here     ↺        │  │  explicit deny, reversible
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ GENERAL ACCESS                                                   │
│  (•) Only people added                                            │
│  ( ) Everyone in the workspace              [ Can view  ▾ ]       │
│  ( ) Anyone with the link                  [ Can view  ▾ ] ⏱    │
│                                                                  │
│ ⚠ Restricted — differs from "Research".  [ Restore inheritance ] │
│ [ Copy link ]                            [ Advanced ▾ ]           │
└──────────────────────────────────────────────────────────────────┘
```

**Beating Notion, concretely:**

| Fix | Notion's behaviour | Ours |
|---|---|---|
| Inherited rows | identical to direct, no badge | ghosted + `Inherited ▸` expands to the source path |
| Provenance | only for **you** | **per row**, for everyone |
| Total exposure | none | `4 people · 2 groups` + audience badge |
| Narrowing | shadowing, loses parent rules | `Blocked here` row + `↺` to restore |
| Revocation | silent | **impact-preview modal**: *"Removes access for 2 people. 3 subpages keep their own grants."* |
| Affected users | never notified | `Removed by {actor} · {date}` notification |
| `Full access` | can share | maps to `manage_grants`; `Can edit` cannot share |

**Audience badge** on every resource, Notion's 4-value enum with "most permissive wins":

```
Private · Shared internally · Shared externally · Public link
```

One surface, unambiguous names. Notion has two public surfaces (`Anyone with link` vs `Publish`) and documents the trap where unpublishing one leaves the other open; we have one.

### 7.3 Shared by me

A first-class outbound view — the thing you asked for and that neither Notion (Enterprise-only) or Drive (no API) offers to ordinary users.

```
┌─ Shared by me ──────────────────────────── 12 resources · 31 grants ─┐
│ [ type ▾ ] [ role ▾ ] [ search… ]                                     │
│                                                                      │
│ 📄 Research Plan                          Private · my role: Owner   │
│    👤 dummy_mail Editor   👥 Platform Can view   ⛔ ben Blocked  [⋯]    │
│                                                                      │
│ 🎨 Moodboard                             Public link · my role: Editor│
│    🌐 Anyone with link Can view                       [ Copy link ]  │
│                                                                      │
│ 🗂 Demo's Vault                          Inherited-only · not listed│
│    ↳ you have access via this folder — nothing to manage             │
└──────────────────────────────────────────────────────────────────────┘
```

Rows where you have access only by inheritance are shown but explicitly marked **"not listed — nothing to manage"**. This is the honest answer to "what did *I* share" and avoids the Drive trap where reshares and delegated grants silently vanish.

### 7.4 Troubleshooter — engine-native, not hand-rolled

`@openfga/sdk@0.9.7` already ships the two primitives this needs. **Use them instead of re-implementing ReBAC in JavaScript.**

| Purpose | Primitive |
|---|---|
| Why does subject S have (or lack) access? | **`fgaClient.expand()`** — engine-native provenance, the OpenFGA equivalent of Confluence's `Inspect permissions` |
| What if I grant/revoke X? | **`check({ contextualTuples })`** — real evaluation, **zero writes** |
| N principals at once | **`batchCheck()`** |
| Who can access this object? | **`listUsers()`**, backed by Plane 3 for provenance |

The current hand-rolled walk (`troubleshoot.ts:64-158`) is deleted. Every step is derived from engine output plus Plane 3, so **the explanation cannot disagree with the verdict** — the class of bug that produced your screenshot is structurally eliminated.

New: a real **Access Simulator** with a `dryRun` toggle, so "what if I make this public?" is answerable without writing a tuple.

### 7.5 Design system compliance

Per `AGENTS.md` and `docs/design-system.md`:
- All colour/spacing/elevation from `src/styles/global.css` tokens. No hex, no `rgba`, no inline `style={{}}` for layout — this also fixes the violation at `admin/permissions.astro:60`.
- Primitives from `src/components/ui/` (`Modal`, `Drawer`, `Button`, `Badge`, `Tabs`, `Stack`, `Flex`, `Select`, `Input`, `Toast`/`showToast`). No bespoke modal, dropdown, or badge.
- Resource type metadata exclusively from `src/lib/registry/resourceRegistry.ts`. No ad-hoc `TYPE_META`.
- Save / copy / error states routed to `showToast`.
- Verify with `npx tsc --noEmit` and `npx astro build`.

---

## 8. Sequencing

P0 ships in days and stands alone. No big-bang.

| Step | Deliverable | Gate |
|---|---|---|
| **0** | **Kill V1** — remove/gate `x-user-id`. Add the regression test | Blocks everything |
| **1** | **Fix B1** — enforce `denied_viewer` in `viewer` unions; add `denied_editor`. Deploy via `scripts/deploy-openfga-model.ts` behind assertions | Hard prerequisite for any restrict UI |
| **2** | **Kill V2/V3/V4** — auth guard on all 5 permissions endpoints; `/admin/permissions` requires `manage_grants`; stop shipping raw tuples to the client | |
| **3** | **Fix B3** — paginated reader | ⚠ **Only after step 2.** Fixing this first would expose the ACL |
| **4** | Migration `0006` + owner repair pass | |
| **5** | `src/lib/acl/` — `modelIndex`, `lattice`, `resolver`, `projector` | The modular core |
| **6** | `ModelIndex` + model-driven role options; remove `commenter`/`downloader` | |
| **7** | Projector: full reconcile on boot, then `readChanges` cursor | |
| **8** | **Revamp Share dialog** — provenance, audience slot, deny rows, impact preview | |
| **9** | `shared-by-me` API + UI | |
| **10** | Troubleshooter → `expand()`; add Access Simulator | |
| **11** | `effective` API; `reparent` with dry-run diff; access requests + notifications | |

Steps 1 and 2 are independent and can run in parallel. Nothing in 8–11 may ship before 1, 2, and 5.

---

## 9. Testing strategy

### Permanent regression guards (the valuable part)

These catch whole *classes* of bug, not just instances:

1. **Every declared relation must be referenced in ≥1 union.** Directly catches B1 (`denied_viewer` dead) and would have caught B2 at model-deploy time.
2. **No `writeTuple` / `deleteTuple` outside `src/lib/acl/`.** Prevents the projector-bypass class of drift.
3. **No permission endpoint may read tuples without an authorization guard.** A static check on the endpoint module.
4. **No `x-user-id` impersonation in any environment.** Live integration test.
5. **Explanation ⊆ verdict.** For every troubleshoot case, each emitted step must reference a tuple that actually exists in FGA. Directly kills the screenshot bug.
6. **No hardcoded role arrays.** UI role options must equal `ModelIndex ∩ capability table`.

### Unit
`readAllTuples` pagination, continuation termination, truncation flag, transport failure · `ModelIndex` validity · `resolver` for every precedence combination (audience > direct > group > inherited, with deny crossing only inherited) · `lattice` derivation · group non-expansion invariant.

### Integration
Seed >200 tuples; assert an object **not on page 1** is returned (regression guard for B3) · round-trip grant → read-back → revoke · projector consistency after a `move` · deny-beats-inherited and deny-loses-to-direct · last-shareholder guard.

### Browser
Share dialog on `canvas:my-canvas` shows 2 principals with roles and provenance · viewer sees **no** ACL (403) · inherited row expands to its source · impact preview shows correct affected count · deny then restore · Shared-By-Me lists outbound grants and revoke propagates · troubleshooter shows only real tuples · Access Simulator writes nothing.

### Manual
`npx tsc --noEmit` · `npx astro build` · stop the OpenFGA container and load the Share dialog → confirm a **loud error**, never a silent empty table (this is the exact failure that hid B3 for so long).

---

## 10. Flaws and risks in *this* plan

Self-critique, because the first draft had the security ordering backwards.

| # | Flaw | Assessment / mitigation |
|---|---|---|
| **F1** | **Plane 3 is eventually consistent** — a revocation may linger in the UI after it is enforced | Safe direction (fail-closed enforcement, lagging display). Must be **stated in the UI**; Confluence has this bug silently |
| **F2** | **Two write paths exist** (FGA direct from 15+ scripts, Plane 1 from the Share dialog) → drift | Accepted deliberately (§3). Mitigations: full reconcile on boot, `readChanges` cursor, and guard test #2 keeping *application* code single-writer. Scripts remain a known, documented exception |
| **F3** | **`read_acl` at `editor`+ creates a lockout risk** — revoke the last editor and nobody can see the ACL to fix it | Root of trust is `resources.owner_id` (§4.3), outside ReBAC, so recovery always exists. Plus the last-shareholder guard |
| **F4** | **`editor` semantics change** — today `editor` can effectively share (nothing stops it); after this change it cannot | **Behavioural change.** Existing `grant_superadmin.ts` grants owner+editor+viewer together, so the superadmin is unaffected. Any workflow relying on editor-shares must be audited before step 8 |
| **F5** | **The audience slot is a UX simplification that could surprise power users** who want two audiences with different roles | Notion's model, and it is the most legible part of theirs. Notion allows additive combination; we allow the same (audience + per-row grants compose). Documented |
| **F6** | **Group membership sync is a new write path** and can drift from `group_memberships` | Single writer in `src/lib/acl/`; reconcile job diffs Postgres groups against `group:X#member` tuples and alerts. Requires the backfill in step 7 |
| **F7** | **`resource_effective_acl` size** at 100k+ resources | Groups unexpanded (§5.2) keeps it O(grants), not O(grants × members). Bounded by grant count, not user count. Acceptable |
| **F8** | **Adding `denied_editor` + enforcing `denied_viewer` is a live model migration** on a store with 3,253 tuples | OpenFGA models are versioned and additive; roll back by re-pointing the store's model id. Must run behind assertions covering every case in §3.13 of the previous draft. Deploy in an isolated store first |
| **F9** | **Two competing Postgres schemas** (`migrations/` vs `docker/postgres/init.sql`) | Known and documented (`plan/features/folder-view.md` §1.1). Both must be updated or the live DB silently lacks the columns |
| **F10** | **Scope** — 11 steps is a lot | Steps 0–3 are days and ship the security fix. 5–7 are the modular core. 8–11 are incremental and independently valuable. No step requires a big-bang |
| **F11** | **The troubleshooter is a legitimately powerful tool** even when correctly gated | §6.2 constrains subject, object, rate, and audit. Re-evaluate after step 10 with real usage |
| **F12** | **`user:*` plus `read_acl`** — if a wildcard ever held `editor`, the internet could read every ACL | The capability table makes this explicit, and a startup assertion will verify that no wildcard principal holds a rung ≥ `editor` on any non-public resource. Cheap, permanent |

### Explicitly rejected alternatives

| Alternative | Why not |
|---|---|
| Fix pagination first, authz second | **This was the first draft's error.** Would have turned a masked bug into a live ACL disclosure |
| Postgres-authoritative, compile to FGA | Cleaner in the abstract, but requires migrating 3,253 tuples and rewriting 15+ scripts inside a security fix. Disproportionate risk now |
| OpenFGA `listObjects`/`listUsers` for "Shared by me" | Answers "what can X access", never "what did X grant". No outbound query exists — Drive v3 lacks one too |
| Drop `resources.owner_id` and make ReBAC fully self-referential | Circular: the ACL that grants `owner` would itself need `owner` to be readable |
| Copy Notion's shadowing model | Loses the parent's entire rule set. We can do real narrowing |
| Adopt Drive's "Access removed" precedence | Produces "I removed Anna and she still has access" |

---

## 11. File change inventory

### New — `src/lib/acl/`
| File | Responsibility |
|---|---|
| `modelIndex.ts` | `getAuthorizationModel()` (cached), `ModelIndex`, `isRelationValid()` |
| `lattice.ts` | `ROLE_LATTICE`, `CAPABILITIES`, `rungFor()`, `maxRung()` — the single role source |
| `reader.ts` | `readAllTuples()`, `readTuplesForObject()`, `readChangesCursor()` — paginated, truncation-aware |
| `projector.ts` | Sole writer to FGA and Plane 3; `reconcile()`, `applyGrant()`, `applyRevoke()` |
| `resolver.ts` | `resolveEffectiveAccess()` — one implementation for dialog, troubleshooter, counts, and the fast path |
| `guards.ts` | `requireReadAcl()`, `requireManageGrants()`, `visibilityResponse()` — the §6 contract in one place |
| `preflight.ts` | Revocation impact + reparent diff (`dryRun`) |

### Modified
| File | Change |
|---|---|
| `src/middleware.ts` | **Remove/gate `x-user-id`** (V1); dedupe the duplicated auth block (lines 205–215 vs 268–278) |
| `src/pages/api/v1/permissions/check.ts` | Auth; self-only unless `read_acl`; rate-limit; audit |
| `src/pages/api/v1/permissions/resource.ts` | Auth; paginated read; bare-slug fallback; `read_acl`; 404/403 split |
| `src/pages/api/v1/permissions/grant.ts` | `manage_grants`; `ModelIndex` validation → 400; go through `projector`; `circle:`→`group:` |
| `src/pages/api/v1/permissions/revoke.ts` | Same + last-shareholder guard + impact preview |
| `src/pages/api/v1/permissions/troubleshoot.ts` | **Delete** the hand-rolled walk; use `expand()` |
| `src/pages/admin/permissions.astro` | Require `manage_grants`; stop serialising tuples; remove the inline style |
| `src/components/iam/GcpStylePermissionManager.tsx` | `group:` not `circle:`; provenance rows; audience slot; deny rows; impact preview; `shared` tab |
| `src/components/iam/types.ts` | Delete `commenter`, `downloader`; add `GrantProvenance`, `EffectiveAccess` |
| `src/components/iam/CirclesTab.tsx` | Rebuild on `groups` / `group_memberships` |
| `src/components/ShareModal.tsx` | New Share dialog; optimistic rows; extract `copyShareLink` |
| `src/lib/registry/resourceRegistry.ts` | Register `google_sheet`, `canvas_node` for icon coverage |
| `authz/model.fga` | Enforce `denied_viewer`; add to `canvas`; add `denied_editor`; add `read_acl`/`manage_grants` |
| `migrations/0006_access_control.{up,down}.sql` | **New** |
| `migrations/0001`, `docker/postgres/init.sql` | Keep both schemas in sync |
| `plan/README.md` | Index entry + the "no silent partial reads" principle |

---

## 12. Out of scope

- A `circle` type in the FGA model — `group` + `group#member` is the model; the UI is the only thing saying `circle`.
- Inbound **"Shared with me"** — needs different reverse-lookup semantics from outbound grants. → `plan/future-roadmap/9-pending-tasks-feature-gaps.md`.
- Enforcing `commenter` — needs a comment feature. The lattice makes it a model-deploy away.
- Google Drive mirroring for `group:` grants (`grant.ts:100-120` mirrors only `user:*@*` addresses).
- Row-level / property-level security. Notion gates it to Business/Enterprise and it is a genuinely large feature.
- Migrating the OpenFGA datastore off Postgres.
- Enterprise plan gating, SCIM, and per-workspace member directories.

---

## 13. As-Built — what changed during implementation

Everything in §1–§4 is verified against the running stack. This section records
where reality diverged from the plan, because each divergence is a trap for the
next person.

### 13.1 Delivered

| Area | Status |
|---|---|
| **V1** `x-user-id` impersonation | **Closed.** Requires `INTERNAL_SERVICE_TOKEN`, compared with `crypto.timingSafeEqual`. Rejected with a warning log when unset. Verified: exploit now returns 401 |
| **V2** anonymous ReBAC oracle | **Closed.** `check.ts` requires auth; non-self probes need `read_acl`, are rate limited (30/min per triple) and audited as `permission.probe` |
| **V3** anonymous ACL read | **Closed.** `resource.ts` gated on `read_acl`; 404-vs-403 so object existence is not confirmable |
| **V4** tuple dump into SSR HTML | **Closed.** `/admin/permissions` requires `manage_grants` and ships no tuples; the studio fetches from the new gated `all-tuples.ts` |
| **V5** `user:admin` guessable superuser | **Closed.** Both literal comparisons replaced by `isWorkspaceAdmin()` (`manage_grants` on `space:main`); registration refuses reserved ids; canvas restored from git; test account removed |
| **B3** unpaginated reads | **Fixed.** `src/lib/acl/reader.ts` follows continuation tokens, caps at 20 pages, and reports `truncated`. Owner ACL read now returns real tuples |
| **B2** phantom `commenter` | **Fixed.** Removed from defaults; rejected 400 with the valid relation list; UI options are model-derived |
| **B1** `denied_viewer` no-op | **Fixed in the guard layer** (see §4.2). Now deny-aware and cumulative |
| **Model drift** | **Fixed.** `src/lib/acl/modelSpec.ts` is the SSOT; `compileModel()` emits `type_definitions`; `authz/model.fga` is now *generated*. `scripts/deploy-openfga-model.ts` refuses to deploy a model with unreachable relations |
| **Single writer** | **Done.** All 8 tuple-writing modules migrated to `src/lib/acl/projector.ts`; enforced by test |
| **Troubleshooter** | **Rewritten** on `fgaClient.expand()`. The reported case now yields exactly 1 matched step citing the real tuple, 0 misses |

### 13.2 Divergences from the plan

**1. The model could not express negation.** See §4.2. The plan assumed `exclusion` worked; it does not on v1.5. Denial moved to `guards.ts`.

**2. `authz/model.fga` was dead documentation.** The plan treated it as the schema. It is never read by anything — the actually-deployed model was a **~700-line hand-written `type_definitions` literal inside `scripts/init-openfga.ts`**. That is the real DRY violation, and it is now gone: a 21-type declarative spec compiles to both the JSON and the DSL.

**3. Public access is a pre-FGA short-circuit, and the wildcard never worked.** Found while testing. Two separate defects:

- `src/lib/permissions.ts:37` — `canUserViewResource` returns `true` on
  `resource.is_public` **before** consulting OpenFGA at all. Public access is
  therefore a bypass of the authorization graph, not a grant in it.
- The model admitted **no typed wildcard on any relation**, so `grant.ts`
  writing `user:*` was always rejected. Production store: **0 wildcards**.
  Meanwhile **101 resources are public via the `resources.is_public` flag**
  (77 papers, 11 canvases, 8 folders, 4 documents, 1 sheet).

Consequences today: the troubleshooter reports "no rule grants viewer" for a
genuinely public resource, because it reads FGA and the grant is not there;
auditing "who can read this" via FGA under-reports by exactly 101; and revoking
public access has to remember to clear both the flag and the tuple, or the two
disagree permanently. The model now declares `user:*` on `viewer`/`editor`
(never on `read_acl`/`manage_grants`, enforced by test). **The 101 rows and the
short-circuit still need reconciling** — see §14.

**4. Consistency parameters are not enabled.** `readAllTuples` initially requested `MINIMIZE_LATENCY`; the server rejects it unless started with `--experimentals enable-consistency-params`, which 400'd every read. Now opt-in via `OPENFGA_CONSISTENCY`.

**5. A deny bug in my own guard layer.** The first `can()` implementation mapped one deny relation per requested relation, so `denied_viewer` did not block `editor` — write access without read. Caught by a test written to check the opposite. See §4.2.

**6. `guard`'s ACL read needs the store bound.** `guards` reaches the engine through the store-bound singleton in `openfga.ts`, which captures `OPENFGA_STORE_ID` at module load. The verification script must set it *before* importing guards, or every check silently denies. Worth knowing before writing more tests in that area.

### 13.2b Caveat 1 and 2 — resolved

**Caveat 1 (publicness bypassed the graph).** Replaced the boolean with a
declarative **audience slot** modelled on Notion's "General access": one exclusive
audience per resource, each with its own role, composed additively with
per-principal grants.

| Audience | Graph expression | Meaning |
|---|---|---|
| `restricted` | *(no tuple)* | Only named grants apply |
| `workspace` | `space:main#member [rung]` | Everyone in the workspace |
| `public_link` | `user:* [rung]` | Anyone with the link, signed in or not |

All three are real grants, so the troubleshooter can explain public access, and
auditing via OpenFGA is no longer short by 101. `space#member` was added to the
model because a typed wildcard cannot express "every member of this workspace" —
and `user:*` remains admissible **only** on `viewer`/`editor`, never on
`read_acl`/`manage_grants`, so a public link still cannot read the ACL.

`canUserViewResource` and `filterViewableResources` no longer branch on
`is_public`; both evaluate the graph, including for anonymous callers, which is
what makes a wildcard resolve for signed-out visitors at all. `is_public` survives
purely as a derived cache for indexed queries.

**Caveat 2 (group grants reached nobody).** `group_memberships` is now projected
into `group:X#member` tuples by `src/lib/acl/groups.ts`, with `synced_at` making
an unprojected row visible rather than silently inert. Verified live: granting
`group:engineers` viewer on `canvas:my-canvas` returns 200 and `user:alice`
(a member) resolves `viewer = true`, while `user:carol` (not a member) does not.
`groupIdsIn` / `describeGroups` report a group's name and member **count** without
enumerating members, because a fully expanded ACL leaks org structure.

**`scripts/reconcile-acl.ts`** detects five divergence classes and can repair
them. It found 109 on first run and reports 0 now. It re-reads the graph after
repairing, so it cannot report success it did not verify.

#### Three bugs I introduced and caught

1. **The audience post-pass.** Injecting wildcard/workspace subjects inside the
   shared relation helper meant any type overriding `viewer`/`editor` silently
   lost them — `folder` does, so **8 public folders could not be made public**.
   Moved to a post-pass that runs after every type is assembled.
2. **Cleanup deleted what it created.** `t.object.split(':')[1]` turns
   `group:engineers` into `engineers`, so the membership key never matched and the
   orphan sweep revoked the tuples `syncAllMemberships` had just written — while
   `projectMembership` still set `synced_at`, so the job reported success. Same
   parse mistake in the reconciler's orphan scan made it churn all six
   `space:main` members on every run.
3. **A repair job that reported unverified success.** `setAudience` ignored the
   grant result, so the reconciler printed "repaired 109, 0 failed" while 8 grants
   had been rejected. It now throws, and the reconciler re-reads the graph to
   confirm.

A fourth lesson: my earlier `npx tsc --noEmit | head` checks were reporting
`head`'s exit code, not tsc's. tsc is in fact clean, but the gate was weaker than
it looked.

#### Also raised the read ceiling

`MAX_PAGES` was 20 (2,000 tuples) against a 3.3k-tuple store, so bulk reads were
**silently truncating** — including inside the reconciler, which could "succeed"
having seen part of the graph. Now 100 pages by default, overridable via
`OPENFGA_MAX_READ_PAGES`, and truncation logs a warning.

### 13.3 Verification

```
npx tsc --noEmit                                     clean
npx astro build                                      clean
npx playwright test --config=tests/unit/… acl-      373 passed
npx tsx scripts/verify-acl-model.ts                  37/37 against a live engine
```

Live-stack assertions (owner and editor sessions, real OpenFGA):

| Assertion | Result |
|---|---|
| V1 privilege escalation | 401 |
| V2 anonymous oracle | 401 |
| V3 ACL read via `x-user-id` | 401 |
| V4 admin studio anonymous | 302 |
| Owner reads ACL, sees the `dummy_mail` editor grant | 200 ✅ |
| Owner sees the inherited grant **with its source container** | ✅ |
| Editor reads ACL but `canManageGrants: false` | 200 / false |
| Editor attempts a grant | 403 |
| Phantom `commenter` | 400 + valid relations |
| Troubleshooter | 1 matched step, 0 misses |
| Revoking the sole owner | 409 last-shareholder |

Store state after all testing: `canvas:my-canvas` holds its original 3 tuples; no test principals remain.

### 13.4 Regression guards added

`tests/unit/acl-model.spec.ts` (16) and `tests/unit/acl-source-guards.spec.ts` (19) lock down the *classes* of bug, not the instances:

1. Every declared relation is reachable — catches dead `denied_*`.
2. Every content type exposes `read_acl` and `manage_grants`.
3. Wildcards never appear on ACL relations.
4. Role options are model-derived; no `commenter` unless the model has it.
5. No `circle` type; groups are `group#member`.
6. `x-user-id` cannot bypass auth, and the reason is documented in place.
7. Every permissions endpoint rejects anonymous or delegates to a guard.
8. Only `src/lib/acl/` writes tuples.
9. Only `src/lib/acl/reader.ts` reads tuples (health probes exempted explicitly).
10. The deploy script compiles the spec; it contains no hand-written model.
11. The troubleshooter derives steps from read tuples and reports read failures.
12. `/admin/permissions` embeds no tuples and uses no inline layout style.

---

## 14. Remaining work

| # | Item | Priority |
|---|---|:---:|
| 1 | ~~Reconcile `resources.is_public`~~ **DONE** — audience slot shipped, 101 rows backfilled, short-circuit removed, reconciler green | ✅ |
| 2 | ~~Group grants resolve to nothing~~ **DONE** — membership projection shipped and backfilled; a group grant now reaches its members | ✅ |
| 3 | **Share dialog revamp** — provenance on every row, General-access slot, deny rows, revocation impact preview | 🟠 |
| 4 | **`resource_effective_acl` projection** — `readChanges()` cursor, full reconcile on boot | 🟠 |
| 5 | **"Shared by me"** — outbound grant view (`src/lib/acl/reader.ts#readTuplesForUser` is the primitive) | 🟡 |
| 6 | **Access Simulator** — `check({ contextualTuples })`, zero writes | 🟡 |
| 7 | **Revocation impact preview** — compute from the projection before any destructive change | 🟡 |
| 8 | **Reparent diff** — `dryRun` returning `gained[]` / `lost[]` on move | 🟡 |
| 9 | **Access requests + notifications** — Confluence-style routing: owner → creator → last editor → space admin | 🟡 |
| 10 | **Migration `0006`** — `resource_grants`, `resource_audience`, `acl_inheritance`, `resource_effective_acl`; mirror into `docker/postgres/init.sql` | 🟡 |
| 11 | ~~Orphaned-resource repair~~ **DONE** — `isDatabaseOwner()` makes `owner_id` authoritative, 748 owner tuples backfilled, 913/913 now agree | ✅ |
| 11b | ~~Phantom owners~~ **DONE** — 722 resources folded into the real account; `user:system` became the registered principal `service_account:system` (migration `0008`) | ✅ |
| 12 | **Audit content mutations** — `writeAudit` fires on permission changes but not on writes, so the V5 intrusion left no trace | 🔴 |
| 13 | **Audit the Meilisearch filter interpolation** in `search.ts` — `'` escaped as `\\'` is not a safe filter-language escape | 🟠 |
| 14 | **Space-level `manage_grants`** — confirm the intended admins hold it on `space:main`, since that is now the root of workspace administration | 🟠 |
| 12 | **Inbound "Shared with me"** — needs different reverse-lookup semantics → `plan/future-roadmap/9-pending-tasks-feature-gaps.md` | ⚪ |

---

## 15. Ownership: one root of truth, and non-human principals

### 15.1 The owner lockout

`resources.owner_id` was declared the root of truth but was only *honoured* in
one place. The edit path read Postgres; the guard layer read only OpenFGA — and
**748 of 913 resources had an `owner_id` and no `owner` tuple**, because seed
scripts, vault sync, and migrations write the resource row and not the grant.

The symptom was worse than an inconvenience: you could open and edit your own
resource, press Share, and be told you were not allowed to see who had access —
and then be handed a **404** for a resource that plainly exists.

**Fix.** `isDatabaseOwner()` inside `can()`, so every consumer is corrected at
once rather than the Share dialog alone. It is **FGA-first** (the engine stays the
hot path) with a 60s cache, and a lookup failure grants nothing. All 748 tuples
were then backfilled, so 913/913 resources now agree.

### 15.2 Non-human owners are not missing users

With ownership visible, the data was still wrong: **896 of 913 resources were owned
by ids that do not exist in `users`** — `user:demo` (678), `user:system` (175),
`user:researcher` (42), and two pieces of junk. Because they were typed `user:*`,
they were indistinguishable from a person whose account had gone missing.

Resolved by intent rather than by guess:

| Was | Now | Why |
|---|---|---|
| `user:demo` (678) | `user:dummy_mail` | A truncated form of the real account |
| `user:researcher` (42), `user:testpassword`, `user:tex` | same | Seed-script placeholders |
| `user:system` (175) | **`service_account:system`** | Not a person — it owns the platform's own reference content |

The OpenFGA model already had a `service_account` type; it was simply never used.
Migration `0008` registers it as a first-class principal
(`service_accounts` + `service_account_principals`) with the properties that make
it *different* from an absent user rather than a corrupted one:

- `can_authenticate = false` — nobody logs in as it
- holds **no** `space:main` membership, so it is not part of the workspace audience
- belongs to no user, team, or group
- its 175 resources are the public vault: reference papers, worked examples,
  how-tos, showcase boards — the platform documenting itself

Because a service account cannot be logged into and `manage_grants` deliberately
does not inherit, its content would otherwise have no reachable administrator —
the same dead end the phantom audit found. So the human administrator holds an
explicit `manage_grants` + `editor` on each, recorded in
`service_account_principals`.

Reconciliation gained two classes: `phantom-owner` (an id that is neither an
account nor a registered service account) and `service-account-without-admin`.
Both are reported and never auto-corrected, since both need a human decision.

### 15.3 The namespace invariant

Registration derives ids as `user:<email local part>`, so a human can never
structurally occupy the `service_account:` namespace. Registering as
`dummy_mail` previously succeeded and produced `user:service_account` —
a different id, so no impersonation, but confusing in audit rows. Now reserved,
with a test asserting the namespace disjointness rather than the blacklist.

---

## 16. Opaque identities, ACL projection, and content audit

### 16.1 Ids are no longer derived from the email

`register.ts` minted `user:${email.split('@')[0]}`. That one line caused the
phantom owners, permitted two emails to collide on one id, broke every grant on an
email change, and let one human exist as two principals.

```
before   user:demo (678 resources) · user:system (175) · user:researcher (42) …
after    user:1f9388cd-026a-4f20-938c-376769e5c851  dummy_mail
         user:5d86c06d-03cd-4bcb-baf4-0525c3fb1668  dummy_mail
         …
         legacy_id: user:dummy_mail   (still resolvable)
```

- **`0009`** adds `legacy_id` and switches the three foreign keys to
  `ON UPDATE CASCADE` so the re-key carries `api_keys`, `user_identities` and
  `group_memberships` with it.
- **`scripts/migrate-user-ids.ts`** re-keys 6 users, 738 `owner_id` rows, 35 audit
  actors and **2,286 relationship tuples** — through the engine, not by updating
  the `tuple` table, so OpenFGA's changelog stays truthful for the projection.
- **`0010`** then adds `users_id_format` and an immutability trigger, so a
  hand-written `user:something` is now rejected by the database.

  The constraint could not live in `0009`: `NOT VALID` skips the initial scan but
  is still enforced on `UPDATE`, so it would have blocked the re-key it was
  written to protect. It is asserted *after* the data conforms, in its own
  migration, so the ordering is explicit rather than a comment.

`src/lib/userIds.ts` owns id minting, resolution (email / legacy id / canonical)
and display resolution. The ACL now renders `DUMMY_NAME`
rather than an id — and before the migration, rather than `user:dummy_mail`
in an audit row.

### 16.2 Effective-access projection

`resource_effective_acl` (migration `0011`) is a read model derived from the graph:
4,413 rows in ~350 ms. It powers the Share dialog's provenance ("Inherited from
Demo's Personal Root Vault"), the exposure badge, the revocation blast radius,
and "Shared by me".

Two properties are deliberate:

- **It is never an authorization input.** Every decision is a `check()` against the
  engine. `acl_projection_state` exposes `stale` so the UI can admit it rather than
  present a cache as truth.
- **Groups are not expanded into members.** Expansion is O(groups × members ×
  resources) and it leaks org structure. The ACL renders "Platform team · 14
  members".

Writes flush before responding (`reconcileNow`) rather than debouncing: a read
model that is stale the instant after the change it exists to reflect is worse
than none, because it looks authoritative. This was caught by a test that failed
only after the write had been reported successful.

### 16.3 Content mutations are audited

`writeAudit` was called by the permission endpoints and nowhere else, so **both**
intrusions found in this workspace left zero rows. `src/lib/acl/auditContent.ts`
records actor, action, resource and *field names* — never content — and is wired
into every mutating resource endpoint, with a source guard so the next endpoint
inherits the rule rather than forgetting it.

Reads are deliberately not audited: auditing every read would be unauditable
itself, and the interesting reads (ACL enumeration, privilege probing) are already
audited by the permission layer.

### 16.4 Two further search defects

- The Meilisearch filter escaped the principal with `replace(/'/g, "\\'")`, which
  is **not a valid Meilisearch escape**. It was safe only because ids had become
  opaque uuids — a property of the id format, not of the filter. It now validates
  the shape and falls through to a public-only filter: fail closed, nothing to get
  wrong.
- The result post-filter called the raw engine, bypassing deny precedence, so a
  subject with an explicit `denied_viewer` still matched their own search results.
  It now goes through `can()`.
