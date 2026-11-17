# Notion's Permission Model & Sharing UX — Research Report

**Legend:** `[D]` = official Notion documentation · `[T]` = third-party (Notion ambassador/template author, screenshot-verified) · `[I]` = my inference from combining sources · `[⚠]` = third-party claim I could **not** verify and believe is wrong.

Primary sources fetched in full: [sharing-and-permissions](https://www.notion.com/help/sharing-and-permissions), [navigate-with-the-sidebar](https://www.notion.com/help/navigate-with-the-sidebar), [intro-to-teamspaces](https://www.notion.com/help/intro-to-teamspaces), [whos-who-in-a-workspace](https://www.notion.com/help/whos-who-in-a-workspace), [add-members-admins-guests-and-groups](https://www.notion.com/help/add-members-admins-guests-and-groups), [workspace-settings](https://www.notion.com/help/workspace-settings), [public-pages-and-web-publishing](https://www.notion.com/help/public-pages-and-web-publishing), [manage-your-library](https://www.notion.com/help/manage-your-library), [share-your-work](https://www.notion.com/help/share-your-work), [admin-content-search](https://www.notion.com/help/admin-content-search), [audit-log](https://www.notion.com/help/audit-log), [guides/grant-access-teamspaces](https://www.notion.com/help/guides/grant-access-teamspaces), [guides/understanding-notions-sharing-settings](https://www.notion.com/help/guides/understanding-notions-sharing-settings), [guides/notion-enterprise-security-provisions](https://www.notion.com/help/guides/notion-enterprise-security-provisions), [developers.notion.com/guides/get-started/internal-connections](https://developers.notion.com/guides/get-started/internal-connections). Third-party: Thomas Frank's [Notion Sharing & Permissions: The Ultimate Guide](https://thomasjfrank.com/notion-sharing-permissions-the-ultimate-guide/) (screenshot-heavy, most reliable secondary source).

---

## 1. Permission model

### 1.1 Two orthogonal axes (critical to understand)

Notion has **no single role ladder**. Access is the composition of:

- **Axis A — *who* the principal is** (workspace-level identity)
- **Axis B — *what* they were granted on a page** (object-level grant)

A user's effective level = `max(grant)` over **all** paths that reach them. `[D]` This is stated repeatedly and unambiguously:

> "Notion respects the **broadest level of access** given to a user. For example, let's say you give Member A `Can view` permissions to a page. Then you give everyone in your workspace `Full access`, Member A will also get full access because they are a member of your workspace." — [sharing-and-permissions § Permission overrides](https://www.notion.com/help/sharing-and-permissions)

Thomas Frank calls it "**the highest permission rule wins**" and warns explicitly that "'highest' doesn't mean the highest position in the list." `[T]`

**There is no deny rule.** You cannot subtract access. `[D][T]` This is the single most important architectural fact. Corollary, stated by Notion: *"Make sure anyone whose access you're restricting through page-level access doesn't have greater access through another part of the Share menu."* `[D]`

### 1.2 Axis A — workspace roles (exact names)

From [Who's who in a workspace](https://www.notion.com/help/whos-who-in-a-workspace) `[D]`:

| Role | Notes |
|---|---|
| `Member` | Billed. Create private pages, use AI, join permission groups. |
| `Restricted member` | Billed like a member, but must be **explicitly added to specific teamspaces and pages**. Cannot create teamspaces; can only share with people who already share access with them; can only @-mention people they share access with; no `Connect`; no Agents. |
| `Guest` | **Not** a member. Invited **page by page only**. Cannot be workspace-wide; cannot be in groups; cannot change workspace settings; cannot add members; cannot add connections. |
| `Temporary member` | Marketplace consultants, time-limited, don't consume a paid seat. |
| `Workspace owner` | Manage everything, delete the workspace. |
| `Membership admin` | Enterprise only. Add/remove members and group members. Cannot change workspace settings. |
| `Organization owner` | Enterprise only. Cross-workspace, org-level settings. |

Plus Enterprise-only **admin roles** (compliance / people / IT / analytics viewer / billing admin) which are explicitly documented as **not** affecting page visibility `[D]` ([enterprise-admins](https://www.notion.com/help/enterprise-admins)).

There are also **teamspace roles**, explicitly *separate* from workspace roles `[D]`: `Teamspace owner`, `Teamspace member`. And **project/role subjects** you can grant to: a person, a **group**, a **teamspace**, a **person property / created-by property** (row-level), and a **connection** (bot).

### 1.3 Axis B — page access levels (exact names)

From [sharing-and-permissions § Access levels](https://www.notion.com/help/sharing-and-permissions) `[D]`:

| Level | Documented capability |
|---|---|
| `Full access` | "edit any of the content it contains and **share the page with anyone they want**" |
| `Can edit` | "edit the content on the page, but **not share the page with others**" |
| `Can edit content` | **Database pages only.** Create + edit pages in the DB and edit property values. Cannot change DB structure, properties, views, sorts, or filters. |
| `Can create` | **Database pages only. Business/Enterprise only.** Create new pages in the DB; cannot view or edit existing pages they weren't individually granted. (Form-submission / ticket-intake use case.) |
| `Can comment` | "only the ability to comment on a page. They won't be able to edit or share the content." |
| `Can view` | "read the content on the page, but they won't be able to comment, edit, or share." |
| `No access` | Not a grant — a *state*. From the [teamspaces & groups guide](https://www.notion.com/help/guides/grant-access-teamspaces) `[D]`: "the page is hidden from you and it will not appear in search." Also the label on the request-access screen. |

**Is there a "commenter" tier?** Yes — `Can comment` is exactly the commenter tier, and it is a real grantable role, not a side-effect. Important nuance from the capability matrix `[T]`: `Can comment` can create comments (page-, block-, and text-level, and in existing threads), edit/delete *own* comments, **suggest edits**, and reject own suggested edits — but **cannot** accept/reject *all* suggested edits, cannot resolve comment threads, cannot add reactions, cannot edit blocks. So "commenter" ≠ "can only append a comment."

Also documented `[D]`: a general-access group gets its own access level, so `Everyone at {workspace}` can be `Can view` while specific people are `Full access`. This is the officially recommended pattern ("use `Share with everyone at [your company]`. You can give certain team members, such as HR managers `Full access`, and make the page `Can view` for everyone else." — [understanding-notions-sharing-settings](https://www.notion.com/help/guides/understanding-notions-sharing-settings)).

⚠️ **Contested:** Thomas Frank claims `Can edit` and `Can edit content` are "paid plans only." `[T]` The official doc does not say this. Treat as unverified/likely outdated.

### 1.4 One more orthogonal axis: *plan gates*

Role/level availability is gated by plan, and the gate is per-level, not per-role: row-level access + `Can create` = Business/Enterprise `[D]`; teamspace `Private` = Business/Enterprise `[D]`; custom per-group permissions inside a teamspace = Enterprise `[D]`; content search, audit log, guest-invite approvals, "no access → change permissions" = Enterprise `[D]`.

---

## 2. Page hierarchy & inheritance

### 2.1 The documented model

Everything in Notion is a block; pages are blocks; **permissions can only be set on pages (and databases)**, and they govern every block inside, including nested sub-pages. `[T]`

> "When you create a subpage inside of a page, that subpage will take on the permissions of its parent page. To change this, go into a subpage and update the permissions there." — [sharing-and-permissions § Inherited permissions](https://www.notion.com/help/sharing-and-permissions) `[D]`

> "Teamspace owners can set **default permissions** for content in their teamspace. This will apply to every new page created in the teamspace, and if you want to change them, you'll have to make changes at the page level." `[D]`

Additional documented inheritance facts:

- **Root of the chain depends on location** `[T]`: top-level pages in `Private`/`Shared` have no inherited parent grant; top-level pages in a **teamspace** inherit from the **teamspace's** permission rules, which themselves are keyed by role (`teamspace owners` / `teamspace members` / `everyone else`). `[D]` confirms the three-way role split exists.
- **Data sources have no independent permissions.** `Database → Data Source → Page`: a row inherits from the database (its technical grandparent), *except* for page-level access rules. `[T]`
- **Internal connections / integrations are first-class principals and inherit.** "Sharing a parent page with the connection grants access to all of its child pages as well. **Access persists independently of users.** If the user who shared a page leaves the workspace, the connection retains access." — [internal-connections](https://developers.notion.com/guides/get-started/internal-connections) `[D]`
- **Synced blocks inherit from their *original* page**, not the page they're pasted into. A synced block copied to a page the reader can access will render blank if they can't access the original. `[T]` — a genuinely surprising, under-documented behavior worth stealing as a cautionary example.
- **Moving a page into `Private` is itself a permission mutation:** "moving a shared page to the `Private` section of your sidebar will remove everyone else's access on that page. **Note: This override will only apply to the parent page — the permissions granted for any subpages will remain the same.**" `[D]`
- **Adoption on move:** a page moved under a different parent adopts the *new* parent's grants. `[T]`

### 2.2 Is there explicit "inherit" vs "break inheritance"?

**Not in the official docs — and that's a documentation gap, not a UI gap.** The official page never uses the words "inherit from parent," "break inheritance," or "restrict." It only says "to change this, go into a subpage and update the permissions there" and frames the mechanism under **"Permission overrides."** `[D]`

What the UI actually does, per screenshot-verified third-party documentation `[T]`:

1. The **resolution is implicit and eager**: a sub-page's grant set = nearest ancestor's grants ∪ own grants. There's no per-node "inherit" flag you toggle; you get inheritance by having *no* own rules, and you get a break by adding/modifying your own.
2. Changing a page's permissions **in a way that reduces access vs. its parent** flips the page into a **Restricted** state. A **`Restricted` label appears at the top of the page** (persistent banner, not a toast).
3. In the Share menu, an **`Access Restricted`** line appears with a **`Restore`** link that reverts to inheriting from the parent. **This `Restore` affordance is the de facto "break inheritance / re-inherit" toggle.**
4. Overriding can be done two ways: (a) *add* a broader grant on top of an inherited one, or (b) *edit/remove* the inherited rule directly on the child — including setting a group to no access on that child.

⚠️ **Explicitly flagging misinformation here.** Two sources make claims I could not substantiate and that conflict with the above: a Substack post (`thomasyang.substack.com/p/notion-permissions-demystified-2026`) says *"toggle on **'Restrict access'**. This severs the link from the parent"*; and `wisechecker.com` invents a setting called **"Ignore parent permissions"** plus a nonexistent **"Permission Inheritance Cycle"** error. Neither appears anywhere in Notion's documentation, and the `wisechecker` page reads as SEO/AI-generated. **Do not model your system on those strings.** Use `Restricted` / `Access Restricted` / `Restore`.

**Can you remove inherited access without touching the parent?** `[I + T]` **Yes**, but only by *shadowing*, not by *revoking*: you must have `Full access` on the child, and you replace the inherited grant with your own (possibly `No access`). The parent is untouched. The price is that you're now maintaining a divergent rule set, and there's no global "show me every place this subtree diverges" view. Also, the divergence is *not* symmetric in the dangerous direction — a single broader grant anywhere up the chain (e.g. `Everyone at {workspace}` with `Full access`) wins over your child-level `Can view`, and Notion's own doc warns about exactly this. `[D]`

---

## 3. Sharing surfaces & terminology (precise)

### 3.1 The vocabulary, disambiguated

| Term | Official meaning | Source |
|---|---|---|
| **Share** (button) | Top-right of any page. Opens the share popover. Its four documented jobs: invite someone; see/change who has access and at what level; copy the page's link; open the `Publish` tab. | `[D]` |
| **Invite** (button) | Commits pending people/groups/emails to a grant. Not a noun for a grant. | `[D]` |
| **Share a page with a teamspace** | Not a grant dialog. Two physical actions only: create a page inside a teamspace via sidebar `+`, or **drag a page into a teamspace**. | `[D]` |
| **General access** | The audience axis, *separate from named people*. Three values: `Only people invited`; `Everyone at {your workspace}` (with a `Hide in search` sub-toggle); `Anyone on the web with link` (with a `Link expires` sub-toggle). Each can carry its own access level. | `[D]` |
| **`Anyone on the web with link`** | Anyone with the link, "even if they aren't part of your workspace or aren't a Notion user." **Visitors must be logged in to comment or edit.** | `[D]` |
| **`Only people invited`** | Documented as "only you and people you invite." | `[D]` |
| **Restricted** | A *page state*, not a general-access value: a page whose own permissions reduce access relative to its parent. Surfaced as a label on the page. | `[T]` |
| **Publish to web** / **Notion Site** | A **second, entirely separate** surface. Not a general-access value. Gets a `notion.site` / custom domain URL, a slug, SEO indexing toggle, site customization, embed codes. | `[D]` |
| **Add to sidebar** | Not a permission action. Sidebar sections are organizational: `Favorites`, `Teamspaces`, `Shared`, `Private` (plus `Recents`, `My Tasks`, `Library`, `Trash`). Pages are not *moved* to `Favorites`. | `[D]` |
| **Guest** | A non-member invited page-by-page. Gets an email with a link; **needs their own Notion account**. | `[D]` |

### 3.2 "Restricted" is overloaded — a real terminology bug to avoid

Three different things get called roughly "restricted" in Notion:

1. **Restricted member** — a workspace *identity* type. `[D]`
2. **Private** section — "only visible to you." `[D]`
3. **Restricted** page banner — inheritance divergence. `[T]`
4. **Restricted member(s) to teamspaces/pages** — the *admin settings* `Who can add restricted members to Teamspaces` / `...to pages`. `[D]`

### 3.3 "Shared with me" vs "Shared by me" — the direct answer

**This is the biggest terminology trap in Notion, and current Notion has partly dissolved it.**

- Historically Notion's sidebar had inbound and outbound lists, described in Notion's own older guides as: *"The `Shared` section is where you'll find pages **shared with you or by you**."* — [guides/navigating-with-the-sidebar](https://www.notion.com/help/guides/navigating-with-the-sidebar) (still live, still says this) `[D]`
- **Current US Help Center semantics (2026):**
  - Sidebar `Shared` section = **outbound**. "Any pages that **you've shared** with select individuals in your workspace will appear under your sidebar's `Shared` section. You'll see this category in your sidebar as soon as you invite someone to a shared page." — [navigate-with-the-sidebar](https://www.notion.com/help/navigate-with-the-sidebar) `[D]`
  - `Library → Shared` tab = **inbound**. "**Shared** — Find pages **shared with you**." — [manage-your-library](https://www.notion.com/help/manage-your-library) `[D]`

**So: the same word "Shared" labels the outbound list in the sidebar and the inbound list in Library.** The literal strings "Shared with me" / "Shared by me" are **not current official Help Center terminology** — I could not find them in any current Notion Help page. `[I]`

Which one lists **outbound** grants? The **sidebar `Shared` section**. `[D]`

⚠️ **The real answer to "what lists outbound grants":** Notion has **no end-user UI that enumerates outbound grants.** The closest official affordances are all Enterprise/admin-tier:
- **Content search → `Shared with` filter** — "filter to see all pages shared externally (with guest access) and pages shared to the web"; also "With whom the page was shared." — [guides/notion-enterprise-security-provisions](https://www.notion.com/help/guides/notion-enterprise-security-provisions), [admin-content-search](https://www.notion.com/help/admin-content-search) `[D]`
- **Audit log → `Page shared to web` event**, plus a per-page **audience** enum. `[D]`

This is a significant design gap. Notion's *aggregate* per-user view of "everything I've shared" simply does not exist for normal users.

### 3.4 The audience enum (reusable)

Notion's own audit log and content search use a clean 4-value audience classification `[D]`, with a documented precedence rule:

> `Private` — not shared with other users · `Shared internally` — shared with workspace members only · `Shared externally` — shared with one or more guests outside the workspace **and/or with an integration bot** · `Shared to web` — published to the web.
> "**Note: The Audience column will always list the most permissive group.** If a page is shared with another team member, but also shared externally, the audience will read: `Shared externally`." — [admin-content-search](https://www.notion.com/help/admin-content-search)

That's a clean, adoptable 4-state model for an "effective exposure" badge.

---

## 4. The Share dialog UX

### 4.1 Documented structure

`[D]` from [sharing-and-permissions](https://www.notion.com/help/sharing-and-permissions), [share-your-work](https://www.notion.com/help/share-your-work), [public-pages-and-web-publishing](https://www.notion.com/help/public-pages-and-web-publishing):

```
┌─ Share ───────────────────────────────────────┐
│ [ input: name / group / email  →  role ▾  Invite ] │   ← the invite composer
│                                                │
│ (your own effective level line, e.g.           │
│  "You have full access to this page via         │   ← self-permission, shows the
│   Marketing")                     [ ▾ Request edit access ] │  winning source
│                                                │
│ ── People / rules with access ──               │   ← "People with access" (T)
│   avatar  Name           [role ▾]  [⋯]          │
│   avatar  Group "Eng"    [role ▾]  [⋯]          │
│   🔑 "Anyone in Assignee → Can edit  Delete permission rule"  ← row-level rules
│                                                │
│ ── General access ──                           │
│   [ Only people invited | Everyone at {ws} |  │
│     Anyone on the web with link ]  [level ▾]   │
│     ☐ Hide in search        ☐ Link expires ▾  │
│                                                │
│ [Copy link]                                    │
│                                                │
│ ⚠ "Access Restricted"          [Restore]       │   ← only when broken (T)
└────────────────────────────────────────────────┘
│ Tabs: [ Share ] [ Publish ]                    │
```

### 4.2 The `General access` vs `People` split — the core design idea

This is the single most transferable pattern in Notion's model, and it maps cleanly to an ACL design:

- **`People` (named grants)** = a **list of principals**, each with an independent role. Add/remove/change per row. Each row dropdown offers: role levels + `Remove`.
- **`General access` (audience grants)** = a **single, exclusive, named audience slot** with its own role. Mutually exclusive radio: `Only people invited` / `Everyone at {workspace}` / `Anyone on the web with link`. Plus audience-specific sub-toggles (`Hide in search`, `Link expires`).
- **They combine additively.** `Everyone at {ws}` + `HR → Full access` is a documented, recommended pattern. `[D]`

Note the naming asymmetry: `Remove` (per-person) vs `Delete permission rule` (per row-level rule) — the docs use both, for two different row types. `[D]`

### 4.3 How inherited access is displayed

`[T]` (screenshot-verified):

- Inherited grants appear **inline in the same list as direct grants**, mixed together, with **no visual "inherited" badge on the row**.
- The **only** inheritance signal is the self-permission line at the top: *"You have **full access** to this page via **Marketing**"* — i.e. it names **one** winning source, and only for **you**, not for other people. You cannot see *"Anna gets Can view via the parent page."*
- A separate block of **role-derived rules** (e.g. "Teamspace Owner", "Teamspace Member", "Everyone else") appears when the page is in a teamspace, again undifferentiated from direct grants.
- The whole divergence is summarized by a single **`Restricted` label at the top of the page** + the **`Access Restricted` / `Restore`** line in the Share menu.

`[I]` **This is Notion's biggest UI weakness and the most important thing to beat.** The system *has* full knowledge of the grant graph — it just refuses to show it to the person editing. There's no "effective access" table, no provenance column, no "3 people also have access via the parent page" disclosure.

### 4.4 Changing a role

`[D]` Three clicks: `Share` → open the dropdown next to the name → select a level. The change is immediate (no confirm, no Save button). `Request edit access` appears in the *same* dropdown when the viewer holds `Can view`/`Can comment`, routing to the **page creator**, who accepts or ignores from the `Inbox`. `[D]`

The only in-product confirmation of a permission change I've found documented is indirect: **"If someone has requested a change in their permissions on a page you own, you'll be able to see, approve, and reject those requests from your `Inbox`."** `[D]` — i.e. the Inbox is the *approval queue* for escalation requests, not for direct edits.

### 4.5 Can you remove inherited access without touching the parent?

`[T]` Yes, by shadowing: as `Full access` on the child, open the dropdown on the inherited row and either change its level or `Remove` it. Doing so restricts relative to the parent and flips the page to `Restricted`. Notion provides **`Restore`** to undo. It does **not** tell you which ancestor you're shadowing.

### 4.6 Copy-link affordances

`[D]` Two distinct copy actions, easy to conflate:

| Action | Where | What you get |
|---|---|---|
| `Copy link` | `Share` tab | The **workspace-internal** URL. *"Only people who have access to the page can see it."* — [share-your-work](https://www.notion.com/help/share-your-work) |
| `Copy this code` / `🔗` | `Publish` tab | The **public Site** URL. The docs explicitly warn about the confusion: *"Make sure you've shared the link to the published page, and not the version of the page in your Notion workspace! The link should begin with your Notion workspace domain name."* — [public-pages-and-web-publishing FAQ](https://www.notion.com/help/public-pages-and-web-publishing) |
| `Copy invite link` | Teamspace `••• → Add members` | Teamspace join link (requires enabling `Invite Link` in teamspace Security) |
| `Copy link` | Settings → Members | Workspace member join link |

### 4.7 Presence / "who else can access"

`[D]` An unusual ambient affordance: *"You can tell who else has access to a page because their **profile photos can be seen in the bar at the very top of the page**."* Faded avatar = not currently on the page; unfaded = currently there. Hover → name, email, **and when they were last on the page**. Click an active avatar → **jumps you to the part of the page where they're reading or typing.** Plus: *"Click `•••` at the top right of any page and look at the bottom of the menu… You'll see who last edited the page and when."* `[D]`

That "last on the page" timestamp + click-to-jump-to-their-cursor is a great, cheap trust signal. Worth copying.

---

## 5. Groups, teamspaces, and scope

### 5.1 Groups `[D]`

- Live in `Settings → Members → Groups`. Review existing groups, add/remove members, **`Create teamspace from group`** (bulk-provisions a teamspace from a group).
- Provisionable via **SCIM**.
- **Guests cannot be in groups.** `[D]` ("They can't be added to groups of members.")
- Can be added to a **teamspace** as a member, and can be added to **Person-type properties** in databases (so groups work with row-level rules).
- ⚠️ **Quirk `[T]`:** a `Me`-filtered view won't match a page where the user is present only via a group — "It'll only show pages containing that user's actual profile in the Person property." Confirmed independently by Thomas Yang. `[T]`
- ⚠️ **You cannot downgrade one member of a group** below the rest. Workarounds: set the group's level to the lowest, then grant higher levels individually; or create a second group excluding that person. `[T]`

### 5.2 Teamspaces `[D]`

Four **join-visibility modes** (this is a *membership* axis, distinct from the page-permission axis):

| Mode | Semantics |
|---|---|
| `Default` (i.e. "make default teamspace") | **Every** workspace member is added, now and on join. *"Pages inside a default teamspace are accessible by everyone in your workspace."* Detectable via `••• → Teamspace settings → Members → Permissions` reading `Default`. |
| `Open` | Anyone can join and view content. |
| `Closed` | Visible that it exists; can't join unless invited by an owner or member. |
| `Private` (Business/Enterprise) | Only members/owners can invite; invisible to non-members. |

Two teamspace roles, explicitly **separate from workspace roles** `[D]`: `Teamspace owner` (full access to all teamspace pages **by default**, plus teamspace settings) and `Teamspace member` (level determined by owners; no settings access).

Permission granularity in teamspace settings: three role buckets — `teamspace owners`, `teamspace members`, and `everyone else (including non-teamspace members) within the workspace` — each assignable a level, plus two "who can" switches: **who can invite teamspace members** and **who can edit the teamspace sidebar** (any member vs. owners only). `[D]`

**Teamspace Security tab** `[D]`: all plans → who can invite members, who can edit sidebar, `Invite Link`. **Enterprise only** → `Disable publishing sites, forms, and public links`; `Disable guests`; `Disable export`. Critically: *"These will automatically inherit from the workspace's security settings — only **teamspace owners who are also workspace owners** will be able to modify them to make their teamspace settings **more permissive** than the workspace level settings."* `[D]` — i.e. **a hard ceiling; teamspaces can only tighten, never loosen.** That's a clean, documented monotone-constraint design worth stealing.

Also: teamspaces can only be **archived**, never deleted; archiving removes them from every member's sidebar. `[D]`

### 5.3 Enterprise custom permissions inside a teamspace — the crucial constraint

`[D]` From [guides/grant-access-teamspaces](https://www.notion.com/help/guides/grant-access-teamspaces):

> "**Set custom permissions for groups (Enterprise plans only)** — You can give additional access to a subset of teamspace members. When you've added a group to the teamspace, go to the dropdown next to the group's name, and select 'Custom permissions.' **You can't give less access than the teamspace default — only more.** So, if the teamspace default is 'Can Edit', you can assign 'Full access' to a particular group."

`[D]` And for **restricted members**: "The teamspace member role encapsulates both members and restricted members. This means that a **restricted member can't have a lower level of access than a regular member**." If you need that, you must use permission groups instead.

**Takeaway:** Notion's inheritance is *monotone-increasing only*. Every layer (group→teamspace, teamspace→workspace security) lets you add privilege but never subtract. `[D]` The only subtraction mechanism in the whole product is **breaking inheritance at the page** (which costs you the parent's rules entirely). `[I]` If you're modeling this, that's the design decision to make deliberately — and the place Notion's model is genuinely weak.

### 5.4 Page-level access (row-level security) `[D]`

- Business/Enterprise. Source database only, **not** a linked view.
- Rule shape: *property (Person or Created by) → access level*. Created via `Share → Page-level access → Add a new rule → select property → select level → Create rule`. 🔑 icon marks properties used in rules.
- Rules apply across **all views** and reflect in **linked views**.
- With multiple data sources, each data source has its own rules; the Share menu gets a data-source toggle.
- **Dangling-access UX `[D]`:** if the subject has *no* access to the database, they get an **error message** on visiting it. Two documented escapes: (a) the assignment notification lands in their Inbox and opens the row directly; (b) put a **linked view** on a page they can reach — "any other tasks you assign to Anna in that database will be accessible to Anna via the linked view." For *creating* new rows they need a **form**. `[D]`
- **If they *do* have DB access, the rule is purely additive** — Anna has `Can comment` on the DB, rule gives `Can edit` on Task 1 ⇒ she can view+comment everything and edit Task 1. `[D]`
- `[T]` Constraints: `Person` property max grantable is `Can edit` (cannot grant `Full access`, to stop self-escalation); `Created By` can grant `Full access`; **rollups unsupported**; groups in a Person property don't match `Me` filters.
- `[D]` Notification side-effect: "By default, when a person is mentioned in these properties, they'll be notified. **User groups are not notified by default.**" A real footgun for group-based rules.

---

## 6. Failure & edge-case UX

All of this is `[D]` unless flagged.

| Situation | What Notion shows / does |
|---|---|
| **No access to a page** | A **`No access`** state on the page. *"you can select `No access` on the page to send a request. This will notify the page's **creators or editors**, who can choose to accept or deny."* Also: page is hidden from search. |
| **View/comment but want edit** | `Share` → self-permission line dropdown → **`Request edit access`**. Goes to the **page creator**; accept or ignore; requester is notified; "try refreshing the page." Requests are approved/rejected from the **`Inbox`**. |
| **You're not the owner and try to remove someone** | **Nothing happens — no error, no explanation.** You need `Full access` on the page to change anyone else's grant. There is **no documented affordance** telling a non-`Full access` user why the control is inert. |
| **Last `Full access` holder tries to remove themselves** | Blocked. `[T]` "At least one person must have Full Access to a page. You *can* remove your own access, but only if someone else has Full Access." (No confirmation dialog documented.) |
| **Breaking a link for other people** | ⚠️ **Notion does not warn you.** `[D]` Dragging a page into `Private` "will remove everyone else's access on that page" — stated as a documentation footnote, **not** as a UI confirmation. No impact preview, no list of affected people, no count of broken links, no downstream notification. This is a genuine and widely-cited UX failure (§7). |
| **Guest needs access they don't have** | They get an error; guests (and non-members generally) can submit a **page access request**. Default-on for all plans **except Enterprise**; toggleable off on Plus/Business; **not toggleable on Free**. Notification lands in the **page creator's** Inbox, who can approve *and set the level* or ignore. |
| **You want to invite a guest but the admin forbids it** | Enterprise: `Allow members to invite guests to pages` off ⇒ **nobody but workspace owners** can invite guests; members can only *request*. `Allow members to request adding guests` is a **workspace-level setting that overrides any teamspace-level guest setting** — explicitly documented. |
| **You exceeded the guest limit** | The invitee is silently **converted to a member** if their email domain matches the org/owner/verified domain. Escape hatch: `Skip for now` on the invite. Docs list three causes: guest limit reached, workspace/teamspace blocking guests, disallowed email domain. |
| **Removing a member loses their private pages** | Their `Private` pages are hidden immediately; **re-inviting within 30 days restores** private pages, shared pages, group membership, and teamspace membership. On non-Enterprise plans **there is no way to recover them.** Enterprise gets `Settings → Members → Recently Left → Transfer Private Pages` (creates a `Private Pages of [Name]` page for the recipient, and links "siloed" pages, granting the recipient `Full access` on them in place). |
| **Enterprise admin needs to find an inaccessible page** | `Settings → Content search` searches *everything* regardless of permissions → `••• → Change permissions` to self-grant. The doc carries a legal warning: *"Using this feature may provide workspace owners with access to the personal data of workspace members and guests."* |
| **Deactivated user in audit log** | Click the page → **`No Access`** popup. On Enterprise, owners can change permissions from here; elsewhere, only `Request Access`. |
| **Unpublishing a Site isn't enough** | Documented explicitly: *"Even if your Notion Site has been unpublished, it's possible your page's **general access settings** have been set to `Anyone on the web with link`… To ensure your page's contents aren't shared publicly, turn this setting off."* `[D]` Two independent public surfaces; unpublishing one leaks via the other. |
| **Who can delete a page** | `[T]` Requires `Can edit`+ on the page **AND on its parent** (deleting a child is an edit to the parent's block tree). Teamspace top-level pages ⇒ teamspace owners (optionally members). `Private`/`Shared` top-level pages ⇒ any member with `Full access`/`Can edit`. Guests can only delete sub-pages within what was shared with them. |

### 6.1 The "Anyone with link" leak Notion documents against itself

`[D]` Even with `Anyone with the web with link` set to view-only, Notion says people without the direct link may still reach the page if:

- "The page is mentioned in or linked from another page shared more broadly."
- "The page uses a **two-way relation** that links to another page shared more broadly."
- "The page is **nested inside another page that has been shared more broadly.**"

This is Notion explicitly documenting that **graph edges (mention, link, two-way relation) are access-propagating**, i.e. a link from a broadly-shared page is itself a grant. The third bullet is the same "broadest access wins" rule viewed through the tree. `[I]` Design implication: in a Notion-shaped system you must decide whether inbound links propagate access, and if so, whether the propagation is transitive and whether it's disclosable to the reader. Notion's answer is "yes, silently."

---

## 7. Known criticisms & limitations

### 7.1 Documented-by-Notion limitations

- **No property-level access control.** Cannot share only *some* properties of a database row. `[T]`
- **Filters are not a security boundary.** A user with `Can edit`+ can change/remove a filter and see all rows; a `Can edit content` user can just build their own unfiltered **linked view**, or search. `[T]` Both Thomas Frank and Thomas Yang flag this as the #1 misunderstanding. This is a serious, widely-mishandled footgun.
- **The public web surface exposes contributor PII by default.** `[D]` *"When you publish a Notion page to the web or set sharing access for a Notion page to `Anyone on the web with link`, the webpage's metadata will include the **names, profile photos, and email addresses** associated with any Notion users that have contributed to the page."* That's a real, documented leak vector.
- **Publishing a page publishes all subpages by default** (`[D]`: *"Make sure all your page's subpages are good to go before you hit publish!"* — again a doc note, not a UI warning).
- **No password protection** for public pages. `[D]`
- **`Full access` is a foot-gun with surprising reach.** `[T]` A **Guest** with `Full access` can remove **all Members and even Workspace Owners** from a workspace-level page outside any teamspace — Thomas Frank calls this "**siloing**" a page. A guest with `Full access` can also *move* a page out of a teamspace into a shared page and then silo it. **It is technically possible for a guest to create a secret fiefdom in your workspace, and on non-Enterprise plans there is no way for an admin to undo it.** That is the sharpest documented criticism I found.
- **Enterprise admin ≠ omnipotent, and this is inconsistently communicated.** `[T]` On Enterprise, workspace owners can self-grant on any page, promote themselves to teamspace owner, and content-search private content. On non-Enterprise, they cannot.
- **Data loss on member removal** (§6) — irreversible off-Enterprise.
- **Restriction ≠ true restriction on a public link** (§6.1).
- **Guests can't use Notion AI, can't be in groups, can't create private pages** — forces awkward role choices between `Guest` and `Restricted member`. `[D]`

### 7.2 Criticized by practitioners

- **"Lack of granular permissions … enterprises often require more nuanced RBAC. Notion's permissions can be too open (risking data leaks) or restrictive (limiting collaboration)."** — [Will Kelly, *Notion in the enterprise: hype vs. reality*](https://willkelly.substack.com/p/notion-in-the-enterprise-the-hype) `[T]`
- **Governance blindness.** "The key failure mode is governance blindness at the content layer, where permissions alone cannot prevent leakage"; "encryption as a baseline control, not a substitute for content governance." — [NHI Mgmt Group, *Notion DLP gaps expose the limits of SaaS access controls*](https://nhimg.org/articles/notion-dlp-gaps-expose-the-limits-of-saas-access-controls) (Aug 2026) `[T]`
- **The community's standard workaround is workspace fragmentation.** Notion's own help doc admits it: *"We've seen people create multiple workspaces instead of groups to set granular permissions. For instance, they create separate workspaces for Design, Marketing, and their executive team so these groups can't access, edit, or get distracted by each other's work."* — then offers groups as the fix, with the note that page-level grants "will hold true for all the sub-pages on that page." `[D]` That admission is itself the strongest evidence that single-workspace permission scoping is Notion's weak point.
- **Recurring user complaint (2024–2026): "Notion does not have granular permissions."** [r/Notion, *Delegated access and security issue*](https://www.reddit.com/r/Notion/comments/1ajpxpe/delegated_access_and_security_issue) `[T]`
- **"Why can't we hide filter/sort controls and truly lock public database views?"** (Nov 2025) — "Granular permissions require Notion accounts — even as guests, people need to sign up." [r/Notion](https://www.reddit.com/r/Notion/comments/1omlndr/why_is_it_still_impossible_to_share_a_truly/) `[T]`
- **Permission-state display bugs leak into other surfaces.** Recurring reports of mention chips rendering `No access` for pages the user can actually open. [r/Notion](https://www.reddit.com/r/Notion/comments/1tdofgs/notion_ai_no_acess_for_all_pages_mentioned) `[T]` — mild, but it shows the permission-state computation isn't centralized.
- **Adjacent but relevant: accidental-edit culture.** Long-running critique that Notion's everything-is-editable-by-default produces "accidental edits," leading orgs to hand-manage locks/unlocks. [HN, *UX Issues with Notion*](https://news.ycombinator.com/item?id=25521487) `[T]`

### 7.3 Consolidated list of Notion's actual UX sins

`[I]` — my synthesis:

1. **No deny.** Everything is additive; "restrict" means "shadow."
2. **Inherited and direct grants are visually identical.** The one provenance string in the whole UI is about *you*, not about the page.
3. **No effective-access table.** No way to ask "who can actually read this?" and get a trustworthy answer.
4. **No impact preview on revocation.** Removing access — or dragging to `Private` — gives zero feedback about who loses what, and no notification to affected users. *This is the single highest-value thing to fix.*
5. **A hard rule is documented only in a doc footnote.** The "moving to Private doesn't touch subpages" override is a Notion Help *note*, not a UI warning.
6. **Two independent public surfaces** (`Anyone on the web with link` vs. `Publish`) with confusingly similar names and a documented trap where unpublishing one leaves the other open.
7. **Metadata PII on every public page** by default.
8. **No plan-neutral way to see outbound shares.** Enterprise-only.
9. **The word "restricted" means four different things.**

---

## 8. What I'd model from this

Concrete takeaways, in priority order:

1. **Keep Notion's two-axis split.** Named-principal grants (per-row, independent roles) × a single exclusive **General access** audience slot with its own role. It composes additively and it's the most legible part of the whole design.
2. **Adopt the 6-level ladder verbatim** (`Full access` / `Can edit` / `Can edit content` / `Can create` / `Can comment` / `Can view`) plus a `No access` *state*. The naming is good: gerund-less, symmetric, capability-obvious. `Full access` is defined *only* by "can also share" — that's the one bit of real semantics in the whole ladder, and it's worth preserving.
3. **Add what Notion lacks: an effective-access view with provenance.** Every row should render `Anna — Can view — via ⟨parent⟩ Handbook` with a chip. Make inherited rows visually distinct (ghosted, with the source node linked). This single change fixes criticisms 2, 3, and 6 at once.
4. **Make revocation a two-step commit with a diff.** Before any destructive permission change, show a modal: *"This will remove access for N people (3 guests, 2 members) and 1 integration, and will not affect 4 subpages that have their own grants."* Plus an explicit "Break inheritance from ⟨parent⟩" action with the same diff preview, and a `Restore inheritance` inverse. **Do not** ship drag-to-`Private` as a silent permission mutation; if you keep a drag affordance, it must be a confirm-first action.
5. **Notify the affected.** Nobody in Notion's model gets told they lost access. A `Removed by {actor} on {date}` notification plus an audit-log entry is cheap and high-value.
6. **Decide inheritance semantics explicitly and document them.** Pick one: (a) Notion-style eager snapshot inheritance (simple, cheap, but silently wrong after moves), or (b) live-chain resolution with explicit `INHERIT` / `BREAK` per node (correct, but needs a cycle guard and a "show divergence" report). Notion's docs are vague enough that "what happens on move" is folklore. Whatever you pick, **document it and surface it in the UI**, and add a "re-parenting will change effective access for N people" warning on move.
7. **Monotone-only escalation is a trap.** Notion can't express "this group gets *less* than the teamspace default," which is why `Restricted member` exists as a bolt-on. If you need per-group de-escalation, you need an explicit deny/exception mechanism — but then you must define conflict resolution, which Notion sidesteps entirely.
8. **Adopt Notion's 4-value audience enum** (`Private` / `Shared internally` / `Shared externally` / `Shared to web`) with documented "most permissive wins" precedence, and put it on every page as a badge. Cheap, high-signal, and it's the artifact security teams actually ask for.
9. **Adopt the presence affordances** — faded/unfaded avatars, "last on the page at T", click-to-jump-to-their-cursor. And a persistent "who last edited" line.
10. **Don't** copy: guest-can-silo-a-page, silent link-loss, "Shared" meaning inbound in one place and outbound in another, PII in public page metadata, publishing-subpages-by-default without a preview, or filters masquerading as access control. If you need row-level security, gate it behind explicit rules with a clear "this rule is additive" disclosure and a dangling-access state that says *why* (Notion's bare error message is a missed opportunity — say "you have access to Task 1 via an assignee rule, but not to this database").