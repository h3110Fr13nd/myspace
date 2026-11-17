# Permission Hierarchy Research: Confluence vs. Google Drive

**Legend:** `[DOC]` = officially documented, with citation. `[INFER]` = my derivation from documented facts, not stated by the vendor. `[COMM]` = Atlassian/Google community threads, user reports — treat as anecdotal. `[CONFLICT]` = sources disagree.

---

# PART A — CONFLUENCE / ATLASSIAN

## A.0 The one-sentence model

> **Space permissions are an additive, group-unioned baseline. Page restrictions are an intersection (narrowing only). The result is monotonically decreasing down the hierarchy, and it can never widen below a container.**
>
> [DOC] "Restrictions don't override a person's space permission. For example, if you say a person 'can view' in the restrictions dialog and they don't have 'view' permissions for the space, they won't be able to see the page." — [Page restrictions (DC)](https://confluence.atlassian.com/doc/page-restrictions-139414.html)
>
> [DOC] "Confluence's permissions model is set up so that content can only be further restricted from whatever the container is set at. A content item cannot have greater access than its container, which may be the space or another content item." — [Manage permissions at the content level](https://support.atlassian.com/confluence-cloud/docs/manage-permissions-on-the-page-level/)

This is the **opposite** invariant from Google Drive. Confluence = monotonic *narrowing* (∩). Drive = monotonic *widening* (∪). `[INFER]` Any single ReBAC model must pick one; a system that wants both needs two distinct primitives (see §C).

### The three (four) levels

| Level | Object | Who manages | Direction |
|---|---|---|---|
| Global permissions | Site | Confluence/System admin | Baseline for "can log in at all" |
| Space permissions | Space | Space admin(s) | Additive union across user + all groups |
| Page restrictions | Page / blog / live doc / folder / whiteboard | Space `Restrict` permission + page edit | Intersective narrowing |
| Anonymous access | Site toggle + per-space grant | Site admin toggles; space admin grants | All-or-nothing per space |

[COMM] Atlassian's own KB states the ordering plainly: *"The 'lowest' level wins — if Page restriction blocks the user, Space permission cannot override it."* — [KB: Understanding permissions](https://support.atlassian.com/confluence/kb/understanding-permission-in-confluence/)

---

## A.1 Space permission scheme — exact actions

[Source: [Space Permissions Overview (DC 10.2)](https://confluence.atlassian.com/doc/space-permissions-overview-139521.html)]

| UI Category | UI Permission | REST `operation.key` → `operation.target` |
|---|---|---|
| **All** | **View** — access content, see it in space directory + dashboard | `read` → `space` |
| All | **Delete own** — delete pages/blogs/attachments/comments *you* created, regardless of later edits by others | (delete + ownership filter) |
| **Pages** | **Add page** — create new pages **and edit existing pages** (assuming not restricted for editing) | `create` → `page` |
| Pages | **Delete page** | `delete` → `page` |
| **Blog** | **Add blog** / **Delete page** (blogs) | `create`/`delete` → `blogpost` |
| **Attachments** | **Add attachment** (upload; edit via Companion app) / **Delete attachment** | `create`/`delete` → `attachment` |
| **Comments** | **Add comments** / **Delete comments** | `create`/`delete` → `comment` |
| **Restrictions** | **Add restrictions** — apply page-level restrictions | `restrict_content` → `space` |
| Restrictions | **Delete restrictions** — remove restrictions from *any* page in space | `restrict_content` → `space` |
| **Mail** | **Delete mail** | — |
| **Space** | **Export space** — whole space to PDF/HTML/XML | `export` → `space` |
| Space | **Admin** — all space admin tools incl. permissions, templates, look and feel, delete space | `administer` → `space` |
| (page) | — | `archive` → `page` |

[Source for REST keys: [Confluence Cloud REST v1 — Space permissions](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-space-permissions/)]

### Four non-obvious, implementable details

1. **[DOC] Space permissions are additive / unioned.** "Space permissions are additive. If a user is granted permissions as an individual or as a member of one or more groups, Confluence will combine these permissions together. This is sometimes known as their **effective permissions**." → In ReBAC terms, this is a union of tuplesets per (user, space) with **no deny**. There is no deny in Confluence's model.
2. **[DOC] `Add page` grants edit on all pages in the space.** "Add page gives you permission to create new pages *and edit existing pages* in this space (assuming the page is not restricted for editing)." This is a *scope* permission, not a per-object grant — the nearest Confluence analogue to a TTU on a container.
3. **[DOC] Removing Read space permission nukes everything.** "Note that removing Read Space permission for a user or group will remove **all** the space permissions for that user or group." — [REST ref](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-space-permissions/). Dangerous footgun; mirror it as a documented cascade in any clone.
4. **[DOC] Export is asymmetric.** "Export space gives you permission to export all the contents of the space to PDF, HTML or XML. **This is different to single page exports - anyone who can view a page can also export it.**" → A page-level view grant silently implies export. There is *no* per-page export permission. `[INFER]` This is a data-exfiltration hole you should probably not replicate; if you do, name it.

---

## A.2 Page restrictions — precise inheritance/override semantics

### A.2.1 The four documented states of "General access"

[Source: [Change who can find content and what they can do with it (Cloud)](https://support.atlassian.com/confluence-cloud/docs/add-or-remove-page-restrictions/)] — verbatim state names:

| # | Exact UI string | Semantics (verbatim) |
|---|---|---|
| 1 | **Open: Anyone in this space can edit** | "No restrictions. Consume whatever the space's access settings are." |
| 2 | **Open: Anyone in this space can view** | "All editing is restricted to specific people. Even if people have permission at the space level to edit content, they can't edit this content unless they're explicitly listed with **Can edit** in **Specific access**." |
| 3 | **Restricted: Only specific people can view or edit** | "Even if people have permission at the space level to view and edit content, they can't view or edit this content unless they're explicitly listed in **Specific access**." |
| 4a | **Restricted by a parent: Anyone on the parent can edit** | "No *direct* restrictions; restrictions are inherited from a parent item. So consume whatever the parent content's *view* access settings are." + "**Note:** Edit permission is not inherited from content to content. Even if people don't have edit permission on the parent content, they are *not* prevented from editing this content." |
| 4b | **Restricted by a parent: Anyone on the parent can view** | "Anyone who can view the parent items can only view this page — unless they're explicitly listed on this page as having permission to edit." |
| 4c | **Restricted: Only specific people can view or edit** *(Restricted-by-a-parent scenario)* | "Even if people have permission to view and edit the parent content, they can't view or edit this content unless they're explicitly listed in **Specific access**." |

`[INFER]` **State 3 is a child-side *tightening* of state 4b.** A child of a Restricted parent that is itself Restricted is a *further* narrowing — a second gate, not a widening. So a chain of Restricted pages intersects at every level.

### A.2.2 The inheritance rules, verbatim

[Source: [Page restrictions (DC 10.2)](https://confluence.atlassian.com/doc/page-restrictions-139414.html)]

> "**View restrictions are inherited**, which means a restriction applied to one page will cascade down to any child pages. **Edit restrictions are not inherited**, which means pages need to be restricted individually."

> "If someone can't view a parent page or folder, they can't view any child content under it. View restrictions added to the parent page or folder are inherited down to all content items nested under it. **Editing doesn't work this way.** Even if someone is restricted from editing a parent item, they won't automatically be restricted from editing the child content. *However*, if someone is restricted from editing at the **space** level, they *will* be restricted from editing any and all content in that space."

### A.2.3 The effective-access formula

Let:
- `S(u, space)` = space permission tuple (union of user + all group grants)
- `R_view(P)` = direct view restriction on P (`None` = no restriction)
- `R_edit(P)` = direct edit restriction on P
- `A(P)` = ancestors of P, root-first

```
viewable(u, P)  ⟺  'view' ∈ S(u, space)
                 ∧  ∀ Q ∈ A(P) ∪ {P} :  R_view(Q) is None  ∨  u ∈ R_view(Q)

editable(u, P)  ⟺  viewable(u, P)
                 ∧  'edit'(=Add page/Blog) ∈ S(u, space)
                 ∧  (R_edit(P) is None  ∨  u ∈ R_edit(P))
                 ∧  ∀ Q ∈ A(P) :  (R_edit(Q) does NOT apply)   ← no edit inheritance
```

`[INFER]` Two asymmetries fall straight out of this and are the whole story:

- **VIEW is a monotonic AND over the ancestor chain.** Adding a restriction anywhere on the path can only remove access. Removing one can only restore it.
- **EDIT is checked at exactly two points: the page itself, and the space.** A restricted parent does not protect the child from editing. This is a known, long-standing, *unfixed* gap: **[DOC]** Atlassian's public ticket **CONFSERVER-5095 — "Page edit permissions should be inherited by pages, like view permissions are"** is cited in the KB as the canonical explanation for why this is the behavior. — [KB: Child page does not inherit page restrictions](https://support.atlassian.com/confluence/kb/child-page-does-not-inherit-page-restrictions-from-parent-page/)
  `[INFER]` For a new system, inheriting edit (like view) is almost certainly what users *expect*. Confluence's non-inheritance of edit is the single most-copied-wrong decision in this space.

### A.2.4 Is it additive or subtractive? — **Strictly subtractive.**

`[DOC]` Every documented statement converges: restrictions can only narrow. There is **no** documented mechanism by which a page-level grant *adds* access that space permissions did not already confer. `[DOC]` Corollary: "if you say a person 'can view' in the restrictions dialog and they don't have 'view' permissions for the space, they won't be able to see the page."

`[INFER]` This means a Confluence page ACL is a **filter/deny-list, not an ACL**. It cannot express "alice alone, regardless of space membership" without also granting alice space View.

---

## A.3 Inheritance break — "disable inherited permissions"

### **There is none. This is by design.**

[COMM] Atlassian Community, "Remove inherited restrictions from a child page": *"Very short answer - **no**. View restrictions cannot be changed, a user has to be able to see a page in order to see the other parts of the page below it."* — [thread](https://community.atlassian.com/forums/Confluence-questions/Remove-inherited-restrictions-from-a-child-page/qaq-p/2422290)

`[INFER]` **The stated rationale is a UI/navigation invariant, not a security one:** to reach a child page via the tree, the requester traverses every ancestor, so a child that is *more* permissive than its parent is unreachable through normal navigation. Confluence chose to make this a hard invariant rather than support the exception. `[INFER]` If your OpenFGA system wants child-widening, you must either (a) make the ancestor non-enumerable in the tree (Drive's approach), or (b) accept that a widened child is orphaned.

### What the UI actually offers

**Data Center (legacy padlock UI):** [Source: [Page restrictions (DC)](https://confluence.atlassian.com/doc/page-restrictions-139414.html)]

Three padlock icon states in the page header:

| Icon state | Meaning (verbatim) | Action |
|---|---|---|
| Grey unlocked | "Viewing this page is not restricted. Everyone can see this page (but editing may be restricted)." | — |
| **Red locked** | "The page is restricted." | Click → list of who can view and edit this page |
| **Red unlocked** | "The page is inheriting restrictions from another page." | Click, then select **Inherited Restrictions** → "a list of pages this page is inheriting restrictions from" |

The restrictions dialog also carries the inline callouts: *"1. Speed it up: apply the same restriction to multiple people and groups. 2. **Watch out: restrictions on other pages can affect this one.** 3. Be specific: choose exactly what each group or person can do."*

**Cloud (unified Share dialog):** the padlock was folded into **Share**. `[COMM]` "clicking the Share button will display all the Page Restrictions (if any) such as View and Edit restrictions as it now consolidates the functionality of the former padlock icon." — [Permissions to access restricted page](https://community.atlassian.com/forums/Confluence-questions/Permissions-to-access-restricted-page/qaq-p/3098432)

`[CONFLICT / worth verifying in a live instance]` The same thread contains a space-owner reporting that on a child of a restricted page, the Share dialog offered **only** "Open" and "Restricted by parent" — i.e. no way to place a direct restriction, which would contradict §A.2.1 state 4c. The thread was never resolved to a definitive answer. **Design implication: if you expose a "Restricted by parent" state, make the child's own state unambiguously editable.**

### The only way to widen a child (documented workarounds)
1. Move the child to a different space / different parent.
2. Remove the parent's restriction.
3. Copy the page to an unrestricted location (⚠ see copy semantics below).

---

## A.4 Sharing surfaces

### A.4.1 Cloud Share dialog — exact section names

[Source: [add-or-remove-page-restrictions](https://support.atlassian.com/confluence-cloud/docs/add-or-remove-page-restrictions/)]

| Section / control | Exact name | Notes |
|---|---|---|
| Header | **General access** | Three states, §A.2.1 |
| Audience link | **"Anyone in this space"** | A hyperlink. "If the content item is restricted by a parent, then you can check who has access to the parent item by selecting **this parent** in the line '**Anyone on this parent**'" |
| List | **Specific access** | Per-row: `Can edit` / `Can view`; dropdown → `Remove` |
| Bulk | **Remove all** | "If the content is already in a 'Restricted state', you can quickly clear the board… by selecting **Remove all**" |
| Requests | **Access requests** (tab in Share dialog) + real-time in-page **flag** | `Approve` / `Deny` / close-to-defer. "A blue dot will show if you have new access requests." |
| | ⚠ "Teams are not supported in the unified sharing experience yet." | |

### A.4.2 ⚠ The single most important UX rule: **"When anyone can edit, no one can have specific access"**

[DOC] verbatim:
> "Individual people and groups only appear in the list with specific access when they have ***greater access*** than the **General access** setting.
> For example, if General access is set to Open > Anyone can view, anyone with Can edit will have greater access than the general access and therefore are notable to list in specific access.
> However, if General access is already set to Open > Anyone can view and edit, then there's no greater access possible. Therefore, **there is no relevant specific access to note**."

`[INFER]` **The Specific access list is a strict-override list, not a complete ACL.** It only shows entries that *differ from* the default. `[INFER]` This is a defensible design (it makes the ACL diff-shaped and reviewable) but it is also a readability trap: users interpret "Specific access" as "the people who can see this", and it silently isn't. **If you build a ReBAC-backed Share dialog, you must decide explicitly which of these two semantics your list has, and label it.** I'd recommend an explicit "Custom" / "Inherited" toggle plus a computed "Effective access (N people, M groups)" count, so the two are never conflated.

### A.4.3 Space members vs. Page restrictions — the object distinction

| | Space access | Page restriction |
|---|---|---|
| Managed in | **Space settings** → Users / Groups / Guests / **Anonymous access**; and **Space permissions** | **Share** dialog on the item (was: padlock) |
| Granularity | Whole space | One item (+ descendants for view) |
| Union or intersect | **Union** (additive) | **Intersect** (narrowing) |
| Can grant above container? | Yes (it's the container) | **No** |
| Admin-only override | Space Admin can `restrict_content`, delete space, etc. | Space Admin + System Administrator can remove restrictions on pages they cannot see |

### A.4.4 "People who can view" — the computed-ACL view (Data Center)

[Source: [Check who can view a page](https://confluence.atlassian.com/display/DOC/Check+who+can+view+a+page)]

**UI:** `More options (⋯) > People who can view`. Lists all viewable users, with type-to-filter.

**Inclusion rule, verbatim:**
> "The list includes everyone who:
> - is not prevented from viewing the page by page restrictions, and
> - is allowed to view the space, via space permissions, and
>
> The list also includes **members of the `confluence-administrators` super group, who can always see all spaces and pages.** This means that even if you restrict a page to yourself, it's possible that at least one other person can see it."

`[INFER]` This is a **materialized effective-ACL view** — the union of all grants minus all denials, expanded through groups, with superusers force-included. It is the closest thing either system has to `ListObjects` + user simulation, and it is exactly the surface you'd want in a ReBAC design. **Whether it exists is a per-site toggle:** "People with Confluence Administrator or System Administrator permissions can disable the **People who can view** option, if they don't want people to be able to see a list of user's names." (via `/admin/plugins/gatekeeper-plugin/global/configuration.action` → "Show People who can view option").

⚠ **Caching caveat [DOC]:** "Confluence caches permissions information… However, we know of two scenarios where the cache is not correctly updated - when you import a site, and when you add, disable, or change the order of your user directories." Also, in 7.3.0–7.3.3, "the Inspect permissions and People who can view features don't take into account some external directory and nested group scenarios." `[INFER]` Computed-ACL surfaces are eventually consistent and a known source of false negatives. Say so in your UI.

### A.4.5 "Inspect permissions" — the "why" debugger (Data Center only)

**UI:** `Space tools > Permissions > Inspect permissions` (space admin), or `General Configuration > Inspect permissions` (Confluence/System admin — "You don't need to have permission to view the space itself").

[Source: [Inspect permissions](https://confluence.atlassian.com/conf73/inspect-permissions-991928385.html)]

Returns, per action, a **provenance explanation** rather than a boolean. Verbatim examples of the explanation strings:
- "The user, or a group they're a member of, are not listed in the page restrictions dialog, so they have 'no access'."
- "The user can view the page, either because the page restriction allows everyone to view, and only some people to edit, or the user, or a group they're a member of, are listed in the page restrictions dialog, and they have 'View only' or 'View and edit' access."
- "This person is a space admin, so can edit restrictions. They can also remove all restrictions from pages they don't have permission to edit or view."
- "This person is a member of the `confluence-administrators` super group… can view all pages, including restricted pages. While they can't edit existing pages, they can add, delete, comment, restore page history, and administer the space."
- "The group has Restrict permission, but does not have the Add page permission. **Applying a page restriction is considered editing the page, so both permissions are required.**"
- "A page restriction has been applied to the page. **Anonymous users have 'no access'.**"

`[INFER]` **This is the single most valuable artifact in either system for your design doc.** It is a *decision-provenance* view: not "alice cannot view" but "alice cannot view **because** <this exact ACL edge is absent>". A ReBAC system can produce this natively from the check request — you should absolutely surface it, and you should mirror Confluence's specific explanatory strings because they are already battle-tested with users.

`[CONFLICT]` The DC doc says "only available in Confluence Data Center"; an Atlassian community answer says "only available for Premium and Enterprise licenses." Both are true of different products (DC vs. Cloud plan tiers) — verify which applies to your target before citing.

### A.4.6 Admin escape hatches — what an admin sees that nobody else does

| Actor | Can see restricted pages exist? | Can see contents? | Can remove restrictions? |
|---|---|---|---|
| Normal user with view | Yes | Yes | Only if `Restrict` + page edit |
| **Space admin** | **Yes** — `Space settings > Content > Restricted` (Cloud) or `Space Administration > Restricted Pages` (DC) | **No** — "they won't be able to see the content when they navigate to it" | **Yes**, including on pages they cannot see |
| `confluence-administrators` (DC super group) | Yes | **Yes, always** | Yes |
| Confluence/System admin (global) | Yes | Not by default — but "can grant themselves space administrator permission to the space" | Yes |
| **Org admin + admin key** (Cloud Premium/Enterprise) | Yes, via banner | **Yes** | Yes |

[Source: [Bypass page restrictions with admin key](https://support.atlassian.com/confluence-cloud/docs/bypass-access-restrictions-on-a-page-with-admin-key/)]
> "go to the page you need to access, and click **View now** in the admin key panel. This enables admin key and gives you full access to the page… The banner at the top of your screen will indicate when you are using the admin key… When you're done using admin key, select **Stop using admin key** from the banner. For security reasons, you'll lose access to restricted content after a few minutes of inactivity."

`[INFER]` Design takeaways worth stealing verbatim:
- The elevated session is **explicit, banner-announced, time-boxed, and idle-expiring.**
- It is **audited with a distinct event type** (`Viewed with admin key`) and **emails the content owner**.
- The **content owner is notified** — a "read-access by admin" notification is a real pattern that almost no product implements and is cheap to add.

### A.4.7 Access requests — routing rules

**Cloud [DOC]:** "Confluence notifies the best suited person… in the following order, until someone has the correct permissions to grant the request:"
1. **The content owner** → 2. **The content creator** → 3. **The last editor of the content** → 4. **The space admin.**

"Approver will receive an in-app notification as well as an email." · "If you select **Deny**, the user's request will be deleted from **Requests** for everyone. The requesting user will not be notified." (note: silent deny)

**Data Center [DOC]** — different algorithm: "Confluence will send an email to up to **5 people** most likely to be able to grant you access, in the following order: 1. people who have contributed to the page in the past, can see the page and have 'Restrict' or 'Admin' space permission (**sorted by last edit date**); 2. space administrators who can see the page (**sorted alphabetically**)." · "There's no follow up email if none of the 5 people respond."

⚠ [DOC] **Request access is unavailable in some states:** "If the request access message above doesn't appear, you're not able to request access for that particular page. This usually is because the page has **inherited view restrictions from a parent page**, you don't have adequate space permissions, or there is no mail server set up." `[INFER]` This is a genuine UX dead-end: a user who *should* have access but is blocked by an ancestor gets no recourse path.

`[INFER]` For ReBAC: define a **request-routing resolver** that walks candidate principals in priority order and stops at the first who satisfies `can_grant(subject, object)`. OpenFGA's `ListObjects`/`Check` makes this implementable; Confluence had to approximate it with heuristics + a hard cap of 5.

---

## A.5 Anonymity / external users

### A.5.1 The documented three-level model

[Source: [Control whether spaces can turn on anonymous access](https://support.atlassian.com/confluence-cloud/docs/set-up-public-access/)]

> "When you make your content available to anonymous users, this means **anyone on the internet**. The anonymous access feature **can't accommodate sharing with some anonymous people and not others. It's all or nothing.**"

| Level | Control |
|---|---|
| **Confluence (site)** | Global permission granting `anonymous users` any access at all. "By default, anonymous users start with no access to any spaces." |
| **Space** | "If space access is granted, then anonymous users will have access to **all content within the space**. To restrict them from a page or other content item, you can either change its restrictions or hide it from the content tree." Space admins can grant anonymous users **any space permission except space admin**. |
| **Content** | "Anonymous users are restricted from viewing content when its access setting is **Only specific people can view or edit**, or when **one of its parent content items has been set so that only specific people can access**. This means that view restrictions are passed down to all of the nested items." |

### A.5.2 What warning does it show? — the honest answer

`[DOC]` The only **documented** anonymous-access warning I could find is **to space admins**, and it is about the site-level block, not about page-level risk:

> "Space admins will see a message in their space settings explaining that **anonymous access is blocked at the site level**."
> "When you select **Enforce site-level control**, we'll turn off anonymous access in spaces where it was previously enabled. **This action can't be undone.**"

`[DOC]` Additional *related* documented warnings, none of which is a Share-dialog inline warning:
- Audit log records anonymous-access permission changes explicitly: "Global permission added or removed — **including 'anonymous' access**"; "Space permission added or removed — **including 'anonymous' access**". — [View the audit log](https://support.atlassian.com/confluence-cloud/docs/view-the-audit-log/)
- Public *links* are a **separate, separately-governed feature**: "Control whether spaces can allow public links" / "How secure are public links?" / "Manage public links across Confluence Cloud". `[INFER]` This means Confluence has **two** external-sharing mechanisms (anonymous access at space level, and public links at content level) that most administrators conflate.

**`[INFER]` Negative finding worth recording in your design doc:** Confluence Cloud provides **no documented inline warning in the Share dialog** when content becomes reachable by anonymous users. Given "it's all or nothing," a page-level "Restricted" state is the *only* thing standing between an anonymous internet audience and your page — and the UI gives no signal that this is now the case. **A simple "⚠ This page is visible to anyone on the internet because <space> allows anonymous access" banner is a cheap, high-value differentiator.**

### A.5.3 The information-hiding contract (steal this)

[Source: [Permissions and restrictions (DC)](https://confluence.atlassian.com/doc/permissions-and-restrictions-139557.html)]

> "If someone doesn't have 'View' space permission, links to pages in that space will be visible, but they'll get a **'page not found'** message. **The space key is not revealed in the link URL.**"
> "If someone has the 'View' space permission, but the page has view restrictions, the link will be visible but they'll get an **'access denied'** message."
> "Links to attachments are also affected. If the visitor doesn't have permission to view the content the attachment lives on, **the link won't be rendered.**"

And on restricted content generally (Cloud):
> "If your content has view restrictions, it won't display for anyone who doesn't have permission to view it, **neither in the content tree nor any macros**. Unless someone else has specifically been given a link… **they won't know it exists.**"
> "If someone has shared a link to a restricted content item… the link will have the title of the content item as part of the URL. However, **they won't be able to tell anything else about the content, including who created it, who has permission, or when it was updated.**"

`[INFER]` **Two distinct non-existence signals, deliberately separated:** no-space-view ⇒ "not found" (404-shaped, space key stripped); has-space-view-but-restricted ⇒ "access denied" (403-shaped, title revealed). This prevents an anonymous/probing user from enumerating which spaces *and* which page titles exist. Most hierarchical systems get this wrong. Also note: restricted pages are filtered from **macros** (page tree, children, search results), not just the nav — a leak vector people forget.

### A.5.4 Orphaned-access failure modes (documented)

- **Deactivated account set the restriction:** "If a page is inaccessible but the account that set restrictions set is deactivated or deleted, you will need admin-level access to resolve the issue. Organization admins on the Premium and Enterprise plans can use the **admin key** feature to adjust access settings and remove these restrictions." `[INFER]` A group-restriction referencing a deleted group is unrecoverable without admin — you need an **"orphaned principal" detector** and a recovery runbook. There is no user-facing escape.
- **DC→Cloud migration:** "restrictions inherited from deactivated or deleted users may result in certain content becoming inaccessible. **Admins should review space and page restrictions post-migration** to ensure continued access for active users."
- **Group rename** (third-party app, `[COMM]`): "if you rename a group, space permissions are updated to reflect the new group name, but **page restrictions are not updated**. The page restrictions will remain in place despite the old group no longer existing, which could potentially cause members of the renamed group to be locked out of pages." — implies a group-identity indirection problem.
- **Inheritance index desync (DC internals):** view inheritance is computed from a `CONFANCESTORS` table plus a separate **"Inherited Content Permissions"** cache. If a plugin deletes `CONFANCESTORS` rows on import (documented: Brikit Theme Press did), "the parent page will still be restricted, but the children will not" — a **silent fail-open**. Fix requires rebuilding ancestors (~15 min on large instances), flushing the Inherited Content Permissions cache in Cache Statistics, and possibly reindexing. — [KB](https://support.atlassian.com/confluence/kb/inherited-page-permissions-are-not-being-respected/)
  `[INFER]` **Critical design note: Confluence's inheritance is materialized/derived, not computed at read time, and its failure mode is fail-open.** If you compute inheritance in OpenFGA at check time (`viewer` ∝ `parent#viewer` via a TTU), you get fail-closed for free. That's a strong argument for a computed model.

---

## A.6 Audit trail

### A.6.1 What is recorded

[Source: [View the audit log (Cloud)](https://support.atlassian.com/confluence-cloud/docs/view-the-audit-log/)]

**Access:** Confluence administration → **Monitoring** → **Audit log**. *"You'll need Confluence administrator permissions to view the audit log. The audit log isn't available on the Free plan."* Filterable by keyword and time. Bulk export supported.

Recorded event categories (verbatim):

| Category | Events |
|---|---|
| **Users and groups** | User created, deactivated, or reactivated · User details updated · User added to or removed from group · Group added or deleted |
| **Global administration** | Global settings changed · Site logo changed · Color scheme modified |
| **Permissions** | **Global permission added or removed** — *including "anonymous" access* · **Space permission added or removed** — *including "anonymous" access* · **Content restriction added or removed** |
| **Public links** | Enabled or disabled |
| **Content** | Archived or restored · **Viewed with admin key** |
| **Configuration** | Exported or imported · Configuration updated · Logo uploaded · Trash emptied |
| **Templates** | Created or updated |

**Explicitly NOT recorded [DOC]:** *"The audit log doesn't record information related to content edits (you can view this in the version history) or changes to a content's location."*

**Retention [DOC]:** *"Events remain in the log, by default, for **one year**… you can adjust the log settings to keep events for as long as one standard month (31 days)"* → range **1–12 months**. *"Once a week the system will run a clean up and delete any log entries that are older than the time frame you've set."*

### A.6.2 "Page restriction history" — the honest answer

`[DOC]` **There is no page-level restriction history / ACL diff view.** The audit log records three coarse event types — `Content restriction added`, `Content restriction added or removed` — and that is the *entire* record. There is no per-item permission-version timeline, no before/after subject diff, no "who changed from whom to whom."

`[INFER]` This is a real gap. Concretely, Confluence can answer *"was a restriction added to page X on date D?"* but **cannot** answer *"who has access to page X, and how did that change?"* To reconstruct, you must replay events into your own state.

`[INFER]` If your design doc needs compliance-grade ACL provenance, you must go beyond Confluence. Minimum viable event schema:
```
{ ts, actor, verb, target_type, target_id, principal_type, principal_id,
  relation, before_role|null, after_role|null, source: 'direct'|'inherited'|'space',
  inherited_from_id|null, request_id }
```
Confluence gives you ~4 of those 14 fields. Drive's Activity API (`driveactivity/v2`, `PermissionChange`) is the better reference model — see §B.7.

### A.6.3 admin key audit — the best-designed part of Confluence's audit

[Source: [Bypass page restrictions with admin key](https://support.atlassian.com/confluence-cloud/docs/bypass-access-restrictions-on-a-page-with-admin-key/)]

Recorded in the audit log:
- Your name
- The date and time you used admin key
- **The fact that you logged in and out of admin key** (⇒ you can compute total elevated session duration)
- The name of the content you accessed and **whether you viewed or edited** the content
- Permissions changes you made, if any

Plus: *"we'll record it in the audit log and **send an email notification to the content owner**."* Email contains admin's name, content name, and "an explanation of why admins typically use admin key." And: *"we let the content owner know your changes are recorded in the audit log and version history."*

Also recorded: changes made under admin key appear in **page version history**.

### A.6.4 Who can see it

| Audience | Audit log | Restricted-pages list | Effective viewer list |
|---|---|---|---|
| Confluence administrator | ✅ | ✅ | ✅ (and can disable the feature site-wide) |
| Space administrator | ❌ | ✅ | ✅ (if enabled) |
| Page owner / editor | ❌ | ❌ | ✅ (if enabled) |
| Normal user | ❌ | ❌ | ✅ (if enabled) |

`[INFER]` The audit log is **tenant-wide and admin-only** — a space admin cannot see permission changes in their own space. For a multi-tenant product this is a compliance feature; for a workspace product it feels like a bug report waiting to happen. Consider a space-scoped audit view.

---

## A.7 Known UX criticisms

### A.7.1 Officially acknowledged

`[DOC]` **The core confusion is admitted in Atlassian's own docs:**
> "Confluence is open by default, however **because of the layers of space permissions and page restrictions that can be applied, it isn't always obvious who can see your page.**" — [Check who can view a page](https://confluence.atlassian.com/display/DOC/Check+who+can+view+a+page)
> "Confluence is open by default, but **because of the layers of group, individual and anonymous permissions that can be applied, it can be challenging to find out exactly who can do what.**" — [Inspect permissions](https://confluence.atlassian.com/conf73/inspect-permissions-991928385.html)

`[DOC]` **"You can't fully hide a page" is documented, verbatim:**
> "The short answer is, **you can't**. Confluence is designed to be open. It's for sharing work with your team. While you can restrict a page to yourself, it's important to note that:
> - **Members of the `confluence-administrators` super group can see all spaces and pages.**…This means that even if you restrict a page to yourself, it's possible that at least one other person can see it.
> - **People with Confluence Administrator and System Administrator global permissions can't see your pages by default, but they can grant themselves space administrator permission to the space.**
> - **Space administrators always have the ability to remove page restrictions, even from pages they can't see.**"

`[DOC]` **The edit-inheritance asymmetry is a known, ticketed, unfixed defect** — CONFSERVER-5095 (§A.2.3).
`[DOC]` **No bulk tree operations** — a parent 2026 thread asks for exactly this and gets told to use groups instead.
`[DOC]` **The dialog itself warns you** — the annotated screenshot says "**Watch out: restrictions on other pages can affect this one.**"
`[DOC]` **Inheritance debugging is manual** — "You need to navigate upwards in the page tree hierarchy and investigate each of them to determine where the restrictions have been applied." `[COMM]` — and "This can be easily determined using the **Inspect Permissions** tool, but that's only available for Premium and Enterprise licenses." `[COMM]`
`[DOC]` **Request-access dead ends** — inherited restrictions suppress the request button entirely (§A.4.7).
`[DOC]` **Permission cache is known-stale** on import and directory reorder (§A.4.4).
`[DOC]` **`CONFANCESTORS` fail-open on import plugins** (§A.5.4).

### A.7.2 Community-reported (anecdotal)

`[COMM]` "Restricted by parent" is reported as a dead-end state: users cannot see *which* ancestor is responsible without walking the tree, and one reports the Share dialog offers no way to add a direct restriction in that state. — [Permissions to access restricted page](https://community.atlassian.com/forums/Confluence-questions/Permissions-to-access-restricted-page/qaq-p/3098432)

`[COMM]` Bulk tree restriction management is a top unmet need (2026): *"if we want to restrict a full page tree, we may need to manually edit the restrictions of each individual page, which is very time-consuming and error-prone."* The community-recommended workaround is **group-based permissions instead of per-page ACLs** — i.e. users route around the restriction system entirely. — [thread](https://community.atlasian.com/forums/discussion/3244261)

`[COMM]` "Restricted by parent" appearing to be unavailable in current UI (2026), causing users to conclude that parent restrictions no longer cascade; Atlassian's answer: *"there has been no change recently to how this works"* — the user had conflated "Open to View" with an inheritable restriction. — same thread

`[COMM]` Disabling page restrictions wholesale is not possible: revoking the space `Add/Delete restrictions` permission stops *new* restrictions but "doesn't remove previously added restrictions" and cannot be disabled globally. — [Disable page restrictions](https://community.atlassian.com/forums/Confluence-questions/Disable-page-restrictions/qaq-p/2664033)

`[COMM]` Confusion between `Restrict` and `Admin` space permissions — the Inspect-permissions explanation exists because people can't predict which one governs. — [Inspect permissions](https://confluence.atlassian.com/conf73/inspect-permissions-991928385.html)

`[COMM]` **B1NARY Breeze** (third-party Confluence app) documents a direct consequence: "If your page has content restrictions, please make sure to search for Breeze and give it editing permissions… open the content restrictions by clicking the **Share** button." ⇒ **automation/app principals must be explicitly added to every page's Specific access list.** This is a systemic cost of "no additive page grants": every integration must be enumerated per page. `[INFER]` In a ReBAC design, an app/automation principal granted a role at the *space* level should be sufficient — and this is a strong argument for additive page-level grants existing *somewhere* in your model.

### A.7.3 Copy / move semantics (documented gotchas)

`[DOC]` **Copy a restricted page:** "When you copy a single page, we don't automatically copy the restrictions. **If the page contains information that should be private, remember to reapply restrictions in the editor *before* you publish, to avoid notifying people who are watching the space.**" ⚠ **fail-open on copy.** "When you copy a page and all its child pages, you have the option to copy all restrictions, or skip copying restrictions on all pages."

`[DOC]` **Convert page-with-children → blog post:** "Blog posts don't have parents and can't inherit restrictions. When you convert a page with children into a blog post, child pages move to the parent's original position in the structure. **Any restrictions the child pages inherited from the parent page are removed** once the parent is converted." ⚠ **fail-open on type change.**

`[INFER]` Both are fail-open-by-default on structural operations. A ReBAC system must make `move` / `copy` / `retype` re-evaluate inherited tuples and either re-materialize them as direct tuples or hard-fail. OpenFGA makes this natural if you write `parent` as a real tuple and treat derived access as computed rather than copied.

---

# PART B — GOOGLE DRIVE

## B.0 The one-sentence model — and a correction to your premise

> **Drive's model is the mirror image of Confluence's: permissions propagate *downward and outward*, and can only ever increase. The single exception is a folder-only flag called "Limited access", which is a weak, overridable deny.**
>
> [DOC] "Access you apply to a folder is inherited by all files within it. **You can no longer give someone less access to an individual file if they have higher access to its parent folder.** If you try to do so, Drive will guide you to manage their permissions on the parent folder instead." — [Share files from Google Drive](https://support.google.com/drive/answer/2494822)

**⚠ Your stated premise — "Drive has NO folder-to-file permission inheritance" — is outdated and now false.** It described Drive before the **"Updated Sharing Model"** rollout (~2015). Since then:

`[DOC]` "**Updated Sharing Model:** Access you apply to a folder is inherited by all files within it. You can no longer give someone less access to an individual file if they have higher access to its parent folder." — [Share files from Google Drive](https://support.google.com/drive/answer/2494822)

`[DOC]` "A file inside a shared folder has the same or **higher** sharing permissions as the folder itself. If you are not the owner of the main folder, you may not be able to change these settings." — [Share folders in Google Drive](https://support.google.com/drive/answer/7166529)

`[DOC]` "When you share a folder, the files and subfolders inside are **updated with the new sharing settings**." — same

`[DOC]` "**Like items in My Drive, permissions on parent items propagate downward to their children.** However, within a shared drive, permissions are **strictly expansive**. For example, a user that has `role=commenter` for a shared drive **cannot have their access level reduced** at another point within the folder hierarchy. However, their access can be **increased** for a certain set of files." — [Shared drives overview](https://developers.google.com/workspace/api/guides/about-shareddrives) ([correct URL](https://developers.google.com/workspace/drive/api/guides/about-shareddrives))

`[INFER]` **Direction of the invariant, side by side:**

| | Confluence | Google Drive |
|---|---|---|
| Propagation | Parent → child | Parent → child |
| **View/role** | **∩ (intersect, narrowing only)** | **∪ (union, widening only)** |
| Can a child be *less* open than parent? | ✅ Yes — that's the whole point | ❌ No — "Drive will guide you to manage their permissions on the parent folder" |
| Can a child be *more* open than parent? | ❌ No — hard invariant | ✅ Yes — that is the normal case |
| Mechanism to narrow below container | Native (page restriction) | **"Limited access"** on folders only; weak + overridable |

---

## B.1 Roles

### B.1.1 Two vocabularies — API vs. UI

[Source: [Roles and permissions](https://developers.google.com/workspace/drive/api/guides/ref-roles)]

| Drive API role | Drive UI role (My Drive) | Drive UI role (shared drive) | Description (verbatim) |
|---|---|---|---|
| `owner` | **Owner** | **not allowed in shared drives** | "Grants full control over the file or folder." |
| `organizer` | — | **Manager** | "Grants the ability to manage files, folders, people, and settings." |
| `fileOrganizer` | — | **Content Manager** | "Grants the ability to contribute and manage content. **Default role for new members.**" |
| `writer` | **Editor** | **Contributor** | "Grants the ability to view the file, add comments, and edit the file. For folders, can add, edit, and delete files or subfolders within that folder." / "Can also create files within a shared drive." |
| `commenter` | **Commenter** | **Commenter** | "Grants the ability to view the file and add comments." |
| `reader` | **Viewer** | **Viewer** | "Grants the ability to view the file." |

> "The Drive API and Drive UI use the same underlying permission system. However, **the role names differ slightly** between the two."

### B.1.2 **Is `commenter` a real Drive role? — YES in v3. It was NOT in v2.**

`[DOC]` **v3** `role` enum: `owner`, `organizer`, `fileOrganizer`, `writer`, **`commenter`**, `reader`.
`[DOC]` **v2** `role` enum: `owner`, `organizer`, `fileOrganizer`, `writer`, `reader` — **no `commenter`**. Instead v2 had a separate `additionalRoles[]` array: *"Only `commenter` is currently allowed, though more may be supported in the future."* — [v2 permissions](https://developers.google.com/workspace/drive/api/reference/rest/v2/permissions)

`[INFER]` Historically "Commenter" was modeled as `writer`-lite-as-additional-role, then retrofitted as a **primary** role in v3. **Design lesson: `commenter` is a first-class role in the same ordered lattice as reader < commenter < writer, not a modifier.** If you model it as a boolean `can_comment` alongside `can_edit`, you will get the same v2 awkwardness.

### B.1.3 The full API operation matrix (extracted verbatim from the rendered tables)

**Files and folders** — [ref-roles](https://developers.google.com/workspace/drive/api/guides/ref-roles) (`when the role isn't restricted to a view`):

| Permitted operation | `owner` | `organizer` | `fileOrganizer` | `writer` | `commenter` | `reader` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Read the metadata (such as name, description) of the file or folder | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Read the content of the file | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Read the list of items in the folder | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Add comments to the file** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Modify the metadata of the file or folder | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Modify the content of the file | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Access historical revisions | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Add items to the folder | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Remove items from the My Drive folder** | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Share items from the My Drive folder** | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Can access detailed file permissions** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Move items into the trash | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Recover items from the trash | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Empty the trash | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Delete a file or folder | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Add a content restriction to a file in a My Drive folder | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Set or unset the limited access setting in My Drive folders** | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |

**Shared-drive-specific operations:**

| Permitted operation | `owner` | `organizer` | `fileOrganizer` | `writer` | `commenter` | `reader` |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Share a shared drive item | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Add files to shared drives | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Modify the metadata of a shared drive | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Add shared drive members | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Reorganize items within a shared drive [1] | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Move items outside of a shared drive [2] | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Delete items in shared drives [2] | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Delete an empty shared drive | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Add a content restriction to a file in a shared drive | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Set or unset the limited access setting in shared drive folders** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |

> **[1]** Requires the `organizer` or `fileOrganizer` role **on a direct or indirect parent**, as opposed to the role being present on the item.
> **[2]** Requires the `organizer` role **on a direct or indirect parent**, as opposed to the role being present on the item.

`[INFER]` **Two crucial reads for a ReBAC design:**

1. **"Can access detailed file permissions" is an explicit, role-gated capability: `owner`/`organizer`/`fileOrganizer`/`writer` = YES; `commenter`/`reader` = NO.** This is the exact primitive you asked about — *who can see the ACL* is a **first-class relation**, not a UI affordance. Model it as `can_read_acl` distinct from `can_view`.
2. The footnotes reveal **contextual (ancestor-derived) authorization**: reorganize/delete/move-out are authorized by the role on an *ancestor*, not on the object. That is a genuine contextual-rebac pattern (OpenFGA: `actor` + `parent_folder#organizer` as a condition on the `reorganize` relation) and is not something a naive `Check(user, "reorganize", file)` expresses.

### B.1.4 The user-facing matrix (My Drive)

[Source: [Share files from Google Drive](https://support.google.com/drive/answer/2494822)] — *"Important: The roles below apply to files in My Drive."*

| Permission Level | Can View? | Can comment? | Can edit? | Can download? | Can share? | Can change permissions? |
|---|---|---|---|---|---|---|
| **Viewer** | Yes | No | No | **Yes, by default. The owner can control it.** | No | No |
| **Commenter** | Yes | Yes | No | **Yes, by default. The owner can control it.** | No | No |
| **Editor** | Yes | Yes | Yes | Yes | **Yes, but an editor can't change the owner.** | **Yes, by default. The owner can control it.** |
| **Owner** | Yes | Yes | Yes | Yes | Yes | Yes |

Two orthogonal **delegation** toggles, not roles:
- **"Editors can change permissions and share"** (Share ▾ → Settings)
- **"People who can download, copy, and print"** — per-role checkboxes for Viewers / Commenters / Editors

`[DOC]` ⚠ "If you uncheck 'Editors can change permissions and share' on a specific file, permission changes made to the **parent folder** still apply to that file. The parent folder's permissions are the primary source of truth for access." ⇒ **this is a delegation control, not an access control.** Do not confuse it with a role.

### B.1.5 Shared-drive UI matrix

[Source: [How file access works in shared drives](https://support.google.com/a/users/answer/12380484?hl=en)]

| Permission (UI) | Manager | Content manager | Contributor | Commenter | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| Can view files and folders | ✅ | ✅ | ✅ | ✅ | ✅ |
| Can comment on files | ✅ | ✅ | ✅ | ✅ | ❌ |
| Can edit files | ✅ | ✅ | ✅ | ❌ | ❌ |
| Can create and add files, can create folders | ✅ | ✅ | ✅* | ❌ | ❌ |
| Can add and remove people and groups on **specific files** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Can set limited access to folders** | ✅ | ❌ | ❌ | ❌ | ❌ |
| Can restore files from Trash (≤30 days) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Can move files from My Drive to a shared drive | ✅ | ✅ | ✅ | ❌ | ❌ |
| Can move files/folders to Trash | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Can move files and folders within a shared drive** | ✅ | ✅ | ❌ | ❌ | ❌ |
| Can add/remove people and groups on **folders** | ✅ | ✅** | ❌ | ❌ | ❌ |
| Can move folders from My Drive to a shared drive | ✅ | ❌ | ❌ | ❌ | ❌ |
| Can move files from one shared drive to another | ✅ | ❌ | ❌ | ❌ | ❌ |
| Can add or remove members of a shared drive | ✅ | ❌ | ❌ | ❌ | ❌ |
| Can change member access levels | ✅ | ❌ | ❌ | ❌ | ❌ |
| Can permanently delete files in Trash | ✅ | ❌ | ❌ | ❌ | ❌ |
| Can rename or change theme | ✅ | ❌ | ❌ | ❌ | ❌ |
| Can delete the shared drive | ✅ | ❌ | ❌ | ❌ | ❌ |

\* "In Google Drive for desktop or files in the Chrome OS Files app, Contributor access gives only read access to files."
\** "only if the shared drive's Manager allows it" (`sharingFoldersRequiresOrganizerPermission`)

`[INFER]` **Note the role is not a single scalar.** `Contributor` can add/remove people **on specific files** but not on folders, and cannot move items within the drive, while `Content manager` can do both. This is a **capability set, not a rank** — model roles as sets of capability tuples, exactly as Confluence's space permissions are an additive set.

### B.1.6 Who may share what (prerequisites)

[Source: [Share files, folders, and drives](https://developers.google.com/drive/api/guides/manage-sharing)]

| Action | Minimum role |
|---|---|
| Share a file in **My Drive** | `writer` or `owner`; **`owner` only if `writersCanShare=false`** |
| Share a folder in **My Drive** | `writer` or `owner`; `owner` only if `writersCanShare=false` |
| Share a file in a **shared drive** | `writer`, `fileOrganizer`, or `organizer` |
| Share a **folder** in a shared drive | `organizer`; `fileOrganizer` if `sharingFoldersRequiresOrganizerPermission=false` |
| Manage shared drive **membership** | `organizer`. "Only users and groups can be members of shared drives." |

> "1. The `writersCanShare` boolean value **doesn't apply to items in shared drives.** It's treated as if it's always set to `true`.
> 2. If the `sharingFoldersRequiresOrganizerPermission` restriction on a shared drive is set to `false`, users with `role=fileOrganizer` can share folders in that shared drive."

---

## B.2 Sharing state — the three lists

### B.2.1 What each list shows

| List | Direction | Contents | Citation |
|---|---|---|---|
| **"Shared with me"** | **INBOUND** | "Files shared with you. Folders shared with you. **Files shared with a link that you have opened.**" Shows: "The date the file was shared with you. The owner of the file. The document type." → `Organize > Add shortcut` | [Find files shared with you](https://support.google.com/drive/answer/2375057) |
| **"Shared by me"** | **OUTBOUND** ← *this is the one you asked about* | Files **you** shared with others | ⚠ see §B.2.2 |
| **"Shared drives"** | Container membership | Shared drives you are a member of | [shared drives](https://support.google.com/a/answer/7212025) |

> **✅ Answer: "Shared by me" is the outbound view — the things I gave other people access to.**

⚠ Important nuance `[COMM/inference]`: "Shared by me" is **shares you created**, not "items you administer." The LibreGraph spec makes this explicit: `/me/drive/sharedByMe` *"only includes shares created by the current user, **not all shares he can manage**, eg. in project spaces."* `[INFER]` So an Editor who reshares, or a Content Manager who grants access inside a shared drive, does **not** see that item in "Shared by me." If your outbound audit view is supposed to be "everything I have authority over," Drive's semantics will surprise you.

### B.2.2 ⚠ There is NO `sharedByMe` API. Drive v3's search terms are asymmetric.

[Source: [Search query terms and operators (v3)](https://developers.google.com/workspace/drive/api/guides/ref-search-terms)] — the *complete* documented term set relevant here:

| Term | Meaning (verbatim) |
|---|---|
| `sharedWithMe = , !=` | "Files that are in the user's **'Shared with me'** collection. **All file users are in the file's Access Control List (ACL).** Can be either true or false." |
| `visibility = , !=` | "The visibility level of the file. Valid values are **`anyoneCanFind`, `anyoneWithLink`, `domainCanFind`, `domainWithLink`, and `limited`**. Surround with single quotes." |
| `owners in` | "Users who own the file." |
| `writers in` | "Users or groups who have permission to modify the file. See the permissions resource reference." |
| `readers in` | "Users or groups who have permission to read the file. See the permissions resource reference." |
| `parents in` | "Whether the parents collection contains the specified ID." |

**Critically: there is no bare `shared` search term, and no `ownedByMe` or `sharedWithMeTime` search term.** Those are *response fields* (§B.7), not query operators.

`[INFER]` **So to build "Shared by me" on Drive v3 you must approximate it**, e.g.:
```
q = "owners in '<me>' and trashed = false"      # then post-filter by shared / visibility
q = "writers in '<me>' and owners in 'me'"       # reshares
```
This is a well-known pain point — Google has never shipped a symmetric pair of endpoints, and Microsoft's Graph **has** both (`/me/drive/sharedWithMe` and `/me/drive/sharedByMe`), which is why the LibreGraph/ownCloud effort exists. **If your design doc needs a first-class outbound ACL view, you must build it; neither reference system gives it to you for free.**

`[DOC]` Also note: "The `owners`, `writers`, and `readers` terms are **indirectly reflected in the permissions list** and refer to the **role on the permission**." ⇒ `writers in 'x'` will match a principal whose *effective* role came from a **shared-drive membership** or an **inherited folder grant**, not just from a direct permission on the file. This is the query-side mirror of the monotonic-widening rule.

### B.2.3 The `shared` field's own carve-out (a trap)

[Source: [REST Resource: files (v3)](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)]
> `shared` (boolean) — Output only. "Whether the file has been shared. **Not populated for items in shared drives.**"
> `ownedByMe` (boolean) — Output only. "Whether the user owns the file. **Not populated for items in shared drives.**"
> `owners[]` — "The owner of this file. Only certain legacy files may have more than one owner. **This field isn't populated for items in shared drives.**"
> `permissions[]` — "The full list of permissions for the file. **This is only available if the requesting user can share the file. Not populated for items in shared drives.**"

`[INFER]` **`shared` / `ownedByMe` / `owners` / `permissions` are all silently absent for shared-drive items.** The "who has access" surface for shared drives must be reconstructed from the **Drive (resource)** membership plus `permissionDetails[].permissionType ∈ {file, member}`. This is exactly the "membership vs. file-grant" duality that Confluence has no analogue for.

---

## B.3 Inheritance, and how Drive compensates for the missing narrowing

### B.3.1 The monotonic-widening rule, verbatim from four sources

1. "Access you apply to a folder is inherited by all files within it. **You can no longer give someone less access to an individual file if they have higher access to its parent folder. If you try to do so, Drive will guide you to manage their permissions on the parent folder instead.**" — [2494822](https://support.google.com/drive/answer/2494822)
2. "**A file inside a shared folder has the same or higher sharing permissions as the folder itself.** If you are not the owner of the main folder, you may not be able to change these settings." — [7166529](https://support.google.com/drive/answer/7166529)
3. "When you share a folder, the files and subfolders inside are updated with the new sharing settings." — [7166529](https://support.google.com/drive/answer/7166529)
4. "Within a shared drive, permissions are **strictly expansive**… a user that has `role=commenter` for a shared drive cannot have their access level reduced at another point within the folder hierarchy. However, their access can be **increased** for a certain set of files." — [about-shareddrives](https://developers.google.com/workspace/drive/api/guides/about-shareddrives)

And the bluntest statement, in a shared drive:
> "**To remove access for shared drive members, you need to move the file or folder out of the shared drive, which requires Manager access.**" — [12380484](https://support.google.com/a/users/answer/12380484)

And on move, the *inverse* property:
> "**Indirect file permissions inherited from parent folder permissions aren't copied.** For example, if someone had a folder in My Drive shared with them, but not a file, if files from that folder are moved to a shared drive that person can lose access unless they're a member of the shared drive." — same
> "Moving a folder to a shared drive: **All members of the shared drive can view the contents of the folder, including previously hidden files.**" — same

`[INFER]` **The "move" operation is a privilege-escalation and privilege-revocation event simultaneously.** Moving a tree into a shared drive broadens access for all members and revokes inherited access for non-members. Your design doc needs a first-class, *previewable* "reparent" operation: `POST /reparent {target, dryRun: true} → {gained: [...], lost: [...]}`.

### B.3.2 Drive's compensation: **"Limited access"** (folders only)

[Source: [Learn about limited access to files and folders](https://support.google.com/drive/answer/14254362)]

**UI path:** right-click folder → **Share** → **Share settings** (Settings) → toggle **Limit access** → **Back** → manage the user list.

**Hard constraint [DOC]:**
> "**You can only turn on the 'Limited access' setting for folders.**"
> "In some cases, Drive automatically applies the 'Limited access' setting to an individual file as part of a system-wide update. **You can't apply limited access to an individual file yourself.**"
> "**If you turn off the limited access automatically applied to a file, you can't add it back.** You can always turn limited access on and off for folders."

`[INFER]` **This is the single most awkward primitive in either system**: a user-visible, security-relevant, irreversibly-lost setting, applied to an object class the user cannot manually target, by an automated system, with no undo. If you implement any narrowing flag, make it manually-appliable at every level and always reversible.

**Who may toggle it [DOC]:**

| | Toggle Limit access on/off | Manage the user list on a limited-access item |
|---|---|---|
| **My Drive** | Folder owners. Also editors **if "Editors can change permissions" is on**. | Item owners **always**. Also editors if that setting is on. |
| **Shared drives** | **Managers only** | Managers **always**. Also Content Managers **if "Allow content managers to share folders" is on**. |

**Drive-for-desktop divergence [DOC]:** "Folder Owners in My Drive and Managers in shared drives **cannot** change the limited access settings or who has access to a folder. Content Managers in shared drives also cannot make these changes. If a limited-access folder isn't shared with someone, **they won't see it at all.**" `[INFER]` **The same user's effective ACL differs by client.** Your API must be the source of truth and your UI must not pretend the desktop client is equivalent.

### B.3.3 ⚠ The "Access removed" list and its precedence — the most surprising rule in either system

[Source: [14254362](https://support.google.com/drive/answer/14254362)]

> **"Important: The 'People with access' list and 'General access' settings always override the 'Access removed' list. If someone is on the 'Access removed' list, they can still open the file if they are part of a group with access or if the file has general access."**

> "When you apply limited access to a folder, the sharing dialog may show an **'Access removed'** section. This list shows individuals or groups who have access to a parent folder but are **specifically blocked** from access to the limited access folder."

> "To give a person or group access again: …Under the '**Access removed**' section, locate the person's name. Click **Add** to change their role. …**Their new role doesn't need to match the access they have to the parent folder.**"

> "**In shared drives:** You can't remove access for managers of the shared drive. **In My Drive:** You can't remove the owner's access to the item."

> "To find a complete picture of who can access your file, always check **both** the 'People with access' list and the 'General access' setting."

`[INFER]` **Precise precedence, highest wins:**
```
1. type=anyone / domain grant (General access)      ← beats everything below
2. direct grant to user or group (People with access) ← beats Access removed
3. shared-drive membership
4. inherited folder grant
   ── crossed by ──
5. "Access removed"  (subject ∈, but direct/group/general also ⇒ access WINS)
```

`[INFER]` **"Access removed" is a deny that loses to any direct grant, any group membership, and any link grant.** It is best modeled as a **negative relation on the (subject, object) pair that is only consulted if no positive edge exists** — i.e. it is *not* a deny in the OpenFGA sense (where denies typically win). In ReBAC terms: `Access removed: subject -[removed]-> folder`, and your check is `positive_grant_exists ? allow : (removed ? deny : deny)`. **Any model where deny-wins will diverge from Drive here.** Conversely, Confluence's model has no deny relation at all — its "deny" is the *absence* of an allow. Both are defensible; they are just different, and mixing them silently is how you get a security bug.

### B.3.4 Metadata visibility — Drive's "you can see it but not open it"

| State | What a non-permitted user sees | Citation |
|---|---|---|
| Manually limited-access folder | "**it will look grayed out, and they can't open it**" — but "**Everyone with access to the parent folder can find folders with limited access**" (including shared-drive Content Managers, Contributors, Commenters, Viewers) | 14254362 |
| Auto-applied limited access | "people without permission **will not see the folder at all**" | 14254362 |
| Move into shared drive | "**including previously hidden files**" | 12380484 |
| Android | Same as desktop (grayed out) | 14254362 |

API representation: `view=metadata` + `role=reader` on a folder = "The item is only visible to the `metadata` view because the item has limited access **and the scope has at least read access to the parent**. The `metadata` view is only supported on folders." — [permissions v3](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions)

> "**A permission with `view=published` and `role=reader` grants `reader` access to the published view of the file, but it doesn't grant `reader` access to the file.**"
> "Conversely, **any permission that's not restricted to a particular view, grants `reader` access to the published view of the file.**" — [ref-roles § Views](https://developers.google.com/workspace/drive/api/guides/ref-roles)

`[INFER]` **`view` is a second, orthogonal axis to `role`.** This is the cleanest model in either system and directly maps to ReBAC: `role=reader` × `view=metadata` ≈ your `can_view_metadata` vs `can_view_content`. Note the leak: **the folder *name* is visible to everyone with parent access.** Confluence, by contrast, hides restricted pages from the tree entirely (§A.5.3). Different threat models — Confluence assumes hostile insiders; Drive assumes organizational trust with a hidden-subfolder convention.

### B.3.5 The official recommendation for narrowing

[Source: [2494822](https://support.google.com/drive/answer/2494822)]
> "**If you need to give different permissions for a specific file or subfolder, the best approach is to create a subfolder with limited access and share it only with the necessary people.** Learn how to limit access to folders."

And, on granting finer-grained access on a shared file:
> "If you change the settings to share a specific file with someone who has a higher access to the folder, **you can give the same permissions to the entire folder** for your specific file."
> "For all items, most users choose to **update the parent folder's access** to keep permissions simple and easy to manage."

`[INFER]` Google has explicitly conceded that the narrowing story is bad, and its guidance is "create a subfolder with limited access." That is a **containment-based** model (like Unix `chmod` on directories + a firewall rule), not a **grant-based** one. Note this is precisely the shape a ReBAC system can do *correctly* with per-node grants — an opportunity, not a constraint.

---

## B.4 The Share dialog

### B.4.1 Exact control and section names

| Element | Exact name | Source |
|---|---|---|
| Primary button | **Share** | 2494822 |
| Overflow | **Share ▾** → submenu: **Share**, **Share settings** (labelled **Settings**), **Copy link**, **Email collaborators**, **Publish** | 2494822, 2494893 |
| Named-permission list | **"People with access"** | 2494822 ("In the Sharing dialog, next to 'People with access,' click **Email people on this file**") |
| Per-person dropdown | **Viewer** / **Commenter** / **Editor** (+ **Remove access**) | 2494822, 2494893 |
| Public/link section | **"General access"** | 2494822 ("Under 'General access', click the Down arrow") |
| Exclusion list (limited access) | **"Access removed"** | 14254362 |
| Settings panel | **"People who can download, copy, and print"** (role checkboxes) · **"Editors can change permissions and share"** | 2494893 |
| Expiry | **"Add expiration"** → **"Access expires"** | 2494893 |
| Notification | **"Email collaborators"** / **"Email people on this file"** | 2494822 |
| Grouping | `Organize > Add shortcut` | 2375057 |
| Info panel | Right-click → **More** → **File information** → **Details** → **Manage access** | 2494893 |

### B.4.2 "General access" — the three documented values

[Source: [2494822 § "Change the general access for your file"](https://support.google.com/drive/answer/2494822)]

| UI value | Definition (verbatim) | API `visibility` |
|---|---|---|
| **Restricted** | "**Only people with access can open the file.**" | `limited` |
| **Anyone with the link** | "Anyone who has the link can use your file, without signing in to their Google Account." | `anyoneWithLink` |
| *(work/school only)* **Public** | "**Anyone can search on Google and get access to your file**, without signing in to their Google Account." | `anyoneCanFind` |
| *(work/school only)* domain-audience | "you can choose to only share files and folders with a **specific audience, like your department**. When you hover over the group name, you can find a description of each audience." | `domainWithLink` / `domainCanFind` |

⚠ **Naming inconsistency to be aware of [DOC]:** in the *general access* dropdown, Google labels the non-link org-wide option "**Public**" and describes it as "anyone can search on Google" — which collides with common usage of "public" meaning "anyone with the link." In the *publishing* dialog, "public" means published-to-web. `[INFER]` If you copy this vocabulary you will reproduce this confusion. Prefer explicit labels: `Restricted` / `Anyone with the link` / `Anyone in <org> who can search`.

**Role under General access:** "To decide what role people will have, select **Viewer, Commenter, or Editor**." — i.e. `type=anyone` or `type=domain` grants carry a role too, and can be Commenter or Editor. `[INFER]` **Link-shared *editing* is a real, supported state** (with a well-known exfiltration risk), and it is *not* blocked by "Editors can't change permissions." Note the API also exposes `allowFileDiscovery` (searchability of a `domain`/`anyone` grant) as a separate axis from `role`.

### B.4.3 The **owner** field's visibility — the precise answer

`[DOC]` "**When you share a link to a file, your name and email will be visible as the owner of that file.**" — [2494822 § Important]
`[DOC]` "A panel opens and shows **who owns and has access to the file**. If you have permission to make changes, click **Manage access**." — [2494893]
`[DOC]` "**When you transfer ownership of a folder, the files inside keep their original owner.**" — [7166529]
`[INFER]` "when you share a link" is a generalization — owner PII is exposed to anyone who can obtain the link, independent of `General access`. There is **no "hide owner" option** in Drive. Contrast Atlassian, which has `Configure your email visibility` and a per-user email-visibility setting — the two products disagree fundamentally on whether the owner is public metadata.
`[DOC]` ⚠ Sign-out visitors: "**People who aren't signed in to a Google Account show up as anonymous animals in your file.**" — [2494822]. `[INFER]` A link-shared file therefore accumulates unresolvable actor rows. If you model principals, you need an `anonymous` principal type with an opaque per-session id, exactly as Confluence models `anonymous users` as a space-permission subject (but see §A.5.1: **Confluence has exactly one anonymous principal**, Drive has unbounded synthetic ones).

### B.4.4 Requests surface

`[DOC]` "**Tip:** If you open a document and there's a **dot** next to 'Share', it means you have a **share request**." — [2494822]
`[DOC]` Routing: "When someone requests access to a shared drive or membership, **the request is sent to those with Manager access**. When someone requests access to a file or folder, **the request is sent to the item's creator. If that person doesn't have permission to share the file or folder, the request goes to members with Manager access.**" — [12380484]
`[INFER]` Drive's request routing is **2 hops, deterministic, and content-item-scoped**. Confluence's is up to 5 recipients, heuristic, and page-scoped with a dead-end case. Drive's is the better design; Confluence's is the better UX (real-time flag + Approve/Deny in context). **Combine them.**

---

## B.5 Who can see the ACL

### B.5.1 The rule, at the API level — explicit and role-gated

`[DOC]` The role matrix row: **"Can access detailed file permissions"** — `owner` ✅, `organizer` ✅, `fileOrganizer` ✅, `writer` ✅, `commenter` ❌, `reader` ❌.

`[DOC]` `files.permissions[]`: "Output only. The full list of permissions for the file. **This is only available if the requesting user can share the file.** Not populated for items in shared drives."

`[INFER]` **So the precise rule is: you can read the ACL iff you can share the item (writer-or-above in My Drive; writer/fileOrganizer/organizer in a shared drive).** A `commenter` or `reader` cannot enumerate who else has access via the API. This is a **capability relation, not a role check** — and it means the ACL read is itself gated by a *different* relation than the read it describes.

### B.5.2 Restricted vs. link-shared — the visibility of the ACL

| Case | Who can discover the ACL? |
|---|---|
| `visibility = limited` (Restricted) | Only principals with a grant. Everyone else gets a permission error and learns nothing. |
| `visibility = anyoneWithLink` / `anyoneCanFind` | Anyone can *open* the file. Whether the *Share dialog* is reachable — and thus whether the collaborator list is visible — is not stated in the docs. `[INFER]` Historically the Share dialog is reachable and the list is visible to anyone who can open the file, which is why Google's public-link guidance warns separately. **Verify empirically.** |
| `visibility = domainWithLink` | Domain members with the link; same ambiguity. |

`[DOC]` Direct support for the "restricted ⇒ undiscoverable" case: for a limited-access folder, "people without permission… **will not see the folder at all**" and "if you can't open a limited access folder, it means you aren't included in the permissions for that folder." Nothing about who may see the *list*.

`[INFER]` **Structural difference from Confluence worth calling out in your design doc:**

| | Confluence | Drive |
|---|---|---|
| Who can see the ACL? | Anyone with page **view** (via `People who can view`) — *if the site admin enabled it* | Anyone with **write** (capability-gated) |
| Who can see it when you **don't** have access? | **Space admins** (restricted-pages list); **confluence-administrators** (all content) | **Nobody** (except Workspace admins via `useDomainAdminAccess`, and Managers for shared drives) |
| Can the feature be disabled? | **Yes** — site-wide toggle | Not documented |
| Scope of computation | Full materialized expansion (groups + ancestors + superusers) | Flat per-item list; inheritance is *materialized onto children*, not computed |

`[INFER]` **Neither system gives you "show me the effective ACL for a user" and "show me the ACL for an item I can't see" in one consistent surface.** Confluence separates them (People who can view vs. Restricted Pages); Drive separates them too (ACL vs. admin tooling). Your design should unify: one `access-explorer` endpoint with an explicit `(actor, object, mode)` where `mode ∈ {my_access, effective_acl, grant_history}` and the authorization for each mode is its own relation. Name the modes in the UI so nobody is surprised.

---

## B.6 Removing access / "stop inheritance"

### B.6.1 Removing a direct grant

`[DOC]` [2494893](https://support.google.com/drive/answer/2494893):
> **Stop sharing a file or folder:** 1. Find the file or folder… 2. Click **Share**… 3. **Find the person you want to stop sharing with.** 4. **To the right of their name, click the Down arrow and then Remove access.** 5. Click **Save**.

### B.6.2 ⚠ The redirect to the parent — the enforcement mechanism

`[DOC]` Three separate documented statements:
> "**If you remove or reduce access for a person who has access to the item's folder, the permission is either removed or changed for the entire folder.**" — 2494893 § Important
> "**When you update permissions for an item in My Drive, you may be prompted to manage permissions for the folder it's in.** This happens if you try to give someone less access to the item than they inherit from the parent folder. This ensures consistent access across the entire folder." — 2494893 § Tips
> "**If you change the settings to share a specific file with someone who has a higher access to the folder, you can give the same permissions to the entire folder for your specific file.**" — 2494822 § Tips

`[INFER]` **Drive cannot express the user's intent, so it escalates the intent to the parent.** This is the single most important UX anti-pattern to avoid: the system silently changes the *scope* of your action, because the scope you asked for is unrepresentable. `[INFER]` A ReBAC system must do the opposite — represent the intent exactly (per-node tuple) and never mutate ancestors as a side effect of a descendant edit. **This is Confluence's structural advantage, and it is the strongest argument for a Confluence-style model over a Drive-style one for a knowledge base.**

### B.6.3 The one place a child CAN narrow: `General access = Restricted`

`[DOC]` [2494893](https://support.google.com/drive/answer/2494893) § "Restrict general access for a file or folder":
> "When you change an item's general access to **Restricted**, only people with access can open the file. **This overrides inherited parent folder permissions.**"

`[INFER]` **This is a genuine, documented exception to monotonic widening, and it exists because link/public grants are a different axis from principal grants.** The parent's "anyone with link" is a *public* grant; setting the child to `limited` removes the public reach while leaving all principal grants intact. So:

- **Principal grants (`user`/`group`/`domain` members):** monotonic ∪, cannot narrow.
- **Public/link grants (`anyone`):** can be narrowed at any level via `visibility=limited`.

That is a coherent model, but it means Drive's monotonicity claim holds *per grant type*, not globally. **Model `visibility` as a separate relation from the principal ACL**, or you will reproduce the confusion.

### B.6.4 Shared drives: no removal at all

`[DOC]` [12380484](https://support.google.com/a/users/answer/12380484):
> "Just like in My Drive, you can remove someone's access to a file or folder in a shared drive that's **directly shared with them**. **All members of the shared drive can still at least view the file or folder, unless that folder has limited access.** To remove access for shared drive members, **you need to move the file or folder out of the shared drive, which requires Manager access.**"
> "**When you remove a member from a shared drive, they also lose access to any files and folders in the shared drive that were directly shared with them.**"

`[INFER]` **Removing a member is the *only* atomic deny-all operation in Drive, and it is scoped to the container, not the item.** Its blast radius is defined by `permissionType ∈ {file, member}`: you kill all the `file`-type grants and the `member` tuple, in one move. That's a clean, implementable, atomic "revoke everything for this principal under this container" — worth having in a ReBAC design as a first-class `revoke_subject(container, subject)`.

### B.6.5 Delegation removal ≠ access removal

`[DOC]` "**Important:** If you share a file with people, **the owner and anyone with edit access can change sharing permissions and share the file.**" · "As the owner of the file, you can remove **Editors' ability to change permissions or share the file**" via unchecking "Editors can change permissions and share."

`[INFER]` `writersCanShare=false` is a **delegation** control, matching the API prerequisite table (§B.1.6): "To share a file in My Drive, the user must have `role=writer` or `role=owner`. **If the `writersCanShare` boolean value is set to `false` for the file, the user must have `role=owner`.**" `[INFER]` It does not remove the editor's ability to *edit*, and it does not survive a parent-folder share (documented in §B.1.4). Two distinct relations: `can_share` (delegable) vs `can_edit`.

### B.6.6 Post-removal consequences

`[DOC]` "If you delete a shared file **that you own**: People that can view, comment, or edit **can make a copy of the file until you permanently delete it**." · "If you delete a shared file **that you don't own**: The file will be removed from your Drive, but **other collaborators can still access it**."
`[DOC]` `trashed`: "Whether the file has been trashed… **Only the owner may trash a file, but other users can still access the file in the owner's trash until it's permanently deleted.**" — [files v3](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
`[INFER]` **Removal is not revocation, it is unfinding.** Three separate "copies escape" paths (copy, untrash-by-owner-of-view, parent-trash). Any revocation story must state its copy semantics explicitly.

---

## B.7 The Drive API v3 — field taxonomy

### (a) File-level ACL fields — `files` resource

[Source: [REST Resource: files (v3)](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)]

| Field | Type | Access | Verbatim doc |
|---|---|---|---|
| `permissions[]` | `Permission[]` | **Output only** | "The full list of permissions for the file. **This is only available if the requesting user can share the file. Not populated for items in shared drives.**" |
| `owners[]` | `User[]` | **Output only** | "The owner of this file. **Only certain legacy files may have more than one owner. This field isn't populated for items in shared drives.**" |
| `shared` | boolean | **Output only** | "Whether the file has been shared. **Not populated for items in shared drives.**" |
| `viewersCanCopyContent` | boolean | — | **⚠ DEPRECATED.** "**Deprecated: Use `copyRequiresWriterPermission` instead.**" |
| `copyRequiresWriterPermission` | boolean | mutable | The replacement for the above. `[INFER]` **The same field name also exists on `Drive.restrictions`** (§d) — i.e. the same logical policy at file *and* shared-drive level, which is how Drive expresses multi-level restriction without a real ACL. |

`[INFER]` Note that **`shared`, `ownedByMe`, `owners`, and `permissions` are all `shared == false`/absent for shared-drive items** — this is the single biggest gotcha when writing Drive integrations.

### (b) Caller-relative fields — *not* ACL

⚠ **These describe the requesting user's relationship to the item. They are not part of the ACL and must not be modeled as such.**

| Field | Type | Verbatim doc |
|---|---|---|
| `ownedByMe` | boolean | Output only. "**Whether the user owns the file.** Not populated for items in shared drives." |
| `sharedWithMeTime` | RFC 3339 | Output only. "**The time at which the file was shared with the user**, if applicable." |
| `sharingUser` | `User` | Output only. "**The user who shared the file with the requesting user**, if applicable." |
| `viewedByMeTime` | RFC 3339 | Output only. "The last time the file was viewed by the user." |
| `modifiedByMeTime` | RFC 3339 | Output only. "The last time the file was modified by the user." |
| `starred` | boolean | "Whether the user has starred the file." |

⚠ **All three of `ownedByMe`, `sharedWithMeTime`, `sharingUser` are "Shared **with** me" fields. There are no "Shared **by** me" per-item fields.** See §B.2.2.

### (c) The `Permission` resource

[Source: [REST Resource: permissions (v3)](https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions)]

```
Permission {
  id: string
  type: "user" | "group" | "domain" | "anyone"
  emailAddress: string            // output only
  role: "owner"|"organizer"|"fileOrganizer"|"writer"|"commenter"|"reader"
  displayName: string             // "user" → full name; "group" → group name;
                                  // "domain" → "cymbalgroup.com";
                                  // "anyone" → NO displayName is present
  photoLink: string               // output only
  deleted: boolean                // output only; user/group only
  pendingOwner: boolean           // output only; user only; NOT in shared drives
  expirationTime: string          // user/group only; future; ≤ 1 year
  allowFileDiscovery: boolean     // domain/anyone only
  domain: string                  // output only
  view: "published" | "metadata"  // "published" → role is publishedReader
                                  // "metadata"  → limited-access folder; folders only
  kind: "drive#permission"        // output only, fixed
  inheritedPermissionsDisabled: boolean

  permissionDetails[]: {          // OUTPUT ONLY
    permissionType: "file" | "member"
    inheritedFrom: string         // "The ID of the item from which this
                                  //  permission is inherited.
                                  //  THIS IS ONLY POPULATED FOR ITEMS IN SHARED DRIVES."
    role: <same enum>
    inherited: boolean            // "This field is always populated."
  }
  teamDrivePermissionDetails[]:   // ⚠ DEPRECATED → use permissionDetails
    // teamDrivePermissionType → permissionDetails/permissionType
    // inheritedFrom            → permissionDetails/inheritedFrom
    // role                      → permissionDetails/role
    // inherited                 → permissionDetails/inherited
}
```

`[INFER]` **`permissionDetails` is the provenance record, and it is the most directly useful artifact here for a ReBAC design.** `permissionType ∈ {file, member}` distinguishes *direct file grant* from *shared-drive membership*; `inheritedFrom` names the granting ancestor; `inherited` is the boolean. Drive's model is **expansive**, so `inherited=true` with a `role` that is *higher* than the item's own is the norm — there is no `inherited=true` meaning "narrowed."

`[DOC]` `inheritedPermissionsDisabled`: "**When `true`, only organizers, owners, and users with permissions added directly on the item can access it.**"
`[INFER]` ⚠ **This is the only "break inheritance" primitive in either system**, and it is worth studying precisely because it is the *opposite* of Confluence's:
- It **narrows** by cutting inherited membership (it never *grants* anything).
- It is **safe by construction**: it cannot make a child more open than its parent, so it does not violate Drive's monotonic invariant.
- It has an **odd self-reference**: the party who can set it (`writer`+ per the matrix) is *more* privileged than most of the people it excludes, and the role check for reorganizing is itself evaluated on the **ancestor**, not the item (footnotes [1]/[2] of the shared-drive matrix).
- `[INFER]` In OpenFGA this is naturally a condition on the check, e.g. `check(actor, "view", folder) && (ancestor_flag == false || exists direct tuple)`. You cannot express it as a plain tuple without a computed/conditioned relationship — which is precisely why Drive keeps it as a boolean flag on the item.

### (d) Resource-level — the `Drive` resource (= a shared drive)

[Source: [REST Resource: drives (v3)](https://developers.google.com/workspace/drive/api/reference/rest/v3/drives)]

```
Drive {
  id, name, createdTime, hidden, orgUnitId, colorRgb, backgroundImageFile
  driveThemes         // write-only on create
  restrictions: {
    copyRequiresWriterPermission: boolean
    domainUsersOnly: boolean
    driveMembersOnly: boolean
    adminManagedRestrictions: boolean
    sharingFoldersRequiresOrganizerPermission: boolean
    downloadRestriction: DownloadRestriction
  }
  organizerCount, memberCount   // "The values for these fields can decide
                                //  who can access the shared drive."
  // DriveList also has ownedByMe
}
```

`[INFER]` **This is the cleanest "resource-level vs. file-level" split in either system, and it reveals Drive's actual architecture:** inheritance is *not* modeled as a parent→child ACL relation. It is modeled as **a container-level policy bag (`Drive.restrictions`) plus a container-level role assignment (the `member` permission)**, with the effective role per item computed as the max over the chain. `[INFER]` That is a "capability inheritance" model, structurally closer to Kubernetes RBAC + a mesh than to an ACL — and it is exactly why Drive can enforce monotonic widening *without* a per-item inherited-permission table (except that it *does* materialize them: "When you share a folder, the files and subfolders inside are updated with the new sharing settings").

### (e) Request parameters

| Param | Method | Meaning |
|---|---|---|
| `supportsAllDrives` | `files.*`, `permissions.*` | Operate on shared drives too |
| `useDomainAdminAccess` | `permissions.list` | "Issue the request as a **domain administrator**; if set to true, then the requester **will be granted access** if the fileId parameter refers to a shared drive and the requester is an administrator of the domain to which the shared drive belongs." |
| `transferOwnership` (v2) | `permissions.update` | "Whether changing a role to 'owner' **downgrades the current owners to writers**." |

`[INFER]` `useDomainAdminAccess` is the Workspace-admin bypass. Note it is scoped to **shared drives only** — there is no equivalent API-level impersonation of arbitrary ACLs, which is why Drive's admin tooling is UI-driven and audited out-of-band (§B.8).

### (f) ⚠ v2 → v3 migration traps (for completeness)

| v2 | v3 |
|---|---|
| `additionalRoles: ["commenter"]` | `role: "commenter"` |
| `teamDrivePermissionDetails[]` | `permissionDetails[]` |
| `withLink: true/false` | `view: "published" | "metadata"` |
| `role` enum lacked `commenter` | `role` includes `commenter` |
| `kind: "drive#permissionList"` | same |

### (g) Activity API — the audit reference model

[Source: [Drive Activity API v2](https://developers.google.com/workspace/drive/activity/v2/reference/rest/v2/activity/driveactivity)] — `DriveActivity` → `Action[]` → `ActionDetail` → `PermissionChange` (with `addedActors`/`removedActors`), `Create`, `Edit`, `Move`, `Rename`, `Delete`, `Restore`, `SettingsChange`, `DataLeakPreventionChange`, `SystemEvent`; plus `Actor` types `User`, `AnonymousUser`, `ApplicationReference`, `Impersonation`, `Administrator`.

`[INFER]` **Use this, not Confluence's audit log, as your audit schema reference.** It has a first-class `PermissionChange` with added/removed actors, a first-class `AnonymousUser` actor (solving the Drive-anonymous-animals problem), and `Impersonation` as a distinct actor type (solving the admin-key problem). Confluence's audit log has three coarse event types and no actor taxonomy.

---

# PART C — SYNTHESIS FOR YOUR DESIGN (OpenFGA ReBAC)

## C.1 You must pick one invariant. Do not try to have both.

| | Confluence | Drive | **Your system should probably be…** |
|---|---|---|---|
| Default direction | ∩ narrowing | ∪ widening | **∩ narrowing, with an explicit escape hatch** |
| Reason | Content is authored in place; you must be able to hide one page. | Files are moved constantly; narrowing below a folder breaks relocation. | Knowledge bases have stable hierarchies (spaces → pages). Page trees are the primary organizing primitive. |
| Failure if wrong | Users can't hide sensitive content. | Every descendant edit escalates to the parent; users stop using the permission system. | — |

`[INFER]` The critical, non-obvious consequence of choosing ∩: **a child can never be more open than its parent**, so you must also decide what happens when a user *tries*. Confluence offers no escape and users work around it (§A.7.2). Drive offers one (reparent) and it's destructive. **The right answer is a third option Drive doesn't have: an explicit, audited, reversible "Break inheritance" that (1) makes the child non-enumerable from the ancestor, (2) requires a capability Confluence lacks, and (3) writes a `parent_visibility=hidden` marker on the child so the tree doesn't leak it.** OpenFGA expresses this as a real `parent` tuple plus a flag, not as a permission edge — which is exactly how Drive's `inheritedPermissionsDisabled` works (§B.7c), and note Drive's version *narrows* while Confluence's would *widen*. Yours can do both if you keep them as separate relations.

## C.2 Concrete ReBAC mapping

```
# Types
type user, group, team, service_account, anonymous
type site, space, page, folder, whiteboard, attachment

# Container role (additive, unioned) — Confluence space permissions / Drive shared drive
user   viewer|editor|admin      @ space
group  viewer|editor|admin      @ space

# Per-node override (intersective narrowing) — Confluence page restriction
user   restricted_to_view|restricted_to_edit  @ page
       # presence on ANY ancestor ⇒ deny
group  restricted_to_view|restricted_to_edit  @ page

# Derived — computed, never materialized
parent: page -> page
ancestors(u, p) = Walk(parent, p)
viewable(u,p) = has(viewer|editor|admin, space(p)) 
            AND NOT EXISTS q IN ancestors(p) ∪ {p} : deny(q, u)
editable(u,p) = viewable(u,p) 
            AND has(editor|admin, space(p))
            AND ( NO direct edit-deny on p )        # ← decide: inherit edit or not
            AND ( inherit_edit OR NO edit-deny on ancestors )   # ← Confluence: inherit_edit=false
```

**Two decisions to make explicitly, both of which Confluence gets wrong-by-omission:**

1. **`inherit_edit`** — Confluence: `false` (defect, CONFSERVER-5095). Drive: `true`. `[INFER]` Default to `true`; a restricted parent that leaks edit rights on every descendant is a real vulnerability, and no user expects it.
2. **Whether a direct grant can widen.** Confluence: no. `[INFER]` Add one, but gate it: `can_break_inheritance` capability, and require the ancestor to be marked `parent_visibility=hidden` so the tree stops leaking. Without the second half, you reproduce Confluence's dead end.

## C.3 Who-can-see-the-ACL — three separate relations, not one

Both reference systems collapse this into ad-hoc UI. Do not.

| Relation | Confluence analogue | Drive analogue | Who should hold it |
|---|---|---|---|
| `can_view_acl` | `People who can view` (page **view** holders) | "Can access detailed file permissions" (**write** holders) | Pick one. `[INFER]` **write-or-above**, matching Drive — because a viewer seeing the ACL is a membership-disclosure leak and a phishing surface ("alice, bob, carol can see this"). |
| `can_list_restricted` | `Space settings > Content > Restricted` / `Space Administration > Restricted Pages` | *(none — Workspace admin only)* | Space/container admins. **Build this.** Drive's absence of it is a genuine gap. |
| `can_read_acl_history` | *(none)* | `useDomainAdminAccess` + Activity API | Auditors/compliance, separate from admins. |

Plus, from Confluence, steal these three:
- `can_explain` — a provenance-returning check. `[INFER]` OpenFGA gives this nearly free: echo the tuples/TTUs that satisfied the check. Confluence's Inspect Permissions is the most-praised permission surface in either product, and it is a debugging UI over a boolean check. Return the reason, not just the boolean.
- `can_request_access` — a *relation*, not a heuristic. Confluence's dead-ends (inherited restrictions suppress the button) and Drive's 2-hop routing both beg for `can_grant(subject, object)` as a first-class check you can `ListObjects` over.
- The **elevated-access session**: explicit, banner-announced, idle-expiring, separately audited (`viewed_with_admin_key`), and **emails the content owner**. §A.6.3. This is the single highest-value pattern in the whole report and it costs almost nothing.

## C.4 UI rules distilled (with sources)

| Rule | Source |
|---|---|
| Never widen below a container; make the violation impossible, not warned-about | A.2.1 |
| **Separate "General access" (default audience) from "Specific access" (overrides)** — and label the specific list as an override list, not a membership list | A.4.2 |
| **Inherit `edit`.** The asymmetry is Confluence's defect, not its design | A.2.3 |
| Always offer a **computed effective-access view** (`N people, M groups`) with a type-to-filter name search | A.4.4 |
| Always offer a **provenance/"why" view** per relation per subject | A.4.5 |
| Distinguish **"not found" from "access denied"**; strip the container key from URLs; filter restricted nodes from search, nav, *and macros* | A.5.3 |
| Never let a structural op (move / copy / retype) silently widen access. Re-evaluate on every reparent | A.7.3 |
| Make reparent **previewable**: `dryRun → {gained, lost}` | B.3.1 |
| Never escalate the scope of a permission edit to an ancestor. If unrepresentable, say so and offer reparent | B.6.2 |
| If you have a deny, publish its precedence against direct grants, group membership, and link grants — Drive's does not win against any of them | B.3.3 |
| Model `visibility` (public/link) as a **separate relation** from the principal ACL — it is the one thing that can narrow | B.6.3 |
| Make a visibility/organizer check resolve against the **ancestor**, not the object | B.1.3 |
| Make narrowing flags **manually appliable at every level and always reversible** | B.3.2 |
| Route access requests by a **deterministic principal-priority resolver**, not a mailto fan-out | A.4.7 / B.4.4 |
| Notify the content owner when an admin reads or edits their content | A.6.3 |
| **State copy semantics on every revocation** ("recipients can copy until you purge") | B.6.6 |
| Warn on a Share dialog when a change makes content reachable by anonymous/public principals. Confluence does not; you should. | A.5.2 |
| Make a "show all restricted content in this container" surface. Neither system has a good one. | C.3 |

## C.5 Open items / things I could not confirm from primary docs

1. **Whether the Cloud Share dialog permits adding a *direct* restriction to a child of a "Restricted by parent" page.** §A.3. `[CONFLICT]` — a live-instance check is needed. It determines whether state 4c (§A.2.1) is reachable in the UI or only via API.
2. **Whether Drive's Share dialog exposes the collaborator list to `commenter`/`reader`.** The API says no (§B.5.1); the docs never state the UI rule. Needs empirical verification.
3. **A documented Confluence page-restriction *history* view.** I found none; only the coarse `Content restriction added or removed` audit event (§A.6.2). If one exists it is not in the support docs.
4. **Whether "Shared by me" is documented anywhere by Google.** It appears in the Drive left nav and in third-party specs, but Google's own help content I retrieved does not define it (§B.2.1). The definition I give (created-by-me, not managed-by-me) comes from the LibreGraph spec, i.e. a third party — treat as `[COMM]`.
5. **`Inspect permissions` availability by plan** — DC doc says "Data Center only"; a community answer says "Premium and Enterprise." `[CONFLICT]` §A.4.5.