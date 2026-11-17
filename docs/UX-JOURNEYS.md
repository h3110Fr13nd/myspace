# UX journey inventory

Current source and verification ledger. Product targets and priorities remain in
[GOALS.md](GOALS.md). A passing component check does not complete a whole journey.

| Journey | Current evidence | Remaining work |
| --- | --- | --- |
| Find a resource | Search recovery, dismissal, and delayed-response browser checks pass | Real-account content and representative discovery review |
| Browse folders/tags | Deployed mobile empty-tag and missing-folder recovery links, 404 status, and keyboard skip targets pass | Empty accessible-folder fixture, injected service errors, and full theme screenshots |
| Create/import | Seeded-account mobile focus/footer review; mocked recovery checks; disposable backend PDF journey verifies exact stored bytes, reload, anonymous denial, and missing-object 404 | External storage provider, image/Google imports, long-request recovery, and personal-account review |
| Edit a note | Eleven editor E2E checks pass; save coordinator overlap/retry harness passes | Real account, full visual audit, persistence/permission integration |
| Read and navigate sections | Contents component and deployed reader-route checks pass, including one history entry/scroll, heading focus, reduced motion, same-tab cross-note navigation, Back/Forward, and skip-to-main keyboard focus; reader-mode route check passes | Broader reader visual review and folder/tag keyboard integration |
| Follow linked references | Component fallback/keyboard checks pass | Permission-filtered route integration and visual review |
| Track reading | Blocked-storage recovery route check passes | Broader reading-status discovery and device-storage explanation |
| Share/public access | Editor checkbox payload check passes; sharing browser check covers load-error Retry, private ACL explanation, failed clipboard write, and encoded resource link success | Persisted visibility, distinct-user permission journeys, and full sharing visual review |
| Collaborate | Two contexts with one synthetic identity synchronize | Distinct-user permissions and deployed transport behavior |
| Account navigation | Guest/auth and seeded-account reviews recorded; browser check covers focus-exit dismissal, Escape focus restoration, and reachable Sign Out at 390 × 400 | Personal account identity, theme screenshots, and role-specific journeys |
| Note chat | Both chat components and both chat API files are empty; no chat-table references found in source/migrations | Unimplemented stubs. Reconcile schema, backend, permissions, and product need before exposing a control |

Preserve stub files and backend code while their intended scope and recoverability
are reconciled. Empty files alone do not justify deleting a feature or its data.
