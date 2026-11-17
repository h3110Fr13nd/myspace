# Quartz Feature Gap Audit

**Status:** selective compatibility audit, not a promise of full Quartz parity
**Last reconciled:** 2026-11-10
**Product and resource targets:** [docs/GOALS.md](../../docs/GOALS.md)

Quartz is a reference for a composable content pipeline and clear module
boundaries. Its static-public-content assumptions do not fit this app's private,
multi-user resources. Every feature below remains subject to the shared
OpenFGA visibility rules and the 1 vCPU / 1 GiB default runtime target.

## Implemented and reachable

These items were previously listed as gaps, but their current routes and UI are
present. Keep their implementation status in the feature-specific plans and
tests rather than reopening them here.

- Client search index plus Meilisearch-backed search in `SearchModal`.
- Permission-checked wikilink hover previews.
- Folder tree navigation and resource graph on the workspace page.
- Tag pages, resource properties, folder listings, and alias redirects.
- Full-file, heading, and block transclusions with a recursion limit.
- Dataview/Bases-style query rendering and public sitemap/RSS routes.

The public sitemap and RSS routes must use anonymous OpenFGA visibility. The
derived `resources.is_public` flag is not an authorization decision. Their
visibility and cache behavior are covered by
`tests/e2e/api/public-feeds.spec.ts`.

## Intentionally deferred

| Capability | Reason / revisit trigger |
|---|---|
| SPA client-side router / DOM morphing | SSR keeps route authorization deterministic and avoids client-side content parsing. Revisit only after UX evidence shows full navigations are a material problem and an authorization-safe design is tested. |
| Stacked sliding panes | Adds persistent navigation state and layout complexity. Revisit after the core reader/editor journeys are stable and users request this mode. |
| 100k-node WebGL graph | Outside the current 10–100-user resource target. Revisit only when measured graph sizes and browser performance require it. |
| Offline encrypted sync, comments, multi-provider federation | Separate product and operational commitments; no current user journey or resource budget justifies enabling them by default. |

## Remaining verification work

- Exercise Bases/Dataview as a complete user journey: visibility filtering,
  malformed queries, and empty results. Author configuration is escaped,
  resource values render through text nodes, and query limits are capped.
- Add stable CI execution for the Testcontainers-backed E2E suite; local results
  do not prove CI coverage.
- Measure full-text index behavior beyond its current 500-resource client
  bootstrap limit before increasing the default payload or adding an index
  dependency.

## Maintenance

Update this audit when a user-visible feature ships, is removed, or is explicitly
deferred. Do not add a capability to the roadmap solely because Quartz has it.
For the active optimization order and evidence, use [docs/GOALS.md](../../docs/GOALS.md).
