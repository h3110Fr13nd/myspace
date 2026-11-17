# Issue Analysis — FOSS Content Workspace

A thorough review from logical, security, UX, and optimization lenses.

---

## 🔴 Critical / Breaking Issues

### 1. Real OAuth Credentials in `.env` (Committed Secrets)
[`.env`](file:///home/user/Desktop/dev/blog/template/.env#L27-L29) contains live `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a real `OPENFGA_STORE_ID`. These are in what appears to be a tracked repo. Even if `.gitignore` covers `.env`, the `.env.example` should be the committed file, never the real one. **Anyone who got the repo would own your Google OAuth app and your FGA store.**

### 2. Dev Password Fallback — Login Without a Password Hash
[`login.ts`](file:///home/user/Desktop/dev/blog/template/src/pages/api/v1/auth/login.ts#L28-L37):
```ts
if (user.password_hash) {
  const match = await comparePassword(password, user.password_hash);
  // ...
}
// No else: if no password_hash, login succeeds for ANY password!
```
If a user row exists without a `password_hash` (e.g., Google-OAuth-only users seeded directly), **any password string will log them in**. This is a critical auth bypass.

### 3. Hardcoded `user:demo` / `user:alice` Bypass in Search and Middleware
[`search.ts`](file:///home/user/Desktop/dev/blog/template/src/pages/api/v1/search.ts#L86-L88) and [`middleware.ts`](file:///home/user/Desktop/dev/blog/template/src/middleware.ts#L33-L34):
```ts
if (currentUser === 'user:demo' || currentUser === 'user:alice') {
  isAllowed = true;  // Bypasses OpenFGA entirely
}
```
This is a **hardcoded privilege escalation backdoor**. Any user who knows to set `?as_user=user:demo` in the URL (which the `?as_user=` query param allows without authentication) can bypass the entire ReBAC system. See issue #4.

### 4. `?as_user=` URL Param Overrides Session Token — No Auth Required
[`middleware.ts`](file:///home/user/Desktop/dev/blog/template/src/middleware.ts#L12-L14):
```ts
const queryUser = url.searchParams.get('as_user');
const currentUser = queryUser || decodedPayload?.userId || authHeader || 'user:demo';
```
An **unauthenticated visitor** can pass `?as_user=user:demo` and gain full access to everything. The "Simulate Session" dropdown in the header makes this trivially discoverable. This is intended as a demo feature but there is **zero check that the logged-in user is actually permitted to impersonate** that identity.

### 5. JWT Has a Hardcoded Fallback Secret
[`auth.ts`](file:///home/user/Desktop/dev/blog/template/src/lib/auth.ts#L4):
```ts
const JWT_SECRET = process.env.JWT_SECRET || 'foss_workspace_jwt_secret_key_2026';
```
If `JWT_SECRET` is not set in env, all tokens are signed with a publicly known string. Anyone can forge valid sessions.

---

## 🟠 Logic / Non-Intuitive Issues

### 6. Middleware Only Protects `/api/v1/assets/pdf/` — Everything Else Is Open
[`middleware.ts`](file:///home/user/Desktop/dev/blog/template/src/middleware.ts#L20): The OpenFGA authorization check fires **only for the PDF asset endpoint**. The main page (`/`), image assets (`/api/v1/assets/image/`), search, and all other endpoints either don't check permissions or use the hardcoded bypass from issue #3. A viewer-restricted document is only truly gated at the PDF level.

### 7. Admin IAM Console Is Fully Open — No Role Check
[`permissions.astro`](file:///home/user/Desktop/dev/blog/template/src/pages/admin/permissions.astro#L5): The admin page reads `currentUser` from locals but **never verifies they are actually an admin**. Any logged-in user (or any unauthenticated visitor using `?as_user=`) can access `/admin/permissions` and call `POST /api/v1/permissions/grant` to grant themselves owner on any resource.

### 8. Admin IAM Console Shows Only Hardcoded Demo Tuples
[`permissions.astro`](file:///home/user/Desktop/dev/blog/template/src/pages/admin/permissions.astro#L8-L25): The "Active Relationships" table is a **static, hardcoded array** — it has nothing to do with what's actually in OpenFGA. Granting a permission via the form calls the real API, but the table never updates. A user will think the grant failed or that the state they see is the real state.

### 9. Blog User Index Page Renders Hardcoded Posts
[`blogs/[user]/index.astro`](file:///home/user/Desktop/dev/blog/template/src/pages/blogs/%5Buser%5D/index.astro#L8-L23): The blog listing page uses a **static two-post array** regardless of which `[user]` is in the URL. Visiting `/blogs/bob` shows the same posts as `/blogs/demo`. Completely non-functional.

### 10. `buildTree()` Silently Drops All Non-Folder Root Nodes
[`index.astro`](file:///home/user/Desktop/dev/blog/template/src/pages/index.astro#L46-L55):
```ts
} else if (r.type === 'folder') {
  roots.push(node);
}
```
Documents, PDFs, or images that have **no `parent_id`** are added to the map but never pushed into `roots`. They become orphan nodes invisible in the folder tree. If any resource is accidentally synced without a parent, it disappears silently from the UI.

### 11. Embed Resolver Hard-codes `user_demo` Content Directory
[`embedResolver.ts`](file:///home/user/Desktop/dev/blog/template/src/lib/render/embedResolver.ts#L55):
```ts
const userDir = path.join(process.cwd(), 'content', 'user_demo');
```
Embeds (`![[...]]`) **only ever resolve from `user_demo`'s vault**, regardless of which user is viewing or which content is being rendered. A document in `user_researcher`'s vault with an embed will always fail to resolve it.

### 12. Search API Fetches Every Resource Without Pagination/SQL Filtering
[`search.ts`](file:///home/user/Desktop/dev/blog/template/src/pages/api/v1/search.ts#L24-L30):
```sql
SELECT id, type, title, path, metadata FROM resources ORDER BY title ASC
```
This query has **no WHERE clause**. Every single search request loads the entire `resources` table into memory, then filters in JavaScript. With hundreds or thousands of documents this will be painfully slow and memory-intensive. The `sqlSearchTerm` variable is created but **never used** in the query.

### 13. `batchCheck` in openfga.ts Calls Individual `checkPermission` Serially (Inside Promise.all)
[`openfga.ts`](file:///home/user/Desktop/dev/blog/template/src/lib/openfga.ts#L76-L81): Each call is concurrent via `Promise.all`, which is good — but each fires a separate HTTP request to OpenFGA. If a canvas has 50 nodes, this is 50 sequential-round-trip fan-outs. OpenFGA has a native `BatchCheck` endpoint that handles this in one call.

### 14. `?as_user=` Param Is Sticky to `/?` Only, Not Persisted Across Navigation
[`Header.astro`](file:///home/user/Desktop/dev/blog/template/src/components/Header.astro#L47):
```ts
onchange="...window.location.href = `/?as_user=${encodeURIComponent(val)}`;"
```
Switching the "Simulate Session" user navigates to `/?as_user=...`. Clicking any document link goes to `/?doc=...` — **losing the `as_user` param**. The simulated user reverts to the default. The session switch does not persist across navigation.

---

## 🟡 UX / Missing Features

### 15. No Loading State / Skeleton While Document Renders Server-Side
When navigating between documents, the entire page does a full-page reload (it's SSR with `?doc=`). There's no loading indicator, skeleton screen, or optimistic UI. Long Markdown files with many embeds can take 1–2 seconds to render, during which the browser shows a blank page.

### 16. Header Always Shows Both "Sign In" and "Register" Even When Logged In
[`Header.astro`](file:///home/user/Desktop/dev/blog/template/src/components/Header.astro#L68-L75): The header renders "Sign In" and "Register" buttons regardless of whether `currentUser` is authenticated. There's no "Sign Out" button accessible when logged in (it exists at `/api/v1/auth/logout` but nothing links to it in the UI).

### 17. No Feedback on Failed Search When DB Is Down
[`SearchModal.tsx`](file:///home/user/Desktop/dev/blog/template/src/components/SearchModal.tsx#L64-L66):
```ts
} catch (err) {
  // ignore
}
```
Search errors are silently swallowed. If the database is unreachable, the user sees nothing — not even a "Search unavailable" message.

### 18. Search Results Dropdown Overflows Off-Screen on Narrow Viewports
The dropdown is absolutely positioned at `width: 420px` with `left: 0`. On screens narrower than ~500px (mobile), the dropdown clips or overflows the viewport. No responsive handling exists.

### 19. Register Page Has No Password Confirmation Field
[`register.astro`](file:///home/user/Desktop/dev/blog/template/src/pages/register.astro): No "Confirm Password" field. Users who mistype their password have no way to detect it until they try to log in and fail.

### 20. `TableOfContents` Component Has No Content to Parse
[`TableOfContents.tsx`](file:///home/user/Desktop/dev/blog/template/src/components/TableOfContents.tsx): The ToC component is rendered server-side (`client:load`) but the document HTML is injected via `set:html` — the ToC has no way to know the headings without querying the DOM after hydration. It's unclear whether the ToC actually scrapes the live DOM or renders empty.

### 21. Keyboard Navigation in Search Results Is Incomplete
[`SearchModal.tsx`](file:///home/user/Desktop/dev/blog/template/src/components/SearchModal.tsx): `selectedIndex` tracks the highlighted item, but there's no `onKeyDown` handler on the input to actually move the selection with arrow keys or open the item with Enter. The keyboard navigation is visual-only and non-functional.

### 22. `admin/permissions` Page: "Apply Tuple" Button Has No Revoke UI Distinction
[`permissions.astro`](file:///home/user/Desktop/dev/blog/template/src/pages/admin/permissions.astro#L139): The button always says "Apply Tuple" — there's no way to toggle between grant and revoke from the UI. The API supports `action: "revoke"` but the form always sends grant. Users wanting to revoke must use the API directly.

---

## ⚪ Code Quality / Optimization

### 23. Massive Inline HTML String Generation for Folder Index View
[`index.astro`](file:///home/user/Desktop/dev/blog/template/src/pages/index.astro#L99-L137): The folder overview is built by concatenating raw HTML strings (`folderCardsHtml += ...`) inside the frontmatter. This pattern bypasses Astro's templating engine, loses XSS sanitization (if titles contain `<script>` or `"`), and is extremely hard to maintain. These should be Astro template fragments.

### 24. `VAULT_OWNERS` in `sync_vault.ts` Must Be Manually Updated for New Users
[`sync_vault.ts`](file:///home/user/Desktop/dev/blog/template/scripts/sync_vault.ts#L34-L38): Adding a new user requires editing the source file. New registered users who create content directories will be silently skipped (`No owner mapped for vault — skipping`). This should query the `users` table to resolve the owner dynamically.

### 25. `sync_vault.ts` Has No Deletion Handling — Orphan Records Accumulate
The sync script only upserts. If a markdown file is deleted or renamed, the old `document:*` record stays in the database and OpenFGA forever. The folder tree and graph will show stale ghost nodes.

### 26. `marked` Renderer Is Mutated Globally on Every Request
[`renderEngine.ts`](file:///home/user/Desktop/dev/blog/template/src/lib/renderEngine.ts#L53):
```ts
marked.use({ renderer: renderer as Partial<Renderer> });
```
`marked.use()` mutates the global `marked` instance. In a concurrent SSR context (multiple requests), the last `use()` call wins — this is a **potential race condition** where one request's renderer bleeds into another's.

### 27. No `<meta description>` or OpenGraph Tags on Any Page
[`index.astro`](file:///home/user/Desktop/dev/blog/template/src/pages/index.astro#L190-L195): Only `<title>` is set. No `<meta name="description">`, `og:title`, `og:image`, etc. Documents and blog posts get zero social sharing metadata.

### 28. `box-sizing: border-box` Applied with Global `* {}` but Inline `style=` Overrides Throughout
The design system tokens are in CSS variables, but almost all layout is done with inline `style=` attributes. This makes responsive design and dark/light theming extremely difficult, and makes the global CSS file largely decorative.
